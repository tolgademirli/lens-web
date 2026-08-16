// send-weekly-picks — haftalık film seçkisi gönderim pipeline'ı.
//
// Bu fonksiyonun TEK işi göndermek. Film SEÇMEZ, Claude çağırmaz, weekly_picks'e
// satır YARATMAZ. Kürasyonu generate-weekly-picks yapar; bu ayrım bir ARIZA ALANI
// ayrımıdır: Claude kesintisi ya da erişilebilirlik API'sinin 429 fırtınası mail
// gönderimini asla geciktirmemeli. Aynı sebeple ANTHROPIC_API_KEY ve WATCH_API_KEY bu fonksiyonun
// ortamında YOKTUR. (Elle giriş kaçış kapısı olarak duruyor — bkz. docs/weekly-picks.md)
//
// Her çağrı, gönderimden ÖNCE bayat satırları süpürür: haftası 7 günden fazla
// geçmiş 'draft' satırlar 'overpast' ile kapanır ve bir daha değerlendirilmez.
// Böylece opt-out yüzünden atlanan seçkiler tabloda birikip, kullanıcı tercihini
// aylar sonra geri açtığında toplu halde patlayamaz. Bilerek geri-doldurmak
// için gövdeye "allow_overpast": true ekle.
//
// Çağrı: normalde pg_cron tetikler (Cuma 14:00 UTC = 17:00 İstanbul). Elle:
//   curl -X POST "$SUPABASE_URL/functions/v1/send-weekly-picks" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"week":"2026-08-07"}'
//
// Gövde: week (zorunlu) · allow_overpast (geri-doldurma) · limit (parti boyutu,
// varsayılan sınırsız — cron partili gönderir, elle çağrı eskisi gibi hepsini alır).
//
// Gerekli secret'lar (supabase secrets set ...):
//   RESEND_API_KEY          — koda ASLA gömülmez
//   WEEKLY_PICKS_SECRET     — çağrı koruması; verify_jwt tek başına yetmez,
//                             çünkü herhangi bir oturumlu kullanıcı invoke edebilir
//   WEEKLY_PICKS_REPLY_TO   — cevapların düştüğü adres (Tolga'nın Gmail'i)
//   UNSUBSCRIBE_SECRET      — maildeki kapatma linkini imzalar; unsubscribe
//                             fonksiyonundaki değerle AYNI olmak zorunda
// Opsiyonel: WEEKLY_PICKS_FROM, SITE_URL, POSTHOG_KEY, POSTHOG_HOST

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderWeeklyPicksEmail, type IntroVariant, type PickFilm } from "./email.ts";
import { unsubscribeUrl } from "../_shared/unsubscribe.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-weekly-picks-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_FROM = "Tolga <tolga@lensestetik.com>";
const DEFAULT_SITE_URL = "https://lensestetik.com";

/** Art arda gönderimde nefes payı — patlama halinde spam sinyali olmasın. */
const SEND_DELAY_MS = 600;

/**
 * Bir seçkinin haftası bu kadar gün geçtiyse artık gönderilmez; satır 'overpast'
 * ile kapanır. Bayat seçki, geç gelen seçkiden iyidir.
 *
 * 7 gün = bir sonraki haftanın seçkisi bunun yerini alır. Cuma gönderimini
 * ertesi gün telafi edebilmek için tam gün payı bırakır.
 */
const OVERPAST_AFTER_DAYS = 7;

const istanbulToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());

function minusDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

