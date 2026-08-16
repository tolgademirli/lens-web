// Haftalık seçki mailinin HTML + düz metin render'ı.
//
// Kurallar (deliverability kararı — değiştirmeden önce oku):
//   - Harici CSS YOK. Mail istemcileri <style> bloğunu ve harici stylesheet'i
//     yutar; her kural inline olmak zorunda.
//   - Görsel/afiş YOK. Harici resim Gmail'de Promotions sekmesi riskini artırır;
//     seçki inbox'ta kalsın diye sade tutuluyor. Sadece metin + izleme linki.
//   - Layout table tabanlı: flex/grid Outlook'ta çöker.
//   - HTML ile düz metin AYNI içeriği taşır. Metin sürümü hem erişilebilirlik
//     hem spam skoru için gerçek bir fallback, dolgu değil.
//   - Linkler düz metin-benzeri kalır (altı çizili, sakin renk). Büyük renkli
//     buton (CTA) Promotions sınıflandırmasını besler — eklenmez.
//   - HTML'in en başındaki gizli preheader, liste önizlemesinde çıkan satırdır;
//     gövdede çıplak görünmemesi için display:none + sıfır yükseklik şart.
//   - LİNK TAVANI 5: 3 izleme linki + 1 panel (geri bildirim) + 1 kapatma. Bu bir
//     karar, tercih değil — çok link Promotions sınıflandırmasını besler. Yeni bir
//     link eklenecekse mevcut birinin çıkması gerekir. Erişilebilirlik künyesi
//     (movieofthenight) bu yüzden maile DEĞİL Hesabım ekranına konuyor.

export type PickFilm = {
  title: string;
  year: number;
  blurb: string;

  /**
   * İzleme linki. İKİ ALAN VAR ve ikisi de opsiyonel:
   *   * `watch_url`  — v2 (generate-weekly-picks). Premium yolda servise doğrudan
   *     deep link, ücretsiz yolda JustWatch ARAMA linki.
   *   * `justwatch_url` — v1, elle girilmiş satırlar. Tek okuyucu `watchUrl()`.
   * Eski satırların alan adını yeniden yazmıyoruz: films JSONB'sine dokunmak
   * geri bildirim slot'larını (dizi indeksi) riske atar.
   */
  watch_url?: string;
  justwatch_url?: string;

  /**
   * v2 alanları (generate-weekly-picks üretir). HEPSİ OPSİYONEL: elle girilmiş
   * eski satırlarda yoktur ve o satırlar mailde birebir eskisi gibi görünmelidir.
   * media_type yokken "film" varsayılır.
   *
   * providers/offer_type ÜCRETSİZ YOLDA DA YOKTUR: erişilebilirlik API'si yalnızca
   * platform filtresi olan (premium) kullanıcı için çağrılıyor, dolayısıyla o
   * bilgiye sahip değiliz ve mailde iddia etmiyoruz.
   */
  media_type?: "movie" | "tv";
  /** watch_providers.slug listesi. Görünen ada RenderInput.providerLabels çevirir. */
  providers?: string[];
  offer_type?: "subscription" | "free" | "buy" | "rent" | "addon" | "off_platform";
};

/** v2 alanı önce, v1 yedek. Boş string "link yok" demektir. */
const watchUrl = (film: PickFilm): string => film.watch_url || film.justwatch_url || "";

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
  /**
   * Tercih sayfası. ARTIK FOOTER'IN ANA LİNKİ DEĞİL: oturum ister ve maili
   * telefonda açan kullanıcıyı /login'e düşürür. Yalnızca unsubscribeUrl
   * verilmediğinde (eski çağrı yolu) yedek olarak kullanılır.
   */
  settingsUrl: string;
  /**
   * İmzalı tek-dokunuş kapatma URL'i (functions/unsubscribe). Oturum gerektirmez.
   * Verilmezse footer settingsUrl'e düşer — davranış eskisi gibi olur.
   */
  unsubscribeUrl?: string;
  /** Panel URL'i — geri bildirim çağrısının bağlandığı yer. */
  dashboardUrl?: string;
  /** watch_providers.slug -> label_tr. Sözlük DB'de; şablon çeviri yapmaz, okur. */
  providerLabels?: Record<string, string>;
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

