// Günlük keşifteki kitap ve film GERÇEKTEN var mı, o yaratıcıya mı ait, ve kartta
// yazacak ad doğru mu?
//
// NEDEN VAR: 11 Ekim 2026'da keşif bir kullanıcıya "Şeytan ve İyi Yürekli İnsan —
// Ahmet Hamdi Tanpınar" önerdi. Böyle bir kitap yok; kartta bunu gerçeğinden ayıracak
// hiçbir şey yoktu. Ardından ölçtük (uzun ÖNERME listesi + "niş" yönelimi, yani uzun
// süredir kullanan birinin prompt'u) ve iki ayrı hata biçimi çıktı:
//
//   1. YANLIŞ YAKIŞTIRMA. Eski prompt 8 kitabın 6'sını yanlış verdi: Füruzan'ın
//      "Gecenin Öteki Yüzü"nü Ahmet Oktay'a, "Mızraklı İlmihal"i Abdülhak Şinasi
//      Hisar'a yazdı; filmde "Otomatik Portakal — Theo Angelopoulos" çıktı. Tipik
//      hata uydurma bir ad değil, GERÇEK bir yaratıcıya yanlış eser.
//   2. UYDURMA TÜRKÇE AD. Prompt'a "yalnızca gerçek eser" kuralı gelince model gerçek
//      eser seçmeye başladı ama Türkçe adını kendi çevirdi: "Im Lauf der Zeit"e
//      "Avrupa'nın Ortasında", "Faces"e "Gecenin Yüzü" dedi. Eser gerçek, kartta
//      yazan ad değil — kullanıcı o adla aradığında yine hiçbir şey bulamaz.
//
// Kural oranı düşürdü, sıfırlamadı. Yasak kümede olduğu gibi burada da prompt ipucu,
// kod otorite.
//
// NASIL: model her kitap ve film için özgün adı da veriyor. Önce KARTTA GÖRÜNECEK ad
// sınanır; o tutmazsa özgün ad. Sonuç dört hâlden biri (bkz. Verdict) ve çağıran
// "original" gelince kartta özgün adı gösterir — yanlış bir Türkçe ad yerine doğru
// bir yabancı ad. Bunun bedeli: gerçek Türkçe adı kataloglarda kayıtlı olmayan
// eserler de özgün adıyla görünür ("Faces", "Nuit et Brouillard").
//
// KATALOGLAR — anahtarsız, ücretsiz, ve adı YARATICIYLA BİRLİKTE sorguluyorlar.
// Yalnızca ada bakan bir arama yanlış yakıştırmayı yakalayamaz.
//   Open Library (kitap): ad + yazar alanlarıyla arama. Türkçe yazılmış kitaplarda
//     güçlü (35'te 31), çevirilerin Türkçe baskısında zayıf ("Usta ile Margarita",
//     "Gönülçelen" → 0).
//   Wikidata (kitap ve film): yaratıcının kimliği + ona bağlı kayıtların etiketlerinde
//     ad araması. Çevirilerin Türkçe adında güçlü — Open Library'nin kaçırdıklarını
//     buldu; niş Türkçe kitaplarda zayıf ("Tol" → 0). İkisi birbirini tamamlıyor,
//     kitap ikisinden biri bulursa bulunmuş sayılır.
//   Ölçüm (elle kurulmuş liste): çok sözcüklü 30'dan fazla uydurma/yanlış yakıştırma
//     adın hiçbiri geçmedi; yakın ama yanlış adlar da ("Gecenin Sonunda", doğrusu
//     "Gecenin Sonuna Yolculuk") reddedildi.
//
// BİLİNEN DELİK: Wikidata araması sözcük bazlı. Uydurma ad, aynı yaratıcının gerçek
// bir eserinin adındaki sözcüklerden ibaretse geçer ("Kış — Nuri Bilge Ceylan",
// "Kış Uykusu"na tutunuyor). Kapatmak etiketleri ayrıca çekip eşitlik aramayı
// gerektirir.
//
// DENENİP ELENENLER: Google Books (anahtarsız ilk istekte 429). Wikipedia tam metin
// araması — KISA uydurma adları geçiriyor ("Akşam" + "Abasıyanık" → 26 sonuç; sözcük
// yazarın maddesinde nasılsa geçiyor). TMDB lisans yüzünden terk edildi, movieofthenight
// ücretli ve yalnızca platform filtresi için çağrılıyor.
//
// KAÇIRILAN GERÇEK ESER zarar değil maliyettir: yerine BAŞKA bir gerçek eser önerilir,
// bedeli bir Claude çağrısı. Tersi (uydurmayı geçirmek) yanlış bilgidir. Kapıyı
// gevşetirken bu asimetriyi koru.
//
// MÜZİK BURADA YOK: slot yalnızca sanatçı adı taşıyor, yakıştırılacak bir eser yok.
// Orada görülen hata başka türden (müzisyen olmayan gerçek biri: "Attila İlhan",
// "Markus Zusak") ve yalnızca prompt kuralına dayanıyor.

