// generate-weekly-picks — haftalık film/dizi seçkisinin ÜRETİMİ.
//
// send-weekly-picks'ten AYRI bir fonksiyon ve bu bir arıza alanı ayrımı:
// Claude kesintisi ya da erişilebilirlik API'sinin 429 fırtınası mail gönderimini
// asla geciktirmemeli. Aynı sebeple RESEND_API_KEY bu fonksiyonun ortamında YOK,
// ANTHROPIC_API_KEY ve WATCH_API_KEY de gönderenin ortamında yok.
//
// İKİ YOL VAR ve ayrım paket kaynaklı:
//   * Ücretsiz (bugün herkes) — platform filtresi YOK, erişilebilirlik API'si HİÇ
//     çağrılmaz. İzleme linki JustWatch ARAMA linkidir: bir slug tahmini olmadığı
//     için asla 404 vermez. Maliyet: yalnızca Claude.
//   * Premium + platform seçili — movieofthenight çağrılır; her aday doğrulanır,
//     link servise DOĞRUDAN deep link olur ve filtre gerçekten uygulanır.
// Kapı `lens_weekly_pick_candidates`'ta: ücretsiz pakette `platforms` NULL döner,
// yani bu fonksiyonun yanlış yapma imkânı yok (premium'dan düşen kullanıcı da
// otomatik olarak doğru davranır).
//
// AKIŞ (kullanıcı başına, sıralı, izole try/catch):
//   1. lens_refresh_profile_if_due     — ücretsiz pakette haftalık profil tazeleme
//   2. son rapor                        — prompt'un zemini
//   3. lens_blocked_works               — yasak küme
//   4. taste_profile                    — eksenler + tür ağırlıkları
//   5. Claude                           — N aday (aşırı üretim)
//   6. erişilebilirlik                  — YALNIZCA filtre etkinse: doğrulama +
//                                         servis deep link'i + platform bilgisi
//   7. lens_work_keys                   — yasak küme doğrulaması (anahtar SUNUCUDA)
//   8. gevşetme merdiveni               — 3 öğe dolana kadar
//   9. weekly_picks insert (draft)      — status='draft', gönderim ayrı iş
//
// Çağrı (cron ya da elle):
//   curl -X POST "$SUPABASE_URL/functions/v1/generate-weekly-picks" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"week":"2026-08-21","dry_run":true,"only_user_id":"<uuid>"}'
//
// Modlar: dry_run (insert etmez) · only_user_id (tek kişi) · mode=services
// (TR'de tanınan servisleri döker, watch_providers.service_id'yi doğrulamak için)
// · mode=probe (Claude'suz erişilebilirlik denemesi) · mode=digest (haftanın özeti)
//
// Gerekli secret'lar: ANTHROPIC_API_KEY, WEEKLY_PICKS_SECRET
// (+ lokal stack'in enjekte ettiği SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
// WATCH_API_KEY yalnızca platform filtresi olan (premium) kullanıcılar için gerekir.
//
// Künye: akış bilgisi "Streaming Availability API by Movie of the Night"
// tarafından sağlanıyor — künye Hesabım ekranında (src/pages/Account.tsx) görünür.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_WATCH_CALLS_PER_USER,
  WATCH_CONCURRENCY,
  WatchClient,
  foldName,
  justwatchSearchUrl,
  mapLimit,
  type MediaType,
  type OfferType,
  type StreamOption,
  type WatchMatch,
} from "../_shared/watch.ts";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  candidateCount,
  extractJson,
  normalizeCandidates,
  type BlockedWork,
  type Candidate,
} from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-weekly-picks-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Hedef öğe sayısı. Altına düşmek serbest (mail değişken sayıyı karşılıyor). */
const TARGET = 3;

/**
 * Kullanıcı başına SERT Claude tavanı. Gevşetme merdiveninin 2. basamağı ikinci
 * çağrıyı harcar; üçüncüsü yok. Maliyet patlamasına kapalı kapı.
 */
const MAX_CLAUDE_CALLS_PER_USER = 2;

/**
 * Bir invocation'da kaç kullanıcı. Ücretsiz yolda kullanıcı başına maliyet
 * yalnızca Claude (8-20s); premium yolda üstüne ~9 erişilebilirlik çağrısı biner.
 * Edge function DUVAR SAATİ ~150s olduğu için tavan en kötü duruma göre.
 */