type PickRow = {
  id: string;
  user_id: string;
  week: string;
  films: PickFilm[] | null;
  intro_variant: IntroVariant | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(code: string, status = 500, message = "Bir hata oluştu.") {
  return json({ error: message, code }, status);
}

/** "Selam {isim}" için ad. Metadata yoksa e-posta yerel kısmına düşer. */
function displayName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const meta = user.user_metadata ?? {};
  const raw =
    (typeof meta.given_name === "string" && meta.given_name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";

  const first = raw.trim().split(/\s+/)[0] ?? "";
  if (first) return first;

  // ornek.kisi@... → "Ornek". Selamlamayı isimsiz bırakmaktan iyi.
  const local = (user.email ?? "").split("@")[0]?.split(/[.\-_+0-9]+/)[0] ?? "";
  if (!local) return "";
  return local.charAt(0).toLocaleUpperCase("tr-TR") + local.slice(1);
}

const OFFER_TYPES = ["subscription", "free", "buy", "rent", "addon", "off_platform"] as const;

/**
 * JSONB'ye güvenmiyoruz: bozuk satır tüm gönderimi düşürmemeli. (Satırlar artık
 * generate-weekly-picks tarafından yazılıyor ama elle giriş kaçış kapısı olarak
 * duruyor; ayrıca üreticinin bir hatası da maili düşürmemeli.)
 *
 * BİLİNMEYEN ALANLAR DÜŞER ve bu kasıtlı: mailin görmesi gerekmeyen şey mailin
 * eline geçmez. `tags` (eksen hesabına ait) ve `show_id`/`title_en` (üretime ait)
 * burada bilerek geçirilmiyor.
 */
function normalizeFilms(raw: unknown): PickFilm[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const blurb = typeof row.blurb === "string" ? row.blurb.trim() : "";
      if (!title || !blurb) return null;

      // v2 alanları — hepsi opsiyonel; yoksa mail v1 davranışına döner.
      const mediaType = row.media_type === "tv" ? "tv" : row.media_type === "movie" ? "movie" : undefined;
      const providers = Array.isArray(row.providers)
        ? row.providers.filter((p): p is string => typeof p === "string" && p.length > 0)
        : undefined;
      const offerType = OFFER_TYPES.includes(row.offer_type as (typeof OFFER_TYPES)[number])
        ? (row.offer_type as PickFilm["offer_type"])
        : undefined;

      return {
        title,
        year: typeof row.year === "number" ? row.year : Number.NaN,
        blurb,
        // v2 alanı önce, v1 yedek. Şablon ikisini de `watchUrl()` ile okuyor;
        // burada ikisini birleştirmiyoruz ki hangi satırın doğrulanmış deep
        // link'e sahip olduğu veride görünür kalsın.
        ...(typeof row.watch_url === "string" && row.watch_url
          ? { watch_url: row.watch_url }
          : {}),
        ...(typeof row.justwatch_url === "string" && row.justwatch_url
          ? { justwatch_url: row.justwatch_url }
          : {}),
        ...(mediaType ? { media_type: mediaType } : {}),
        ...(providers && providers.length ? { providers } : {}),
        ...(offerType ? { offer_type: offerType } : {}),
      };
    })
    .filter((film): film is PickFilm => film !== null);
}