const OPEN_LIBRARY = "https://openlibrary.org/search.json";
const WIKIDATA = "https://www.wikidata.org/w/api.php";

// Kullanıcı panelde bekliyor; yavaş bir katalog keşfi geciktirmemeli. İki servis de
// tipik olarak 250-900 ms'de dönüyor.
const TIMEOUT_MS = 4000;

// İki servis de kimliğini söylemeyen istemciyi kısıyor (Wikimedia'da bu bir kural).
const HEADERS = { "User-Agent": "Lens/1.0 (https://lensestetik.com)" };

/** Wikidata özellikleri: bir kaydı yaratıcısına bağlayan ifade. */
const AUTHOR = "P50";
const DIRECTOR = "P57";

/**
 * Tek bir adın tek bir sorgudaki sonucu.
 *
 * `unknown` = sorulamadı (zaman aşımı, 5xx, tanınmayan yönetmen). `not_found`
 * DEĞİLDİR: katalog ayakta değil diye öneriyi reddetmek, kesintiyi kullanıcıya
 * fazladan Claude çağrısı ya da boş kart olarak yansıtırdı. O yüzden buradaki her
 * hata LOGLANIR — sessizce `unknown` dönen bir katalog, kapının hiç çalışmaması demek.
 */
type Lookup = "found" | "not_found" | "unknown";

/**
 * Bir eserin hükmü.
 *   title     — kartta görünecek ad doğrulandı; dokunma.
 *   original  — kartta görünecek ad BULUNAMADI ama özgün ad bulundu: eser gerçek, ad
 *               şüpheli. Çağıran kartta özgün adı gösterir.
 *   not_found — ikisi de yok. Çağıran öneriyi geri çevirir.
 *   unknown   — karar verilemedi; çağıran öneriyi olduğu gibi geçirir (fail-open).
 */
export type Verdict = "title" | "original" | "not_found" | "unknown";

export type WorkToCheck = { title: string; creator: string; originalTitle?: string };

/**
 * Aranacak ad: sondaki parantez ve alt başlık atılır.
 *   "Huzur (roman)" → "Huzur" — model bazen tür ya da yıl ekliyor.
 *   "Sapiens: İnsan Türünün Kısa Bir Tarihi" → "Sapiens" — Open Library alt başlığı
 *   ayrı alanda tutuyor; başlık aramasında alt başlığın sözcükleri eşleşmiyor ve
 *   gerçek kitap "yok" çıkıyor (ölçüldü).
 */
function cleanTitle(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").split(":")[0].trim();
}

async function getJson(url: string, label: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[work-check] ${label} ${res.status} döndü`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[work-check] ${label} sorgulanamadı:`, err);
    return null;
  }
}

/**
 * Önce kartta görünecek ad, tutmazsa özgün ad.
 *
 * Özgün ada yalnızca kartta görünecek ad için KESİN "yok" alındıysa dönülür. O sorgu
 * yapılamadıysa (zaman aşımı) ad şüpheli değil, yalnızca sınanmamıştır — bir kesinti
 * yüzünden doğru bir Türkçe adı yabancısıyla değiştirmiyoruz.
 */