/** "film" | "dizi" — media_type yoksa (v1 satır) film varsayılır. */
type MediaKind = "film" | "dizi";

const kindOf = (film: PickFilm): MediaKind => (film.media_type === "tv" ? "dizi" : "film");

/**
 * İYELİK EKİ BİR LOOKUP'TAN GELİR, STRING BİRLEŞTİRMEDEN DEĞİL:
 * film -> filmi ama dizi -> dizisi. `${kind}i` yazmak "dizii" üretir.
 * Aynı ders posterdeki toLocaleUpperCase("tr-TR") kuralıyla aynı — Türkçe
 * morfolojisini string concat'e bırakma.
 */
const POSSESSIVE: Record<MediaKind, string> = { film: "filmi", dizi: "dizisi" };

type MediaMix =
  | { kind: MediaKind; count: number }
  | { kind: "mixed"; films: number; series: number };

function mediaMix(films: PickFilm[]): MediaMix {
  const series = films.filter((f) => kindOf(f) === "dizi").length;
  const movies = films.length - series;
  if (series === 0) return { kind: "film", count: movies };
  if (movies === 0) return { kind: "dizi", count: series };
  return { kind: "mixed", films: movies, series };
}

/** "üç film" | "üç dizi" | "iki film, bir dizi" */
function mixPhrase(mix: MediaMix): string {
  if (mix.kind === "mixed") {
    return `${countWord(mix.films)} film, ${countWord(mix.series)} dizi`;
  }
  return `${countWord(mix.count)} ${mix.kind}`;
}

/**
 * Preheader için iyelikli hâli: "üç filmi" | "iki filmi, bir dizisi".
 * Tek öğede sayı DÜŞER — "Bu haftanın bir filmi" Türkçede tökezliyor
 * (mevcut kural, eski preheader'da da böyleydi).
 */
function mixPossessive(mix: MediaMix): string {
  if (mix.kind === "mixed") {
    return `${countWord(mix.films)} ${POSSESSIVE.film}, ${countWord(mix.series)} ${POSSESSIVE.dizi}`;
  }
  const noun = POSSESSIVE[mix.kind];
  return mix.count === 1 ? noun : `${countWord(mix.count)} ${noun}`;
}

/**
 * Giriş paragrafı. Sistemleşse de kişisel his sürsün diye kurucu ağzından
 * yazılır — jenerik bülten/tanıtım dili buraya girmemeli. Tek metin: varyant yok.
 */
function intro(mix: MediaMix): string {
  return `Bu haftanın seçkisi hazır — sana göre olduğunu düşündüğüm ${mixPhrase(mix)}:`;
}

/**
 * Geri bildirim çağrısı — mailde TEK istek var ve o da panele işaret eder.
 *
 * "İçlerinden birini izlersen bana yaz" cümlesi KALDIRILDI (2026-08-17): geri
 * bildirimi zaten panel topluyor (US-05 kartları), maile ikinci bir kanal koymak
 * kullanıcıdan iki ayrı şey istemek demekti — ve cevabı motorun okuyamadığı bir
 * yere (posta kutusu) çağırıyordu. Aynı cümle "geçen haftakiler"i de varsayıyordu;
 * ilk seçkisini alan kullanıcıda karşılığı yoktu.
 *
 * "Sessizlik, okumakta en çok zorlandığım cevap" da kaldırıldı: geri bildirim
 * vermeyeni suçlayan bir ton. İstek bir kez, sitemsiz söylenir.
 *
 * "Panelde" tek bir birinci-parti linke bağlanır (bkz. dosya başındaki link tavanı):
 * yolu olmayan bir geri bildirim çağrısı dekoratiftir.
 */
const FEEDBACK_NOTE_PREFIX = "";
const FEEDBACK_LINK_TEXT = "Panelde";
const FEEDBACK_NOTE_SUFFIX =
  " bu kartlara ilgimi çekti ya da bana göre değil demen, bir sonraki seçkiyi " +
  "gerçekten keskinleştiriyor.";