const MAX_USERS_PER_RUN = 3;
const RUN_DEADLINE_MS = 110_000;

const istanbulToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(code: string, status = 500, message = "Bir hata oluştu.") {
  return json({ error: message, code }, status);
}

type ProviderRow = {
  slug: string;
  label_tr: string;
  /** NULL = sağlayıcıdaki karşılığı doğrulanmadı; o slug filtreye katılamaz. */
  service_id: string | null;
};

type FilmV2 = {
  title: string;
  year: number;
  blurb: string;
  /**
   * İzleme linki. Premium yolda servise DOĞRUDAN deep link (sağlayıcıdan gelir),
   * ücretsiz yolda JustWatch ARAMA linki. Alan adı `justwatch_url` DEĞİL: v1 (elle
   * girilmiş) satırlar o adı taşıyor ve iki anlamı tek ada sıkıştırmak, ileride
   * "bu link doğrulanmış mı" sorusunu cevapsız bırakırdı.
   */
  watch_url: string;
  director: string;
  media_type: MediaType;
  /** Sağlayıcının show id'si — YALNIZCA doğrulanmış (premium) yolda vardır. */
  show_id?: string;
  /** watch_providers.slug listesi. Ücretsiz yolda yoktur (bilgi yok). */
  providers?: string[];
  offer_type?: OfferType | "off_platform";
  tags: Candidate["tags"];
};

/* ------------------------------------------------------------------ */
/* Gevşetme merdiveni                                                  */
/* ------------------------------------------------------------------ */

/** Merdivendeki basamak — küçük olan tercih edilir. */
const RUNG = { onPlatformFlat: 0, onPlatformFree: 1, onPlatformPaid: 3, offPlatform: 4 } as const;

/**
 * Teklif tipi tercihi — kullanıcı için ucuzdan pahalıya.
 *
 * `addon`, seçili platformun İÇİNDEN satın alınan ek bir kanaldır (örn. Prime
 * Video üzerinden MUBI). Kullanıcının o platforma abone olması onu izleyebildiği
 * anlamına GELMEZ; bu yüzden kiralık/satın alma ile aynı basamakta.
 */
const OFFER_PREFERENCE: OfferType[] = ["subscription", "free", "rent", "buy", "addon"];

type Classified = {
  offer_type: OfferType | "off_platform";
  providers: string[];
  rung: number;
  /** Kullanıcıya gösterilecek link — SEÇİLEN teklifin kendi linki. */
  link: string;
};

/**
 * Bir eserin TR izleme seçeneklerini kullanıcının platform seçimine göre sınıflar.
 * YALNIZCA filtre etkinken (premium + platform seçili) çağrılır; ücretsiz yolda
 * sınıflanacak bir şey yok, çünkü hiç sorgu yapılmıyor.
 *
 * `selected` sağlayıcının servis id'lerini tutar, `serviceToSlug` onları bizim
 * kelime dağarcığımıza çevirir. Tanımadığımız bir servis slug'sız kalır ve
 * `providers` dizisine girmez — mailde yanlış bir platform adı yazmaktansa
 * hiçbir şey yazmamak yeğdir.
 */
function classify(
  options: StreamOption[],
  selected: Set<string>,
  serviceToSlug: Map<string, string>,
): Classified {
  const slugsOf = (opts: StreamOption[]) =>
    [...new Set(opts.map((o) => serviceToSlug.get(o.service_id)).filter((s): s is string => Boolean(s)))];

  const byType = (type: OfferType, onlySelected: boolean) =>
    options.filter((o) => o.type === type && (!onlySelected || selected.has(o.service_id)));

  const rungFor = (type: OfferType): number => {
    if (type === "subscription") return RUNG.onPlatformFlat;
    if (type === "free") return RUNG.onPlatformFree;
    return RUNG.onPlatformPaid;
  };

  for (const type of OFFER_PREFERENCE) {
    const hits = byType(type, true);
    if (hits.length === 0) continue;
    return {
      offer_type: type,
      providers: slugsOf(hits),
      rung: rungFor(type),
      link: hits[0].link,
    };
  }

  // Seçili platformların dışında ama TR'de izlenebiliyor.
  for (const type of OFFER_PREFERENCE) {
    const any = byType(type, false);
    if (any.length === 0) continue;
    return {
      offer_type: "off_platform",
      providers: slugsOf(any).slice(0, 3),
      rung: RUNG.offPlatform,
      link: any[0].link,
    };
  }

  // Buraya düşmek için options'ın boş olması gerekir; çağıran o durumu zaten
  // "TR'de izlenemiyor" diye eliyor. Yine de savunmacı bir dönüş.
  return { offer_type: "off_platform", providers: [], rung: RUNG.offPlatform, link: "" };
}

