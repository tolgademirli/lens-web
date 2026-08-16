// unsubscribe — haftalık seçki mailini tek dokunuşla kapatma.
//
// NEDEN AYRI VE JWT'SİZ BİR FONKSİYON:
// Mailin footer'ı bugüne kadar doğrudan tercih sayfasına gidiyordu; o sayfa
// (bugün /account, panel kabuğunun içinde) oturumu olmayan kullanıcıyı /login'e
// atıyor — tercihler panele taşındıktan sonra da böyle. Telefonda maili açan biri için
// "kapat" linki bu yüzden sekiyordu: login -> magic link bekle -> maile geri dön
// -> ayarları bul. Kullanıcıya "istemiyorsan kapat" deyip önüne üç adım koymak,
// kapatmayı değil SPAM İŞARETLEMEYİ kolaylaştırır — ve spam işareti bütün
// gönderimin teslim edilebilirliğine zarar verir.
//
// Bu endpoint imzalı token ile çalışır, oturum İSTEMEZ ve `List-Unsubscribe-Post`
// (RFC 8058 One-Click) desteğini açar — Gmail/Yahoo'nun toplu gönderenden
// beklediği şey. verify_jwt bu fonksiyon için config.toml'da kapatılır:
//   [functions.unsubscribe]
//   verify_jwt = false
// SADECE bu fonksiyon için. Çıplak bir [functions] bloğu beş fonksiyonun
// tamamının korumasını kaldırır.
//
// Vercel api/ katmanı bu iş için kullanılamaz: tasarımı gereği yalnızca anon
// anahtarını taşıyor (CLAUDE.md'de 3× belgeli) ve bu endpoint başka bir
// kullanıcının satırına yazmak zorunda.
//
// Gerekli secret: UNSUBSCRIBE_SECRET (openssl rand -hex 32)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUnsubscribeToken } from "../_shared/unsubscribe.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_SITE_URL = "https://lensestetik.com";

/**
 * Sayfanın paleti MAİLİN paletiyle aynı (uygulamanın koyu diliyle değil) — çünkü
 * kullanıcı buraya mailden geliyor ve sayfa o mailin devamı gibi okunmalı.
 * Harici CSS/font yok: tek dosya, tek istek, her yerde açılır.
 */
function page(title: string, body: string, siteUrl: string, status = 200): Response {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return new Response(
    `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Lens</title>
</head>
<body style="margin:0;padding:28px 12px;background:#f5f4f7;font-family:${sans};">
  <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
    <div style="font-size:13px;letter-spacing:3px;color:#6d4aae;">LENS</div>
    <h1 style="margin:20px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;
               font-weight:400;line-height:1.3;color:#1c1a22;">${title}</h1>
    <div style="margin-top:12px;font-size:16px;line-height:1.65;color:#43404d;">${body}</div>
    <div style="margin-top:26px;font-size:14px;">
      <a href="${siteUrl}" style="color:#6d4aae;">Lens'e dön →</a>
    </div>
  </div>
</body>
</html>`,
    { status, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const siteUrl = (Deno.env.get("SITE_URL") ?? DEFAULT_SITE_URL).replace(/\/$/, "");

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("UNSUBSCRIBE_SECRET");

  if (!supabaseUrl || !serviceKey || !secret) {
    console.error("[unsubscribe] eksik env");
    // Kullanıcıya teknik detay verilmez; ona düşen tek şey tekrar denemek.
    return page(
      "Şu an kapatamadım",
      "Teknik bir aksaklık oldu. Birazdan tekrar dener misin? " +
        "Ya da bu maili yanıtla, elle kapatırım.",
      siteUrl,
      500,
    );
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";

  // DOĞRULAMA YAZMADAN ÖNCE. Sıra tersine çevrilirse geçersiz token 403 alır ama
  // satır yine değişir — sessiz ve test edilmesi zor bir açık.
  const ok = await verifyUnsubscribeToken(userId, token, secret);
  if (!ok) {
    console.warn("[unsubscribe] geçersiz token");
    // One-Click POST'ta gövde okunmaz; sade 403 yeterli.
    if (req.method === "POST") {
      return new Response(null, { status: 403, headers: CORS });
    }
    return page(
      "Bu bağlantı geçerli değil",
      "Link eksik ya da bozulmuş olabilir — bazı mail istemcileri uzun bağlantıları " +
        "kırpıyor. Hesabım'dan da kapatabilirsin, ya da bu maili yanıtla; ben kapatırım.",
      siteUrl,
      403,
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Yalnızca bu iki kolon gönderilir. `plan` ASLA payload'a girmez: service_role
  // trigger'ın kilidini aşabilir, yani buradaki ihmal gerçek bir yetki hatası olurdu.
  const { error } = await sb
    .from("user_preferences")
    .upsert({ user_id: userId, weekly_picks_enabled: false }, { onConflict: "user_id" });

  if (error) {
    console.error("[unsubscribe] yazılamadı:", error);
    if (req.method === "POST") {
      // 5xx: mail istemcisi tekrar denesin. İşlem fikirdeş, tekrar zararsız.
      return new Response(null, { status: 500, headers: CORS });
    }
    return page(
      "Şu an kapatamadım",
      "Tercihini kaydedemedim. Birazdan tekrar dener misin? " +
        "Ya da bu maili yanıtla, elle kapatırım.",
      siteUrl,
      500,
    );
  }

  console.log("[unsubscribe] kapatıldı");

  // RFC 8058 One-Click: gövde beklenmez, 200 yeterli. Zaten kapalı bir kullanıcı
  // da 200 alır — işlem fikirdeş, mail istemcileri tekrar deneyebilir.
  if (req.method === "POST") {
    return new Response(null, { status: 200, headers: CORS });
  }

  return page(
    "Kapattım.",
    "Bundan sonra haftalık film ve dizi seçkisi göndermeyeceğim. " +
      "Fikrin değişirse Hesabım'dan tekrar açabilirsin — seçkiler kaldığı yerden devam eder.",
    siteUrl,
  );
});
