// Haftalık seçki mailinin HTML + düz metin render'ı.
//
// Kurallar (deliverability kararı — değiştirmeden önce oku):
//   - Harici CSS YOK. Mail istemcileri <style> bloğunu ve harici stylesheet'i
//     yutar; her kural inline olmak zorunda.
//   - Görsel/afiş YOK. Harici resim Gmail'de Promotions sekmesi riskini artırır;
//     seçki inbox'ta kalsın diye sade tutuluyor. Sadece metin + JustWatch linki.
//   - Layout table tabanlı: flex/grid Outlook'ta çöker.
//   - HTML ile düz metin AYNI içeriği taşır. Metin sürümü hem erişilebilirlik
//     hem spam skoru için gerçek bir fallback, dolgu değil.
//   - Linkler düz metin-benzeri kalır (altı çizili, sakin renk). Büyük renkli
//     buton (CTA) Promotions sınıflandırmasını besler — eklenmez.
//   - HTML'in en başındaki gizli preheader, liste önizlemesinde çıkan satırdır;
//     gövdede çıplak görünmemesi için display:none + sıfır yükseklik şart.

export type PickFilm = {
  title: string;
  year: number;
  blurb: string;
  justwatch_url: string;
};

/**
 * `weekly_picks.intro_variant` kolonu duruyor ve index.ts hâlâ okuyup PostHog'a
 * yolluyor — ama ŞABLON ARTIK OKUMUYOR. İkinci haftadan itibaren herkes aynı
 * grupta (geçen hafta seçki almış kullanıcılar), tek giriş metni yetiyor.
 * Tip, kolonun ileride yeniden kullanılma ihtimali için korunuyor.
 */
export type IntroVariant = "standart" | "sessiz";

export type RenderInput = {
  /** Boş olabilir — o zaman selamlama isimsiz kurulur. */
  name: string;
  films: PickFilm[];
  /** Tercih sayfasının tam URL'i (mail içi kapatma linki). */
  settingsUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Seçkiler elle giriliyor; bir gün yanlışlıkla `javascript:` ya da bozuk bir
 * değer yapıştırılırsa mailde tıklanabilir kalmasın.
 *
 * Şemasız değere (`justwatch.com/...`) tolerans var: elle girişte en sık yapılan
 * hata bu ve eskiden sessizce düşüyordu — 7 Ağustos 2026 seçkisinde üç filmin de
 * "Nerede izlenir" satırı bu yüzden mailden kayboldu. https varsayıyoruz.
 *
 * Tahmin iki yerde sınırlanıyor:
 *   - Şema VARSA dokunulmuyor; http/https değilse yine reddediliyor (javascript: vb.).
 *   - Host'ta nokta şartı var; yoksa "yok"/"bilinmiyor" gibi bir not
 *     `https://yok/` diye geçerli ama kırık bir linke dönüşürdü.
 */
function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Ad kaynağa göre "beyza" ya da "BEYZA" gelebiliyor: Google metadata'sı serbest
 * metin, e-posta yerel kısmı ise hep küçük harf. Selamlamada özel isim büyük
 * harfle başlasın.
 *
 * Türkçe locale ŞART: "ismail" → "İsmail" (İngilizce locale "Ismail" verir),
 * "ışıl" → "Işıl". Bunu index.ts'e bırakmıyoruz; şablon adın nereden geldiğini
 * bilmemeli, her yolda doğru görünmeli.
 */
function properName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  // Tümü büyükse bağırıyor demektir — yalnızca o durumda gerisini küçültüyoruz.
  // "Ayşe Nur", "McKenzie" gibi bilinçli iç büyük harfler bozulmasın.
  const body =
    trimmed === trimmed.toLocaleUpperCase("tr-TR") ? trimmed.toLocaleLowerCase("tr-TR") : trimmed;
  return body.charAt(0).toLocaleUpperCase("tr-TR") + body.slice(1);
}

function greeting(name: string): string {
  const proper = properName(name);
  return proper ? `Selam ${proper}, Tolga ben.` : "Selam, Tolga ben.";
}

/**
 * Konu, giriş ve preheader AYNI sayıyı söyler; üçü de buradan geçer. Seçki elle
 * giriliyor, film sayısı haftadan haftaya değişebilir — sabit "üç" yazılırsa mail
 * kendiyle çelişir. Listede olmayan bir sayı gelirse rakama düşer; mail hiçbir
 * koşulda boş ya da "undefined film" demez.
 */
const COUNT_WORDS = ["bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz", "on"];

function countWord(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > COUNT_WORDS.length) return String(count);
  return COUNT_WORDS[count - 1];
}