/** Link yoksa (dashboardUrl verilmemiş) aynı cümle linksiz kurulur. */
const FEEDBACK_NOTE_PLAIN = `${FEEDBACK_LINK_TEXT}${FEEDBACK_NOTE_SUFFIX}`;

/**
 * Gmail/Apple Mail'in liste önizlemesinde çıkan satır. Gövdede görünmemesi için
 * hem display:none hem sıfır yükseklik/opaklık; ardından gelen görünmez dolgu,
 * istemcinin önizlemeye maili gövdesinden devam ettirmesini engeller.
 *
 * Tek öğede sayı düşer: "Bu haftanın bir filmi" Türkçede tökezliyor.
 */
function preheader(mix: MediaMix): string {
  return `Bu haftanın ${mixPossessive(mix)} — sana göre seçtim.`;
}

const PREHEADER_PAD = "&#847;&zwnj;&nbsp;".repeat(60);

function subjectFor(mix: MediaMix): string {
  return `Bu hafta için ${mixPhrase(mix)}`;
}

/**
 * Link satırının önündeki düz metin: "Netflix · Nerede izlenir →".
 *
 * Platform adı ÖNE ve DÜZ METİN olarak konuyor — "Netflix'te izle" gibi bir kurgu
 * ünlü uyumu ve kesme işareti gerektirir ("MUBI'de", "Exxen'de", "BluTV'de") ve
 * bunu marka adına makine olarak eklemek Türkçede güvenilir değil. Ayrım noktası
 * bütün ekleri gereksiz kılıyor.
 *
 * Bilinmeyen slug sessizce düşer: yanlış bir platform adı yazmaktan iyidir.
 */
function offerPrefix(film: PickFilm, labels: Record<string, string>): string {
  const names = () => (film.providers ?? []).map((s) => labels[s]).filter(Boolean);

  switch (film.offer_type) {
    case "subscription":
      return names().join(", ");
    case "free":
      // Sağlayıcının 'free'si reklamlı katalogları da kapsıyor; ikisini de
      // "Ücretsiz" diye söylüyoruz — kullanıcı için fark, para ödemediği.
      return "Ücretsiz";
    case "rent":
    case "buy":
      return "Kiralık";
    case "addon": {
      // Ana serviste satın alınan EK KANAL (örn. Prime Video üzerinden MUBI).
      // "Prime Video" demek yanıltıcı olurdu: o platforma abone olmak yetmiyor.
      const list = names();
      return list.length ? `${list.join(", ")} · ek kanal` : "Ek kanal aboneliği";
    }
    case "off_platform":
      return "Seçtiklerinin dışında";
    default:
      // v1 satır ya da ücretsiz yol: offer_type yok, satır çıplak link olur.
      return "";
  }
}