/* ------------------------------------------------------------------ */
/* Claude                                                             */
/* ------------------------------------------------------------------ */

async function askClaude(apiKey: string, prompt: string): Promise<Candidate[] | string> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // daily-discovery 3 öğe için 1536 kullanıyor; burada 9 aday ve her adayda
        // 4 ek alan (title_en, year, media_type, creator) var. 2048 pay bırakıyor.
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    console.error("[generate] Claude'a ulaşılamadı:", err);
    return "claude_unreachable";
  }

  if (!res.ok) {
    console.error(`[generate] Claude ${res.status}:`, (await res.text()).slice(0, 400));
    return `claude_http_${res.status}`;
  }

  const payload = await res.json();
  if (payload?.stop_reason === "max_tokens") {
    // Kırpılan yanıt geçersiz JSON'a dönüyor; aday sayısını düşürmek gerekir.
    console.error("[generate] Claude yanıtı max_tokens'da kırpıldı");
    return "claude_truncated";
  }

  const text = payload?.content?.[0]?.text;
  if (typeof text !== "string") return "claude_bad_shape";

  const parsed = extractJson(text);
  if (!parsed) return "claude_bad_json";

  const candidates = normalizeCandidates(parsed);
  if (candidates.length === 0) return "claude_incomplete";
  return candidates;
}

/* ------------------------------------------------------------------ */
/* Yasak küme doğrulaması                                             */
/* ------------------------------------------------------------------ */

/**
 * Anahtarlar SUNUCUDA üretilir (lens_work_keys). Deno'da normalizasyonu yeniden
 * yazmak yasak: `lens_name_key`'deki noktasız 'I' kuralı kaçırıldığında
 * "Into the Wild" -> "ntothewild" olur ve filtre SESSİZCE delinir (CLAUDE.md).
 *
 * Anahtar üretilemezse FAIL-OPEN: doğrulama yapılamadıysa öneriyi engellemiyoruz
 * (daily-discovery:375 ile aynı politika).
 */