/** PostHog'a sunucu tarafı event. Best-effort — gönderimi asla bloklamaz. */
async function capture(event: string, distinctId: string, properties: Record<string, unknown>) {
  const key = Deno.env.get("POSTHOG_KEY");
  if (!key) return;
  const host = Deno.env.get("POSTHOG_HOST") ?? "https://us.i.posthog.com";
  try {
    await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error(`[send-weekly-picks] PostHog '${event}' gönderilemedi:`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const callSecret = Deno.env.get("WEEKLY_PICKS_SECRET");
  const replyTo = Deno.env.get("WEEKLY_PICKS_REPLY_TO");
  const unsubSecret = Deno.env.get("UNSUBSCRIBE_SECRET");

  if (!supabaseUrl || !serviceKey || !resendKey || !callSecret || !replyTo || !unsubSecret) {
    console.error("[send-weekly-picks] Eksik ortam değişkeni:", {
      SUPABASE_URL: Boolean(supabaseUrl),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
      RESEND_API_KEY: Boolean(resendKey),
      WEEKLY_PICKS_SECRET: Boolean(callSecret),
      WEEKLY_PICKS_REPLY_TO: Boolean(replyTo),
      UNSUBSCRIBE_SECRET: Boolean(unsubSecret),
    });
    return fail("missing_env");
  }

  // Çağrı koruması. verify_jwt tek başına yetersiz: oturumu olan HERHANGİ bir
  // kullanıcı bu fonksiyonu invoke edebilir, o da tüm haftanın mailini atardı.
  if (req.headers.get("x-weekly-picks-secret") !== callSecret) {
    return fail("forbidden", 403, "Yetkisiz çağrı");
  }

  const from = Deno.env.get("WEEKLY_PICKS_FROM") ?? DEFAULT_FROM;
  const siteUrl = (Deno.env.get("SITE_URL") ?? DEFAULT_SITE_URL).replace(/\/$/, "");
  // Tercihler /account'ta (eski /settings oraya yönleniyor). Yalnızca YEDEK:
  // footer'ın asıl linki imzalı `unsubscribe` fonksiyonu, bu adres oturum ister.
  const settingsUrl = `${siteUrl}/account`;
  const dashboardUrl = `${siteUrl}/dashboard`;
  const functionsBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

  let week: string;
  let allowOverpast: boolean;
  let limit: number | null;
  try {
    const body = await req.json();
    week = typeof body?.week === "string" ? body.week.trim() : "";
    // Bilinçli geri-doldurma kaçış kapısı. Varsayılan false: eski bir haftayı
    // yanlışlıkla invoke etmek kimseye bayat mail attırmamalı.
    allowOverpast = body?.allow_overpast === true;
    // Parti boyutu. VARSAYILAN SINIRSIZ: mevcut elle curl bayt bayt aynı kalsın.
    // Cron parti parti gönderir çünkü 600ms throttle ile 100 alıcı ~110s eder ve
    // duvar saatine dayanır; sonraki tik kalanı alır (sent satırlar bir daha
    // seçilmediği için tekrar mail gitmez).
    limit =
      typeof body?.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
        ? body.limit
        : null;
  } catch {
    return fail("bad_body", 400, "Geçersiz istek gövdesi");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return fail("bad_week", 400, "week alanı YYYY-MM-DD biçiminde olmalı");
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // --- Süpürme -------------------------------------------------------------
  // Haftası geçmiş 'draft' satırları terminal duruma kapat. Bu, sistemin
  // kendini koruma mekanizması: opt-out yüzünden atlanan ya da hiç çağrılmamış
  // satırlar tabloda süresiz birikip, kullanıcı tercihini aylar sonra geri
  // açtığında toplu halde patlayamaz. Talep edilen hafta bu adımda dışarıda
  // tutulur; onun kaderi hemen aşağıda ayrıca kararlaştırılır.
  const cutoff = minusDays(istanbulToday(), OVERPAST_AFTER_DAYS);

  const { data: sweptRows, error: sweepError } = await sb
    .from("weekly_picks")
    .update({ status: "overpast" })
    .eq("status", "draft")
    .lt("week", cutoff)
    .neq("week", week)
    .select("id");

  if (sweepError) {
    // Süpürme başarısızsa devam ediyoruz: bu adım geleceği korur, bu çağrının
    // doğruluğunu değil. Talep edilen haftanın kendi kontrolü aşağıda zaten var.
    console.error("[send-weekly-picks] Süpürme başarısız:", sweepError);
  }
  const overpast = sweptRows?.length ?? 0;

  // Talep edilen haftanın kendisi bayatsa: açık bayrak yoksa gönderme, kapat.
  if (week < cutoff && !allowOverpast) {
    const { data: closed, error: closeError } = await sb
      .from("weekly_picks")
      .update({ status: "overpast" })
      .eq("status", "draft")
      .eq("week", week)
      .select("id");

    if (closeError) {
      console.error("[send-weekly-picks] Bayat hafta kapatılamadı:", closeError);
      return fail("overpast_close_failed");
    }

    const closedCount = closed?.length ?? 0;
    console.log(
      `[send-weekly-picks] ${week} bayat (cutoff ${cutoff}); ${closedCount} satır 'overpast' yapıldı, gönderim yok.`
    );
    return json({
      week,
      total: closedCount,
      sent: 0,
      skipped: 0,
      failed: 0,
      overpast: overpast + closedCount,
      note: `Bu haftanın üzerinden ${OVERPAST_AFTER_DAYS} günden fazla geçti; gönderim yapılmadı. Bilerek geri-doldurmak istiyorsan allow_overpast: true gönder.`,
      results: [],
    });
  }

  let picksQuery = sb
    .from("weekly_picks")
    .select("id, user_id, week, films, intro_variant")
    .eq("week", week)
    .eq("status", "draft")
    .order("created_at", { ascending: true });

  // Parti sınırı sorguya uygulanır, döngüye değil: sınırın dışında kalan satırlar
  // 'draft' kalır ve sonraki tik onları alır.
  if (limit !== null) picksQuery = picksQuery.limit(limit);

  const { data: picks, error: picksError } = await picksQuery.returns<PickRow[]>();

  if (picksError) {
    console.error("[send-weekly-picks] Seçki sorgusu hatası:", picksError);
    return fail("picks_query_failed");
  }

  if (!picks || picks.length === 0) {
    return json({ week, total: 0, sent: 0, skipped: 0, failed: 0, overpast, results: [] });
  }

  // Opt-out kontrolü. user_preferences satırı OLMAYAN kullanıcı gönderime dahildir
  // (varsayılan açık); yalnızca weekly_picks_enabled = false olan atlanır.
  // Bu tabloyu weekly_picks'e embed edemiyoruz — aralarında bildirilmiş bir FK yok.
  const { data: prefs, error: prefsError } = await sb
    .from("user_preferences")
    .select("user_id, weekly_picks_enabled")
    .in("user_id", picks.map((pick) => pick.user_id))
    .returns<{ user_id: string; weekly_picks_enabled: boolean }[]>();

  if (prefsError) {
    // Tercihler okunamadıysa DURUYORUZ. Varsayılana düşüp göndermek, opt-out
    // yapmış kullanıcıya mail atmak demek — sessizce yapılabilecek en kötü hata.
    console.error("[send-weekly-picks] Tercih sorgusu hatası:", prefsError);
    return fail("preferences_query_failed");
  }

  const optedOut = new Set(
    (prefs ?? []).filter((row) => row.weekly_picks_enabled === false).map((row) => row.user_id)
  );

  // Platform slug -> görünen ad. Sözlük watch_providers'ta yaşıyor; şablon çeviri
  // yapmaz. Okunamazsa mail platform önekini atlar ve gönderime DEVAM eder —
  // "Netflix ·" yazısının kaybı, mailin gitmemesinden iyidir.
  const { data: providerRows, error: providerError } = await sb
    .from("watch_providers")
    .select("slug, label_tr")
    .returns<{ slug: string; label_tr: string }[]>();

  if (providerError) {
    console.error("[send-weekly-picks] Platform sözlüğü okunamadı:", providerError);
  }
  const providerLabels = Object.fromEntries(
    (providerRows ?? []).map((row) => [row.slug, row.label_tr])
  );

  const results: { pick_id: string; user_id: string; status: string; reason?: string }[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const pick of picks) {
    // Atlanan satır 'draft' kalır — ama süresiz değil: haftası geçtiğinde
    // yukarıdaki süpürme onu 'overpast' yapar. Yani kullanıcı bu hafta içinde
    // tercihini geri açarsa aynı seçki hâlâ gidebilir; aylar sonra açarsa
    // aradaki haftalar çoktan kapanmış olur.
    if (optedOut.has(pick.user_id)) {
      skipped += 1;
      results.push({ pick_id: pick.id, user_id: pick.user_id, status: "skipped", reason: "opted_out" });
      continue;
    }

    // Bir alıcının hatası döngüyü durdurmamalı: her adım kendi try'ında.
    try {
      const films = normalizeFilms(pick.films);
      if (films.length === 0) throw new Error("films boş ya da geçersiz");

      const { data: userData, error: userError } = await sb.auth.admin.getUserById(pick.user_id);
      const user = userData?.user;
      if (userError || !user?.email) {
        throw new Error(`kullanıcı e-postası bulunamadı: ${userError?.message ?? "email yok"}`);
      }

      // Kapatma linki KULLANICIYA ÖZEL imzalanır: token user_id'ye bağlı, yani
      // her alıcı için yeniden üretilmek zorunda.
      const unsubUrl = await unsubscribeUrl(functionsBase, pick.user_id, unsubSecret);

      // intro_variant şablona GEÇMİYOR: mail tek girişe düştü. Kolon ve PostHog
      // property'si duruyor (ileride varyant denemesi geri gelebilir).
      const { subject, html, text } = renderWeeklyPicksEmail({
        name: displayName(user),
        films,
        settingsUrl,
        unsubscribeUrl: unsubUrl,
        dashboardUrl,
        providerLabels,
      });

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [user.email],
          subject,
          html,
          text,
          // Cevaplar asıl sinyal — no-reply'a değil, gerçek kutuya düşsün.
          reply_to: replyTo,
          headers: {
            // Gmail deliverability + KVKK nezaketi. Artık imzalı endpoint'e bakıyor:
            // oturum istemez, tek istekte kapatır.
            "List-Unsubscribe": `<${unsubUrl}>, <mailto:${replyTo}?subject=Haftalik%20secki%20istemiyorum>`,
            // One-Click (RFC 8058) NİHAYET açık: karşılığı olan POST endpoint'i var.
            // Bu header olmadan Gmail/Yahoo listeden çıkarma düğmesini göstermiyor
            // ve kullanıcının elinde kalan tek seçenek "spam" oluyor.
            //
            // DİKKAT: header'ın DEĞERİ sabit bir dizedir, POST'un gövdesiyle
            // karıştırılmamalı. Değeri değiştirmek istemcilerin düğmeyi gizlemesine
            // yol açar.
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }

      const { error: updateError } = await sb
        .from("weekly_picks")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", pick.id);

      if (updateError) {
        // Mail GİTTİ. Bunu 'failed' saymak yeniden gönderime yol açar — çift mail,
        // kayıp durumdan beter. Loglayıp 'sent' say, satırı elle düzelt.
        console.error(`[send-weekly-picks] ${pick.id} gönderildi ama status yazılamadı:`, updateError);
      }

      sent += 1;
      results.push({ pick_id: pick.id, user_id: pick.user_id, status: "sent" });
      await capture("weekly_pick_sent", pick.user_id, {
        week,
        pick_id: pick.id,
        film_count: films.length,
        intro_variant: pick.intro_variant ?? "standart",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[send-weekly-picks] ${pick.id} gönderilemedi:`, reason);

      const { error: updateError } = await sb
        .from("weekly_picks")
        .update({ status: "failed" })
        .eq("id", pick.id);
      if (updateError) {
        console.error(`[send-weekly-picks] ${pick.id} 'failed' işaretlenemedi:`, updateError);
      }

      failed += 1;
      results.push({ pick_id: pick.id, user_id: pick.user_id, status: "failed", reason });
    }

    await sleep(SEND_DELAY_MS);
  }

  console.log(
    `[send-weekly-picks] ${week}: ${sent} gönderildi, ${skipped} atlandı, ${failed} hata, ${overpast} bayat kapatıldı`
  );
  return json({ week, total: picks.length, sent, skipped, failed, overpast, results });
});
