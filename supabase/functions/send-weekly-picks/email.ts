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

export type PickFilm = {
  title: string;
  year: number;
  blurb: string;
  justwatch_url: string;
};

export type IntroVariant = "standart" | "sessiz";

export type RenderInput = {
  /** Boş olabilir — o zaman selamlama isimsiz kurulur. */
  name: string;
  films: PickFilm[];
  introVariant: IntroVariant;
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
 */
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function greeting(name: string): string {
  return name ? `Selam ${name}, Tolga ben.` : "Selam, Tolga ben.";
}

/**
 * Giriş paragrafı. Sistemleşse de kişisel his sürsün diye kurucu ağzından
 * yazılır — jenerik bülten dili buraya girmemeli.
 */
function intro(variant: IntroVariant): string {
  if (variant === "sessiz") {
    return "Lens'i denemiştin ya, aradan biraz zaman geçti. Bu arada haftada bir film seçkisi göndermeye başladım; seni de listeye aldım. Bu haftanınkiler şöyle.";
  }
  return "Lens'e yeni bir şey ekledim: haftada bir, sana yakın düşeceğini düşündüğüm birkaç filmi elimle seçip yolluyorum. Geçen günlerde rapor almıştın ya — bu hafta seçtiklerim şunlar.";
}

const CLOSING = "İzlersen ne düşündüğünü yaz — bu maile cevap versen doğrudan bana düşüyor.";

function subjectFor(count: number): string {
  return count === 1 ? "Bu hafta için bir film" : `Bu hafta için ${count} film`;
}

function filmBlockHtml(film: PickFilm): string {
  const title = escapeHtml(film.title);
  const year = Number.isFinite(film.year) ? String(film.year) : "";
  const blurb = escapeHtml(film.blurb);
  const url = safeUrl(film.justwatch_url);

  const heading = year
    ? `${title} <span style="color:#6b6577;font-weight:400;">(${escapeHtml(year)})</span>`
    : title;

  const link = url
    ? `<tr><td style="padding-top:10px;">
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
  const { name, films, introVariant, settingsUrl } = input;

  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f4f7;margin:0;padding:0;">
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
            ${escapeHtml(intro(introVariant))}
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
    intro(introVariant),
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