function filmBlockHtml(film: PickFilm, labels: Record<string, string>): string {
  const title = escapeHtml(film.title);
  const year = Number.isFinite(film.year) ? String(film.year) : "";
  const blurb = escapeHtml(film.blurb);
  const url = safeUrl(watchUrl(film));

  // Dizi olduğunu başlıkta söylüyoruz: kullanıcı bir akşamlık mı yoksa bir sezonluk
  // mu bir şeye baktığını linke tıklamadan bilmeli. Film varsayılan olduğu için
  // etiketlenmiyor — her satıra "film" yazmak gürültü.
  const meta = [year, kindOf(film) === "dizi" ? "dizi" : ""].filter(Boolean).join(" · ");
  const heading = meta
    ? `${title} <span style="color:#6b6577;font-weight:400;">(${escapeHtml(meta)})</span>`
    : title;

  const prefix = offerPrefix(film, labels);

  // Buton değil, altı çizili metin linki — renkli CTA bloğu Gmail'in "promosyon"
  // sinyallerinden. Ama rengi gövde metninden AYRI kalmalı: bir kez #43404d
  // yapıldı ve blurb rengiyle aynı düştüğü için link görünmez oldu. Sadeleştirmenin
  // sınırı burası; tıklanabilirlik feda edilmez.
  const link = url
    ? `<tr><td style="padding-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6b6577;">
           ${prefix ? `${escapeHtml(prefix)} &middot; ` : ""}<a href="${escapeHtml(url)}" style="color:#6d4aae;text-decoration:underline;font-size:14px;">Nerede izlenir →</a>
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
  const labels = input.providerLabels ?? {};
  const mix = mediaMix(films);

  // Kapatma linki: imzalı endpoint varsa O kullanılır. Yoksa eski davranışa
  // (tercih sayfası) düşer — çağıran güncellenmemişse mail bozulmaz.
  const closeUrl = safeUrl(input.unsubscribeUrl ?? "") ?? settingsUrl;
  const oneTap = Boolean(safeUrl(input.unsubscribeUrl ?? ""));
  const dashUrl = safeUrl(input.dashboardUrl ?? "");

  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  // "giriş yapmana gerek yok" düzeltmenin bütün noktası, sade biçimde söylenmiş:
  // telefonda şifre isteyecek bir linke dokunmama refleksini de önler.
  const closeSentenceHtml = oneTap
    ? `Bu önerileri almak istemiyorsan
       <a href="${escapeHtml(closeUrl)}" style="color:#8a8494;text-decoration:underline;">buradan tek dokunuşla kapatabilirsin</a>
       — giriş yapmana gerek yok.`
    : `Bu önerileri almak istemiyorsan
       <a href="${escapeHtml(closeUrl)}" style="color:#8a8494;text-decoration:underline;">buradan kapatabilirsin</a>.`;

  const closeSentenceText = oneTap
    ? `Bu önerileri almak istemiyorsan tek dokunuşla kapatabilirsin (giriş gerekmez): ${closeUrl}`
    : `Bu önerileri almak istemiyorsan buradan kapatabilirsin: ${closeUrl}`;

  const feedbackHtml = dashUrl
    ? `${escapeHtml(FEEDBACK_NOTE_PREFIX)}<a href="${escapeHtml(dashUrl)}" style="color:#6d4aae;text-decoration:underline;">${escapeHtml(FEEDBACK_LINK_TEXT)}</a>${escapeHtml(FEEDBACK_NOTE_SUFFIX)}`
    : escapeHtml(FEEDBACK_NOTE_PLAIN);

  const html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f5f4f7;opacity:0;">${escapeHtml(preheader(mix))}${PREHEADER_PAD}</div>
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
            ${escapeHtml(intro(mix))}
          </td>
        </tr>
        <tr>
          <td style="padding:26px 28px 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${films.map((film) => filmBlockHtml(film, labels)).join("")}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px;font-family:${sans};font-size:15px;line-height:1.65;color:#43404d;">
            ${feedbackHtml}
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
            ${closeSentenceHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  // Düz metin sürüm HTML ile AYNI içeriği taşır: hem erişilebilirlik hem spam
  // skoru için gerçek bir fallback, dolgu değil.
  const textFilms = films
    .map((film) => {
      const meta = [
        Number.isFinite(film.year) ? String(film.year) : "",
        kindOf(film) === "dizi" ? "dizi" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const head = meta ? `${film.title} (${meta})` : film.title;
      const url = safeUrl(watchUrl(film));
      const prefix = offerPrefix(film, labels);
      const where = url
        ? `\n${prefix ? `${prefix} · ` : ""}Nerede izlenir: ${url}`
        : "";
      return `${head}\n${film.blurb}${where}`;
    })
    .join("\n\n");

  const feedbackText = dashUrl
    ? `${FEEDBACK_NOTE_PLAIN}\n${dashUrl}`
    : FEEDBACK_NOTE_PLAIN;

  const text = [
    greeting(name),
    "",
    intro(mix),
    "",
    textFilms,
    "",
    feedbackText,
    "",
    "— Tolga",
    "",
    "—",
    closeSentenceText,
  ].join("\n");

  return { subject: subjectFor(mix), html, text };
}