async function judge(work: WorkToCheck, lookup: (title: string) => Promise<Lookup>): Promise<Verdict> {
  const title = cleanTitle(work.title);
  const original = cleanTitle(work.originalTitle ?? "");

  const shown = await lookup(title);
  if (shown === "found") return "title";
  if (shown === "unknown") return "unknown";
  if (!original || original.toLowerCase() === title.toLowerCase()) return "not_found";

  const fallback = await lookup(original);
  if (fallback === "found") return "original";
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Open Library                                                        */
/* ------------------------------------------------------------------ */

async function inOpenLibrary(title: string, author: string): Promise<Lookup> {
  const query = new URLSearchParams({ title, author, fields: "key", limit: "1" });
  const data = await getJson(`${OPEN_LIBRARY}?${query}`, "Open Library");
  if (typeof data?.numFound !== "number") return "unknown";
  return data.numFound > 0 ? "found" : "not_found";
}

/* ------------------------------------------------------------------ */
/* Wikidata                                                            */
/* ------------------------------------------------------------------ */

/**
 * Kişi adına karşılık gelen Wikidata kimlikleri (en çok 3). `null` = sorulamadı,
 * boş dizi = böyle biri kayıtlı değil.
 *
 * Tek kimlik yerine ilk üçü: aynı adı taşıyan başka kayıtlar var (oyuncu Steve
 * McQueen / yönetmen Steve McQueen) ve hangisinin aranan kişi olduğunu ayırmak ayrı
 * bir sorgu isterdi. Eser araması zaten "bu kimliklerden biri yaratmış" diye sorduğu
 * için yanlış kimlik zarar vermez, yalnızca eşleşmez.
 *
 * Önce Türkçe etiketlerde aranır: kartta ad Türkçe yazımıyla duruyor ("Andrey
 * Tarkovski", "Yasunari Kavabata") ve Wikidata o yazımı Türkçe etikette taşıyor.
 */
async function personIds(name: string): Promise<string[] | null> {
  for (const language of ["tr", "en"]) {
    const query = new URLSearchParams({
      action: "wbsearchentities",
      search: name,
      language,
      uselang: language,
      type: "item",
      limit: "3",
      format: "json",
    });
    const data = await getJson(`${WIKIDATA}?${query}`, "Wikidata (kişi)");
    if (!data) return null;
    const hits = Array.isArray(data.search) ? data.search : [];
    const ids = hits.map((hit) => (hit as { id?: string }).id).filter((id): id is string => !!id);
    if (ids.length > 0) return ids;
  }
  return [];
}

/**
 * Arama sözdiziminde anlam taşıyan işaretleri boşluğa çevirir ("-Eylül" o sözcüğü
 * DIŞLAR, tırnak öbek açar). Kesme işareti KALIR: "Marienbad'da" tek sözcük olarak
 * dizinleniyor, bölünürse eşleşmiyor.
 */
function searchTerms(title: string): string {
  return title.replace(/["“”()[\]{}:!?~*^\\/+<>=|]|(^|\s)-+/g, " ").replace(/\s+/g, " ").trim();
}

/** "Bu kişilerden birine `property` ile bağlı, adında bu sözcükler geçen kayıt var mı?" */
async function inWikidata(title: string, ids: string[], property: string): Promise<Lookup> {
  const terms = searchTerms(title);
  if (!terms) return "unknown";
  const createdBy = `haswbstatement:${ids.map((id) => `${property}=${id}`).join("|")}`;
  const query = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: `${terms} ${createdBy}`,
    srlimit: "1",
    srinfo: "totalhits",
    srprop: "",
    format: "json",
  });
  const data = await getJson(`${WIKIDATA}?${query}`, "Wikidata (eser)");
  const total = (data?.query as { searchinfo?: { totalhits?: unknown } } | undefined)
    ?.searchinfo?.totalhits;
  if (typeof total !== "number") return "unknown";
  return total > 0 ? "found" : "not_found";
}

/* ------------------------------------------------------------------ */
/* Kitap ve film                                                       */
/* ------------------------------------------------------------------ */

export function checkBook(book: WorkToCheck): Promise<Verdict> {
  const author = book.creator.trim();
  // Yalnızca yazar adı gelen öneride sınanacak bir eser yok.
  if (!author || !cleanTitle(book.title)) return Promise.resolve("unknown");

  // Yazar kimliği en çok bir kez, ve yalnızca Open Library "yok" derse sorulur.
  let ids: Promise<string[] | null> | undefined;

  return judge(book, async (title) => {
    const catalogued = await inOpenLibrary(title, author);
    if (catalogued === "found") return "found";

    // Wikidata burada yalnızca YUKARI çeker: bulursa bulunmuştur, bulamazsa (ya da
    // yazarı tanımıyorsa, ya da sorulamadıysa) Open Library'nin cevabı geçerli kalır.
    // Tersi olsaydı Wikidata'da kaydı olmayan her yazarın kitabı sınanmadan geçerdi.
    const who = await (ids ??= personIds(author));
    if (who?.length && (await inWikidata(title, who, AUTHOR)) === "found") return "found";
    return catalogued;
  });
}

/**
 * Ortak yönetimde adları ayırır. Wikidata filmi ikiliye değil KİŞİLERE bağlıyor, o
 * yüzden "Joel Coen, Ethan Coen" tek ad olarak aranırsa hiçbir şey bulunmaz.
 *
 * Tek sözcüklü parça atılır: "Paolo ve Vittorio Taviani" bölününce "Paolo" kalıyor,
 * o adla aranan kişi alakasız biri çıkıyor ve gerçek film ("Padre Padrone") geri
 * çevriliyordu (ölçüldü). Soyadını taşıyan parça ("Vittorio Taviani") yetiyor.
 */
function directorNames(creator: string): string[] {
  const parts = creator.split(/,|&|\/|\sve\s|\sand\s/).map((part) => part.trim());
  const full = parts.filter((part) => part.split(/\s+/).length >= 2);
  return (full.length > 0 ? full : [creator.trim()]).filter(Boolean).slice(0, 2);
}

export async function checkFilm(film: WorkToCheck): Promise<Verdict> {
  const names = directorNames(film.creator);
  if (names.length === 0 || !cleanTitle(film.title)) return "unknown";

  const found = await Promise.all(names.map(personIds));
  const ids = found.flatMap((list) => list ?? []);
  // Tanınmayan yönetmen "yok" sayılmaz: kaydı olmayan gerçek bir yönetmen olabilir.
  // Bugüne kadar görülen hata uydurma yönetmen değil, gerçek yönetmene yanlış film —
  // onu aşağıdaki arama yakalıyor.
  if (ids.length === 0) return "unknown";

  return judge(film, (title) => inWikidata(title, ids, DIRECTOR));
}