/**
 * Giriş paragrafı. Sistemleşse de kişisel his sürsün diye kurucu ağzından
 * yazılır — jenerik bülten/tanıtım dili buraya girmemeli. Tek metin: varyant yok.
 */
function intro(count: number): string {
  return `Bu haftanın seçkisi hazır — sana göre olduğunu düşündüğüm ${countWord(count)} film:`;
}

const CLOSING =
  "İçlerinden birini izlersen bana yaz, merak ediyorum. Geçen haftakilerden bir şey izledin mi?";

/**
 * Gmail/Apple Mail'in liste önizlemesinde çıkan satır. Gövdede görünmemesi için
 * hem display:none hem sıfır yükseklik/opaklık; ardından gelen görünmez dolgu,
 * istemcinin önizlemeye maili gövdesinden devam ettirmesini engeller.
 *
 * Tek filmde sayı düşer: "Bu haftanın bir filmi" Türkçede tökezliyor.
 */
function preheader(count: number): string {
  const what = count === 1 ? "filmi" : `${countWord(count)} filmi`;
  return `Bu haftanın ${what} — sana göre seçtim.`;
}

const PREHEADER_PAD = "&#847;&zwnj;&nbsp;".repeat(60);

function subjectFor(count: number): string {
  return `Bu hafta için ${countWord(count)} film`;
}

function filmBlockHtml(film: PickFilm): string {
  const title = escapeHtml(film.title);
  const year = Number.isFinite(film.year) ? String(film.year) : "";
  const blurb = escapeHtml(film.blurb);
  const url = safeUrl(film.justwatch_url);

  const heading = year
    ? `${title} <span style="color:#6b6577;font-weight:400;">(${escapeHtml(year)})</span>`
    : title;

  // Buton değil, altı çizili metin linki — renkli CTA bloğu Gmail'in "promosyon"
  // sinyallerinden. Ama rengi gövde metninden AYRI kalmalı: bir kez #43404d
  // yapıldı ve blurb rengiyle aynı düştüğü için link görünmez oldu. Sadeleştirmenin
  // sınırı burası; tıklanabilirlik feda edilmez.
  const link = url
    ? `<tr><td style="padding-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
           <a href="${escapeHtml(url)}" style="color:#6d4aae;text-decoration:underline;font-size:14px;">Nerede izlenir →</a>
         </td></tr>`
    : "";

  return `
    <tr>
      <td style="padding:0 0 26px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.35;color:#1c1a22;">
              ${heading}
            </td>
          </tr>
          <tr>
            <td style="padding-top:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#43404d;">
              ${blurb}
            </td>
          </tr>
          ${link}
        </table>
      </td>
    </tr>`;
}

export function renderWeeklyPicksEmail(input: RenderInput): RenderedEmail {
  const { name, films, settingsUrl } = input;

  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  const html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f4f7;opacity:0;">${escapeHtml(preheader(films.length))}${PREHEADER_PAD}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f4f7;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;">
        <tr>
          <td style="padding:28px 28px 0 28px;font-family:${sans};font-size:13px;letter-spacing:3px;color:#6d4aae;">
            LENS
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 0 28px;font-family:${sans};font-size:16px;line-height:1.65;color:#2b2833;">
            ${escapeHtml(greeting(name))}
          </td>
        </tr>
        <tr>
          <td style="padding:12px 28px 0 28px;font-family:${sans};font-size:16px;line-height:1.65;color:#43404d;">
            ${escapeHtml(intro(films.length))}
          </td>
        </tr>
        <tr>
          <td style="padding:26px 28px 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${films.map(filmBlockHtml).join("")}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px;font-family:${sans};font-size:15px;line-height:1.65;color:#43404d;">
            ${escapeHtml(CLOSING)}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 30px 28px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#2b2833;">
            — Tolga
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
        <tr>
          <td style="padding:16px 28px 0 28px;font-family:${sans};font-size:12px;line-height:1.6;color:#8a8494;">
            Bu önerileri almak istemiyorsan
            <a href="${escapeHtml(settingsUrl)}" style="color:#8a8494;text-decoration:underline;">buradan kapatabilirsin</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  const textFilms = films
    .map((film) => {
      const year = Number.isFinite(film.year) ? ` (${film.year})` : "";
      const url = safeUrl(film.justwatch_url);
      const where = url ? `\nNerede izlenir: ${url}` : "";
      return `${film.title}${year}\n${film.blurb}${where}`;
    })
    .join("\n\n");

  const text = [
    greeting(name),
    "",
    intro(films.length),
    "",
    textFilms,
    "",
    CLOSING,
    "",
    "— Tolga",
    "",
    "—",
    `Bu önerileri almak istemiyorsan buradan kapatabilirsin: ${settingsUrl}`,
  ].join("\n");

  return { subject: subjectFor(films.length), html, text };
}