async function blockedIndex(
  sb: SupabaseClient,
  candidates: Candidate[],
  blockedKeys: Set<string>,
): Promise<Set<number>> {
  if (candidates.length === 0 || blockedKeys.size === 0) return new Set();

  // Dizi de film de motorda 'film' tipinde yaşıyor (work_type CHECK'i böyle).
  const payload = candidates.map((c) => ({
    type: "film",
    creator: c.creator,
    title: c.title,
  }));

  const { data, error } = await sb.rpc("lens_work_keys", { p_items: payload });
  if (error || !Array.isArray(data)) {
    console.error("[generate] lens_work_keys başarısız, doğrulama atlanıyor:", error);
    return new Set();
  }

  const out = new Set<number>();
  data.forEach((key, i) => {
    if (typeof key === "string" && blockedKeys.has(key)) out.add(i);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Kullanıcı başına üretim                                            */
/* ------------------------------------------------------------------ */

type UserOutcome = {
  user_id: string;
  status: "inserted" | "dry_run" | "raced" | "empty" | "failed";
  films?: FilmV2[];
  relaxations?: string[];
  claude_calls?: number;
  watch_calls?: number;
  /** Erişilebilirlik API'si çağrıldı mı — ücretsiz yolda her zaman false. */
  filtered?: boolean;
  reason?: string;
};

/**
 * Bir turda hayatta kalan aday. `match` ve `cls` YALNIZCA doğrulanmış (premium)
 * yolda doludur; ikisi birlikte null olur, biri dolu diğeri boş olamaz.
 */
type Pending = {
  candidate: Candidate;
  cls: Classified | null;
  match: WatchMatch | null;
  /** Tekilleştirme anahtarı: doğrulanmışta show id, ücretsizde katlanmış ad+yıl. */
  key: string;
};

/** Ücretsiz yolda gevşetilecek filtre yok: her aday en alt basamakta. */
const rungOf = (v: Pending): number => v.cls?.rung ?? RUNG.onPlatformFlat;

async function generateForUser(
  sb: SupabaseClient,
  watch: WatchClient | null,
  anthropicKey: string,
  opts: {
    userId: string;
    week: string;
    platforms: string[] | null;
    providers: ProviderRow[];
    dryRun: boolean;
  },
): Promise<UserOutcome> {
  const { userId, week, platforms, providers, dryRun } = opts;
  watch?.resetCallCount();
  const relaxations: string[] = [];
  let claudeCalls = 0;

  // Ücretsiz pakette haftalık profil tazelemesi buradan da tetiklenir: kullanıcı
  // o hafta hiç panele girmediyse profili yine güncel olsun.
  const { error: refreshError } = await sb.rpc("lens_refresh_profile_if_due", {
    p_user_id: userId,
  });
  if (refreshError) console.error(`[generate] ${userId} profil tazelenemedi:`, refreshError);

  const { data: report, error: reportError } = await sb
    .from("reports")
    .select("id, hero, texture, books, films, songs")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportError) throw new Error(`rapor okunamadı: ${reportError.message}`);
  if (!report) return { user_id: userId, status: "failed", reason: "rapor yok" };

  const { data: blockedRaw, error: blockedError } = await sb.rpc("lens_blocked_works", {
    p_user_id: userId,
  });
  if (blockedError) console.error(`[generate] ${userId} yasak küme okunamadı:`, blockedError);
  const blocked: BlockedWork[] = Array.isArray(blockedRaw) ? blockedRaw : [];
  const blockedKeys = new Set(blocked.map((b) => b.work_key));

  const { data: profile } = await sb
    .from("taste_profile")
    .select("axes, genre_weights")
    .eq("user_id", userId)
    .maybeSingle();

  // ---- Platform seçimi -> servis id kümesi ------------------------------
  // `platforms` ücretsiz pakette RPC tarafından NULL'a çevrilmiş durumda; burada
  // paket sorgulanmaz (tek zorlama noktası kuralı).
  const selectedSlugs = platforms ?? [];
  const serviceToSlug = new Map<string, string>();
  for (const p of providers) if (p.service_id) serviceToSlug.set(p.service_id, p.slug);

  const selectedServices = new Set<string>();
  for (const slug of selectedSlugs) {
    const row = providers.find((p) => p.slug === slug);
    if (row?.service_id) selectedServices.add(row.service_id);
    else {
      // YÜKSEK SESLE: çözülemeyen slug o kullanıcının filtresini eksiltir ve
      // gevşetme merdiveni bunu "platform dışı öneri" diye gizler.
      console.error(`[generate] ${userId} seçtiği '${slug}' servise bağlanmamış, filtre eksik`);
      relaxations.push(`unresolved_platform:${slug}`);
    }
  }

  const filterActive = selectedServices.size > 0;

  // Filtre var ama anahtar yok: bu kullanıcıyı SESSİZCE ücretsiz yola düşürmüyoruz.
  // Ödediği filtreyi uygulayamıyorsak satır yazmamak doğrusu — sonraki tik onu
  // yine aday görür ve anahtar geldiğinde doğru seçki üretilir.
  if (filterActive && !watch) {
    return {
      user_id: userId,
      status: "failed",
      reason: "WATCH_API_KEY yok; platform filtreli kullanıcı atlandı",
    };
  }

  const platformLabels = selectedSlugs
    .map((s) => providers.find((p) => p.slug === s)?.label_tr)
    .filter((l): l is string => Boolean(l));

  const wanted = candidateCount(filterActive ? selectedSlugs.length : 0);

  const chosen: FilmV2[] = [];
  const usedKeys = new Set<string>();
  const unavailable: string[] = [];
  const pending: Pending[] = [];

  const runRound = async (violation?: string) => {
    if (claudeCalls >= MAX_CLAUDE_CALLS_PER_USER) return;
    claudeCalls += 1;

    const prompt = buildPrompt({
      report,
      profile: profile ?? null,
      blocked,
      platformLabels: filterActive ? platformLabels : [],
      wanted,
      unavailable,
      violation,
    });

    const result = await askClaude(anthropicKey, prompt);
    if (typeof result === "string") throw new Error(`claude: ${result}`);

    // Yasak küme: ihlal edeni DÜŞÜR. daily-discovery yeniden soruyor ama biz
    // aşırı ürettik — atmak bir Claude çağrısından ucuz.
    const violators = await blockedIndex(sb, result, blockedKeys);
    if (violators.size) {
      const names = [...violators].map((i) => result[i].title);
      console.error(`[generate] ${userId} yasaklı öneri düşürüldü: ${names.join(", ")}`);
      relaxations.push(`blocked_dropped:${names.length}`);
    }
    const fresh = result.filter((_, i) => !violators.has(i));

    let verified: (Pending | null)[];

    if (!filterActive) {
      // ÜCRETSİZ YOL: ağ isteği YOK. Link bir ARAMA linki olduğu için yanlış
      // olamaz (slug tahmini değil), o yüzden doğrulama kapısına da gerek yok.
      // Bedeli açıkça kabul edilmiş: eserin TR'de izlenip izlenemediğini
      // bilmiyoruz ve bunu mailde iddia da etmiyoruz — "Nerede izlenir" linki
      // kullanıcıyı aramaya götürür, bir platform adı vaat etmez.
      verified = fresh.map((c) => ({
        candidate: c,
        // Sınıflama YOK: providers/offer_type ücretsiz yolda yazılmaz, çünkü o
        // bilgiye sahip değiliz. Boş bir sınıflama uydurmak, mailde "Ücretsiz"
        // ya da bir platform adı iddia etmeye kapı açardı.
        cls: null,
        match: null,
        key: `${c.media_type}|${foldName(c.title_en || c.title)}|${c.year}`,
      }));
    } else {
      const client = watch!;
      verified = await mapLimit(fresh, WATCH_CONCURRENCY, async (c) => {
        if (client.callCount >= MAX_WATCH_CALLS_PER_USER) return null;
        const match = await client.findWork({
          title: c.title,
          title_en: c.title_en,
          year: c.year,
          media_type: c.media_type,
        });
        if (!match) {
          // Hangi eseri linklediğimizi BİLMİYORUZ. Yanlış link, eksik linkten
          // kesinlikle kötüdür — gevşetilmez, düşer.
          unavailable.push(c.title);
          return null;
        }
        if (match.options.length === 0) {
          // Türkiye'de hiçbir yerde izlenemiyor. "Yok" sayfasına link vermek,
          // kısa bir seçkiden kötüdür — bu da gevşetilmez.
          unavailable.push(c.title);
          return null;
        }
        return {
          candidate: c,
          cls: classify(match.options, selectedServices, serviceToSlug),
          match,
          key: `show|${match.show_id}`,
        };
      });

      // Tavan dolduysa listenin KUYRUĞU hiç sorulmadı. Bu, "hiçbiri erişilebilir
      // değil" ile karıştırılmamalı: eksik seçkinin sebebi aday kalitesi değil,
      // kota koruması. Görünür olmadan teşhis edilemez.
      if (client.callCount >= MAX_WATCH_CALLS_PER_USER) {
        console.error(`[generate] ${userId} erişilebilirlik çağrı tavanına dayandı`);
        relaxations.push("watch_call_cap");
      }
    }

    for (const v of verified) {
      if (!v) continue;
      if (usedKeys.has(v.key)) continue;
      usedKeys.add(v.key);
      pending.push(v);
    }
  };

  await runRound();

  const toFilm = (v: Pending): FilmV2 => {
    const film: FilmV2 = {
      // Görünen ad HER ZAMAN Claude'un yazımı: kullanıcı Türkçe adı tanır ve
      // sağlayıcının kataloğu İngilizce ad döner ("Yeşil Işın" -> "The Green Ray").
      // Doğrulanmış yolda da böyle — güven kapısı zaten doğru esere baktığımızı
      // garantiliyor, gösterilecek adı seçmek ayrı bir iş.
      title: v.candidate.title,
      year: v.candidate.year!,
      blurb: v.candidate.blurb,
      watch_url: v.cls ? v.cls.link : justwatchSearchUrl(v.candidate.title),
      director: v.candidate.creator,
      // Doğrulanmış yolda medya tipi SAĞLAYICIDAN gelir: Claude mini dizileri
      // bazen film etiketliyor ve mailde "dizi" rozetini bu alan belirliyor.
      media_type: v.match ? v.match.media_type : v.candidate.media_type,
      tags: v.candidate.tags,
    };
    if (v.match && v.cls) {
      film.show_id = v.match.show_id;
      film.providers = v.cls.providers;
      film.offer_type = v.cls.offer_type;
    }
    return film;
  };

  const take = (maxRung: number, label: string) => {
    const before = chosen.length;
    for (const v of pending) {
      if (chosen.length >= TARGET) break;
      if (rungOf(v) > maxRung) continue;
      if (chosen.some((f) => f.title === v.candidate.title && f.year === v.candidate.year)) continue;
      chosen.push(toFilm(v));
    }
    if (chosen.length > before && label) relaxations.push(label);
  };

  // Basamak 0-1: seçili platformda abonelikle ya da ücretsiz. (Ücretsiz yolda
  // bütün adaylar zaten 0. basamakta — gevşetilecek bir filtre yok.)
  take(RUNG.onPlatformFree, "");

  // Basamak 2: ikinci Claude çağrısı.
  if (chosen.length < TARGET && claudeCalls < MAX_CLAUDE_CALLS_PER_USER) {
    relaxations.push("second_claude_call");
    try {
      await runRound();
      take(RUNG.onPlatformFree, "");
    } catch (err) {
      // İkinci çağrı başarısızsa elimizdekiyle devam ediyoruz.
      console.error(`[generate] ${userId} ikinci çağrı başarısız:`, err);
    }
  }

  // Basamak 3: seçili platformda kiralık/satın alma/ek kanal.
  if (chosen.length < TARGET) take(RUNG.onPlatformPaid, "rent_or_buy");
  // Basamak 4: filtre yok sayılıyor.
  if (chosen.length < TARGET) take(RUNG.offPlatform, "off_platform");

  const watchCalls = watch?.callCount ?? 0;

  // Basamak 6: hiç hayatta kalan yok -> SATIR YOK. Asla films: [] yazmıyoruz;
  // o satır normalizeFilms'ten [] döner ve gönderen onu 'failed' işaretler.
  if (chosen.length === 0) {
    return {
      user_id: userId,
      status: "empty",
      relaxations,
      claude_calls: claudeCalls,
      watch_calls: watchCalls,
      filtered: filterActive,
      reason: unavailable.length ? `hiçbiri erişilebilir değil (${unavailable.length} aday)` : "aday yok",
    };
  }

  if (chosen.length < TARGET) relaxations.push(`short:${chosen.length}`);

  if (dryRun) {
    return {
      user_id: userId,
      status: "dry_run",
      films: chosen,
      relaxations,
      claude_calls: claudeCalls,
      watch_calls: watchCalls,
      filtered: filterActive,
    };
  }

  // ignoreDuplicates: yarışan bir tik insert'i KAYBEDER, hata vermez.
  // UNIQUE(user_id, week) son duvar.
  const { data: inserted, error: insertError } = await sb
    .from("weekly_picks")
    .upsert(
      { user_id: userId, week, films: chosen },
      { onConflict: "user_id,week", ignoreDuplicates: true },
    )
    .select("id");

  if (insertError) throw new Error(`insert: ${insertError.message}`);

  // Satır dönmediyse çakışma oldu: token harcandı ama satır yok — GÖRÜNÜR olmalı.
  if (!inserted || inserted.length === 0) {
    return {
      user_id: userId,
      status: "raced",
      relaxations,
      claude_calls: claudeCalls,
      watch_calls: watchCalls,
      filtered: filterActive,
    };
  }

  return {
    user_id: userId,
    status: "inserted",
    films: chosen,
    relaxations,
    claude_calls: claudeCalls,
    watch_calls: watchCalls,
    filtered: filterActive,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const callSecret = Deno.env.get("WEEKLY_PICKS_SECRET");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  // OPSİYONEL: yalnızca platform filtresi olan (premium) kullanıcılar için gerekir.
  // Yokluğunda ücretsiz kullanıcıların seçkisi normal şekilde üretilir; filtreli
  // kullanıcılar SATIR ALMAZ (sessizce filtresiz seçki göndermek yerine atlanır).
  const watchKey = Deno.env.get("WATCH_API_KEY");

  if (!supabaseUrl || !serviceKey || !callSecret || !anthropicKey) {
    console.error("[generate] Eksik ortam değişkeni:", {
      SUPABASE_URL: Boolean(supabaseUrl),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
      WEEKLY_PICKS_SECRET: Boolean(callSecret),
      ANTHROPIC_API_KEY: Boolean(anthropicKey),
    });
    return fail("missing_env");
  }

  // send-weekly-picks ile AYNI koruma. verify_jwt tek başına yetmez: oturumu olan
  // herhangi bir kullanıcı bu fonksiyonu invoke edip bütün haftanın token'ını
  // harcatabilirdi.
  if (req.headers.get("x-weekly-picks-secret") !== callSecret) {
    return fail("forbidden", 403, "Yetkisiz çağrı");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return fail("bad_body", 400, "Geçersiz istek gövdesi");
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  const sb = createClient(supabaseUrl, serviceKey);
  const watch = watchKey ? new WatchClient(watchKey) : null;

  const { data: providerRows, error: providerError } = await sb
    .from("watch_providers")
    .select("slug, label_tr, service_id")
    .order("sort_order", { ascending: true })
    .returns<ProviderRow[]>();

  if (providerError) {
    console.error("[generate] watch_providers okunamadı:", providerError);
    return fail("providers_query_failed");
  }

  const providers = providerRows ?? [];

  // ---- mode: services — TR'de tanınan servisleri dök ---------------------
  // watch_providers.service_id ELLE seed'leniyor (sağlayıcı zaten slug döndürdüğü
  // için runtime çözümleme yok). Yanlış ya da eksik bir service_id o platformu
  // seçen kullanıcının filtresini SESSİZCE boşaltır; bu mod o sessizliği bir
  // listeye çevirir. Premium platform filtresini yayına almadan ÖNCE çalıştır.
  if (mode === "services") {
    if (!watch) return fail("missing_watch_key", 400, "WATCH_API_KEY tanımlı değil");
    const services = await watch.trServices();
    const known = new Set(services.map((s) => s.id));
    return json({
      mode,
      watch_calls: watch.callCount,
      tr_services: services,
      // Seed'imiz sağlayıcıda YOK: o slug filtreye giremez, düzeltilmeli.
      unknown_service_ids: providers
        .filter((p) => p.service_id && !known.has(p.service_id))
        .map((p) => ({ slug: p.slug, service_id: p.service_id })),
      // Henüz bağlanmamış slug'lar: Ayarlar bunları göstermiyor.
      unmapped_slugs: providers.filter((p) => !p.service_id).map((p) => p.slug),
    });
  }

  // ---- mode: probe — Claude'suz erişilebilirlik denemesi -----------------
  if (mode === "probe") {
    if (!watch) return fail("missing_watch_key", 400, "WATCH_API_KEY tanımlı değil");
    const titles = Array.isArray(body.titles) ? body.titles : [];
    if (titles.length === 0) {
      return fail("no_titles", 400, "titles dizisi gerekli");
    }
    const serviceToSlug = new Map<string, string>();
    for (const p of providers) if (p.service_id) serviceToSlug.set(p.service_id, p.slug);

    const out = await mapLimit(titles.slice(0, 10), WATCH_CONCURRENCY, async (raw) => {
      const t = raw as Record<string, unknown>;
      const query = {
        title: typeof t.title === "string" ? t.title : "",
        title_en: typeof t.title_en === "string" ? t.title_en : undefined,
        year: typeof t.year === "number" ? t.year : null,
        media_type: t.media_type === "tv" ? ("tv" as const) : ("movie" as const),
      };
      const match = await watch.findWork(query);
      if (!match) {
        return { asked: query, found: false, free_path_url: justwatchSearchUrl(query.title) };
      }
      return {
        asked: query,
        found: true,
        matched: {
          show_id: match.show_id,
          media_type: match.media_type,
          title: match.title,
          original_title: match.original_title,
          year: match.year,
        },
        watchable_in_tr: match.options.length > 0,
        free_path_url: justwatchSearchUrl(query.title),
        options: match.options.map((o) => ({
          type: o.type,
          service_id: o.service_id,
          service_name: o.service_name,
          slug: serviceToSlug.get(o.service_id) ?? null,
          link: o.link,
        })),
      };
    });

    return json({ mode, watch_calls: watch.callCount, results: out });
  }

  // ---- hafta doğrulaması -----------------------------------------------
  const week = typeof body.week === "string" ? body.week.trim() : istanbulToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return fail("bad_week", 400, "week alanı YYYY-MM-DD biçiminde olmalı");
  }

  // ---- mode: digest — sahibe özet (veto penceresi) ----------------------
  if (mode === "digest") {
    const { data: rows } = await sb
      .from("weekly_picks")
      .select("user_id, status, films")
      .eq("week", week);

    const { data: candidates } = await sb.rpc("lens_weekly_pick_candidates", {
      p_week: week,
      p_limit: 500,
    });

    const drafts = (rows ?? []).filter((r) => r.status === "draft");
    // Özet, satırı OLMAYAN uygun kullanıcıları da adlandırmalı: boşluk
    // "yok" değil GÖRÜNÜR olmalı, yoksa eksik üretim sessizce kaybolur.
    const missing = Array.isArray(candidates) ? candidates.map((c) => c.user_id) : [];

    return json({
      mode,
      week,
      draft_count: drafts.length,
      total_rows: rows?.length ?? 0,
      by_status: (rows ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
      eligible_without_row: missing,
      titles: drafts.flatMap((r) =>
        (Array.isArray(r.films) ? r.films : []).map(
          (f: Record<string, unknown>) => `${f.title} (${f.year})`,
        ),
      ),
    });
  }

  // ---- normal üretim ---------------------------------------------------
  const dryRun = body.dry_run === true;
  const onlyUserId = typeof body.only_user_id === "string" ? body.only_user_id : null;
  const limit =
    typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
      ? Math.min(body.limit, 25)
      : MAX_USERS_PER_RUN;

  const { data: candidateRows, error: candidateError } = await sb.rpc(
    "lens_weekly_pick_candidates",
    { p_week: week, p_limit: limit, p_only_user_id: onlyUserId },
  );

  if (candidateError) {
    console.error("[generate] aday sorgusu hatası:", candidateError);
    return fail("candidates_query_failed");
  }

  const candidates = (Array.isArray(candidateRows) ? candidateRows : []) as {
    user_id: string;
    report_id: string;
    /** RPC ücretsiz pakette NULL döndürür — plan kapısı orada. */
    platforms: string[] | null;
  }[];

  const results: UserOutcome[] = [];
  let partial = false;

  for (const candidate of candidates) {
    // Öz-deadline: duvar saatine dayanmadan kendimiz duruyoruz. Yarım kalan
    // kullanıcılar satır almadığı için sonraki tik onları yine aday görür.
    if (Date.now() - startedAt > RUN_DEADLINE_MS) {
      partial = true;
      break;
    }

    try {
      const outcome = await generateForUser(sb, watch, anthropicKey, {
        userId: candidate.user_id,
        week,
        platforms: candidate.platforms,
        providers,
        dryRun,
      });
      results.push(outcome);
    } catch (err) {
      // Bir kullanıcının hatası döngüyü durdurmaz (send-weekly-picks'in döngü
      // şekliyle aynı). Satır yazılmadığı için sonraki tik tekrar dener.
      console.error(`[generate] ${candidate.user_id} başarısız:`, err);
      results.push({
        user_id: candidate.user_id,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const count = (status: UserOutcome["status"]) =>
    results.filter((r) => r.status === status).length;

  return json({
    week,
    dry_run: dryRun,
    considered: candidates.length,
    inserted: count("inserted"),
    dry_run_count: count("dry_run"),
    empty: count("empty"),
    raced: count("raced"),
    failed: count("failed"),
    partial,
    watch_key_present: Boolean(watch),
    elapsed_ms: Date.now() - startedAt,
    results,
  });
});
