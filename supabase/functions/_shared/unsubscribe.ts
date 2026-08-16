// Haftalık seçki mailinin "kapat" linkinin imzası.
//
// NEDEN PAYLAŞILAN MODÜL: token'ı send-weekly-picks ÜRETİR, unsubscribe DOĞRULAR.
// İki kopya HMAC, yayına çıkmış her linki sessizce bozacak türden bir ayrışmadır —
// mail gönderildikten sonra fark edilir ve geri alınamaz.
//
// NEDEN GEREKLİ: mailin footer'ı tercih sayfasına gitseydi (bugün /account, panel
// kabuğunun içinde) o sayfa oturumu olmayan kullanıcıyı /login'e atardı. Telefonunda maili açan biri için
// "kapat" linki bu yüzden sekiyor: login -> magic link bekle -> maile dön -> ayarlar.
// Kullanıcıya "istemiyorsan kapat" deyip önüne üç adım koymak, kapatmayı değil
// spam işaretlemeyi kolaylaştırır.

/** HMAC'in imzaladığı düzlem. Amaç ayrımı: aynı sır ileride başka bir mail türü
 *  için kullanılırsa, bir listenin token'ı diğerinde geçerli OLMAMALI. */
const SCOPE = "weekly_picks";

function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${SCOPE}:${userId}`),
  );
  return base64url(new Uint8Array(mac));
}

/**
 * Kullanıcıya ait kapatma token'ı.
 *
 * SÜRE YOK ve bu bilinçli: maildeki bir link aylar sonra da çalışmalı, yoksa
 * "kapat"a basan kullanıcı hata sayfası görür ve gerçekten kapatamaz. RFC 8058
 * semantiği tam olarak "bu linki tutan bu adresi listeden çıkarabilir" — burada
 * korunması gereken şey oturum değil, BAŞKASININ token'ının uydurulamaması. Onu
 * da HMAC sağlıyor.
 */
export function unsubscribeToken(userId: string, secret: string): Promise<string> {
  return sign(userId, secret);
}

/** Mailin footer'ına ve List-Unsubscribe header'ına giren tam URL. */
export async function unsubscribeUrl(
  functionsBaseUrl: string,
  userId: string,
  secret: string,
): Promise<string> {
  const token = await sign(userId, secret);
  const base = functionsBaseUrl.replace(/\/$/, "");
  return `${base}/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

/**
 * Token doğrulama. Karşılaştırma SABİT ZAMANLI: erken çıkan bir eşitlik kontrolü,
 * doğru öneki ölçerek token'ı karakter karakter tahmin etmeye kapı açar.
 *
 * Uzunluk farkı erken dönüyor — SHA-256'nın base64url'ü her zaman 43 karakter,
 * yani uzunluk bir sır taşımıyor.
 */
export async function verifyUnsubscribeToken(
  userId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  if (!userId || !token) return false;
  const expected = await sign(userId, secret);
  if (token.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
