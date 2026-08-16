// İzleme erişilebilirliği istemcisi — "nerede izlenir" bilgisinin TEK kaynağı.
//
// NEDEN BU SAĞLAYICI: JustWatch'un herkese açık bir API'si yok ve linkler bugüne
// kadar `https://www.justwatch.com/tr/film/<slug>` diye ELLE TAHMİN ediliyordu;
// sık sık kırık çıkıyordu (7 Ağustos 2026 seçkisinde üç filmin de "Nerede izlenir"
// satırı bu yüzden kayboldu). TMDB bu işi çözüyordu ama ticari kullanım $149/ay ve
// Lens'in premium paketi var — "kişisel kullanım" beyanı yanlış beyan olurdu.
// Watchmode'un ücretsiz katmanı ticari kullanıma kapalı. Kalan: movieofthenight
// "Streaming Availability API" — ücretsiz katmanı (1.000 istek/ay) TİCARİ
// KULLANIMA AÇIK.
//
// TMDB'ye göre en önemli fark: arama ve erişilebilirlik TEK çağrıda geliyor
// (`streamingOptions.tr[]`), yani aday başına 2 değil 1 istek. Kota bu yüzden
// 1.000/ay ile bile makul.
//
// KÜNYE ZORUNLU: uygulama, akış bilgisinin "Streaming Availability API by Movie of
// the Night" tarafından sağlandığını belirtmeli ve
// https://www.movieofthenight.com/about/api adresine link vermeli. Künye
// Hesabım'daki platform kartının altında (src/pages/Account.tsx) — mailde DEĞİL, çünkü
// mailin link tavanı 5 ve dolu (email.ts başındaki not).
//
// ÜCRETLİ ÖZELLİK KAPISI: bu istemci yalnızca ETKİN BİR PLATFORM FİLTRESİ VARSA
// çağrılır (premium + platform seçili). Ücretsiz yolda ağ isteği yok; link
// justwatchSearchUrl() ile kurulan bir ARAMA linkidir. Kapıyı burada değil
// generate-weekly-picks'te ve lens_weekly_pick_candidates'ta arayın.

const BASE = "https://api.movieofthenight.com/v4";

export const WATCH_TIMEOUT_MS = 8_000;

/**
 * Eşzamanlı istek sayısı. TMDB döneminde 4'tü; burada 3, çünkü ücretsiz katmanın
 * saniyelik limiti belgelenmemiş ve 429 bize bir yeniden deneme (yani kotadan bir
 * istek daha) mal oluyor.
 */
export const WATCH_CONCURRENCY = 3;

/**
 * Kullanıcı başına SERT tavan. TMDB'de 24'tü çünkü aday başına 2 çağrı gerekiyordu;
 * burada eşleşen aday tek çağrıya mal oluyor — yani 12, en geniş aday listesinin (9)
 * iyi giden hâlini rahat karşılıyor.
 *
 * DİKKAT: eşleşMEYEN aday pahalı. findWork sırayla 3 sorgu (özgün ad → yerel ad →
 * öteki tip) deniyor ve her sorgu 429/5xx'te bir kez daha deneniyor. Yani birkaç
 * kötü aday tavanı erken doldurabilir; o durumda kalan adaylar hiç sorulmaz ve
 * gevşetme merdiveni devreye girer (üretici bunu `watch_call_cap` ile işaretler).
 * Tavanı yükseltmek aylık kotadan yer: ücretsiz katman 1.000 istek/ay.
 */
export const MAX_WATCH_CALLS_PER_USER = 12;

/** Uygulama içi dil: "tv" (weekly_picks.films[].media_type, email.ts, discovery.ts). */
export type MediaType = "movie" | "tv";
/** Sağlayıcının dili: "series". Sınırda çevrilir, içeriye sızmaz. */
type ShowType = "movie" | "series";

/**
 * Teklif tipi — sağlayıcının enum'u birebir. TMDB'nin `flatrate`/`ads`'i YOK:
 * `subscription` flatrate'in karşılığı, reklamlı ücretsiz katalog `free`'ye düşüyor.
 * `addon` = ana serviste satın alınan EK KANAL (örn. Prime Video üzerinden MUBI);
 * kullanıcının seçtiği platforma abone olması onu izleyebildiği anlamına GELMEZ,
 * bu yüzden gevşetme merdiveninde kiralık ile aynı basamakta.
 */
export type OfferType = "free" | "subscription" | "buy" | "rent" | "addon";

const OFFER_TYPES: readonly OfferType[] = ["free", "subscription", "buy", "rent", "addon"];

const isOfferType = (raw: unknown): raw is OfferType =>
  typeof raw === "string" && (OFFER_TYPES as readonly string[]).includes(raw);

/** Tek bir izleme seçeneği: hangi serviste, hangi koşulla, hangi linkte. */
export type StreamOption = {
  /** Servis slug'ı ("netflix", "prime", ...) — watch_providers.service_id ile eşleşir. */
  service_id: string;
  /** Servisin görünen adı; yalnızca teşhis çıktısında kullanılır. */
  service_name: string;
  type: OfferType;
  /** Servisin kendi sayfasına DOĞRUDAN link. Tahmin yok — sağlayıcıdan geliyor. */
  link: string;
};

export type WatchMatch = {
  /** Sağlayıcının show id'si — aynı eseri iki kez seçmemek için kullanılır. */
  show_id: string;
  media_type: MediaType;
  title: string;
  original_title: string;
  year: number | null;
  /** TR'de izleme seçenekleri. BOŞ OLABİLİR: eser var ama Türkiye'de yok. */
  options: StreamOption[];
};

export type CandidateQuery = {
  /** Kullanıcıya gösterilecek ad (Claude'un Türkçe/yerel yazımı). */
  title: string;
  /** Özgün/uluslararası ad — arama bununla daha isabetli. */
  title_en?: string;
  year?: number | null;
  media_type: MediaType;
};

/** Sağlayıcının bir ülkede sunduğu servis — yalnızca teşhis (mode: "services"). */
export type ServiceInfo = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Ad normalizasyonu                                                   */
/* ------------------------------------------------------------------ */

/**
 * Karşılaştırma için ad katlama. Türkçe'ye özgü harfler ASCII'ye indirilir.
 *
 * DİKKAT — noktasız I: `toLocaleLowerCase("tr-TR")` içinde 'I' -> 'ı' olur ve
 * 'ı' NFD ile ÇÖZÜLMEZ (kendi başına bir harf). Bu yüzden Türkçe harfleri NFD'den
 * ÖNCE elle eşliyoruz. Aynı tuzak lens_name_key'de de var (CLAUDE.md).
 */
export function foldName(raw: string): string {
  return raw
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    // Tum birlesik isaretler (\p{M}): "café" -> "cafe". Aralik yerine Unicode
    // ozellik sinifi: kaynak ASCII kalir, editor/kodlama turlerinden etkilenmez.
    .replace(/\p{M}/gu, "")
    // '+' KORUNUR: bu katlama servis adlarını da karşılaştırıyor (mode: "services")
    // ve "Apple TV+" (abonelik) ile "Apple TV" (kiralama mağazası) AYRI servisler.
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ücretsiz yolun izleme linki: JustWatch ARAMA sayfası.
 *
 * Neden arama, neden slug değil: slug tahmini ("justwatch.com/tr/film/<slug>")
 * defalarca 404 verdi — bu entegrasyonun var olma sebebi o. Arama URL'i bir tahmin
 * DEĞİL: sorgu neyse onu arar, sonuç boş çıkabilir ama link asla kırık olmaz.
 *
 * Yıl sorguya KATILMAZ: JustWatch araması yılı bir terim gibi ele alıyor ve
 * "Solaris 1972" çoğu zaman "Solaris"ten daha az sonuç veriyor.
 */
export function justwatchSearchUrl(title: string): string {
  return `https://www.justwatch.com/tr/arama?q=${encodeURIComponent(title.trim())}`;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WatchClient {
  #key: string;
  /** Invocation içi önbellek: aynı partide iki kullanıcıya aynı eser çıkabilir. */
  #cache = new Map<string, unknown>();
  #calls = 0;

  constructor(apiKey: string) {
    this.#key = apiKey;
  }

  get callCount(): number {
    return this.#calls;
  }

  resetCallCount() {
    this.#calls = 0;
  }

  async #get<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const cacheKey = url.toString();
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey) as T;

    // Anahtar HEADER'da gider (X-API-Key), query'de değil: query string'ler
    // proxy/erişim loglarına düşer.
    const headers: Record<string, string> = {
      accept: "application/json",
      "X-API-Key": this.#key,
    };

    // İki deneme: 429'da Retry-After kadar, 5xx'te 500ms. İkinci hatada pes
    // ediyoruz — bir aday için sağlayıcıyı dövmek hem partiyi geciktirir hem
    // aylık kotayı yer.
    for (let attempt = 0; attempt < 2; attempt++) {
      this.#calls += 1;
      try {
        const res = await fetch(cacheKey, {
          headers,
          signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
        });

        if (res.status === 429) {
          const after = Number(res.headers.get("Retry-After") ?? "2");
          if (attempt === 0) {
            await sleep((Number.isFinite(after) ? Math.min(after, 10) : 2) * 1000);
            continue;
          }
          console.error("[watch] 429 ısrar etti, bu adaydan vazgeçiliyor");
          return null;
        }

        if (res.status >= 500) {
          if (attempt === 0) {
            await sleep(500);
            continue;
          }
          console.error(`[watch] ${res.status} ısrar etti`);
          return null;
        }

        // 401/403 kota ya da anahtar sorunudur ve SESSİZ KALMAMALI: bütün haftanın
        // premium seçkisi sessizce ücretsiz yola düşerdi.
        if (res.status === 401 || res.status === 403) {
          console.error(`[watch] ${res.status}: API anahtarı reddedildi ya da kota bitti`);
          return null;
        }

        // 404 dahil diğer her şey: aday bulunamadı say. Fırlatmıyoruz — tek bir
        // bozuk aday kullanıcının bütün seçkisini düşürmemeli.
        if (!res.ok) return null;

        const data = (await res.json()) as T;
        this.#cache.set(cacheKey, data);
        return data;
      } catch (err) {
        if (attempt === 0) {
          await sleep(500);
          continue;
        }
        console.error("[watch] istek başarısız:", err);
        return null;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* 1) Arama + erişilebilirlik — TEK çağrı                           */
  /* ---------------------------------------------------------------- */

  async #search(showType: ShowType, title: string): Promise<RawShow[]> {
    const data = await this.#get<RawShow[]>("/shows/search/title", {
      title,
      country: "tr",
      show_type: showType,
      // Dizide sezon/bölüm kırılımı istemiyoruz: seçki bir DİZİYİ öneriyor,
      // "3. sezon 4. bölüm"ü değil. Kırılım yanıtı da gereksiz büyütür.
      series_granularity: "show",
    });
    return Array.isArray(data) ? data : [];
  }

  /**
   * Adayı sağlayıcıda bul ve TR erişilebilirliğiyle birlikte döndür.
   * Bulunamazsa (ya da güven kapısını geçemezse) null.
   *
   * GÜVEN KAPISI olmadan `?title=Yeşil Işın` neşeyle alakasız bir kısa film döner
   * ve biz EMİN BİR ŞEKİLDE YANLIŞ bir deep link yayınlarız. Yanlış link, eksik
   * linkten kesinlikle kötüdür — bu yüzden şüphede reddediyoruz.
   *
   * KURAL TMDB DÖNEMİNDEN FARKLI ve bu fark ölçülmüş bir hatadan geliyor:
   * eskiden "ad eşitliği VEYA ±1 yıl" yetiyordu, çünkü TMDB araması `year`
   * parametresini KABUL EDİYORDU ve sonuç kümesi sunucuda zaten daralıyordu.
   * Bu API'de böyle bir parametre yok. Aynı kuralı taşıyınca 2019 tarihli
   * "Chernobyl" mini dizisi için 2024 yapımı BAŞKA bir "Chernobyl" filmi geldi ve
   * yalnızca ad eşitliğiyle kapıdan geçti (canlı probe, 16 Ağustos 2026).
   *
   * Yeni kural: sorgu zaten ADA göre yapıldığı için dönen satır "ad olarak" hep
   * yakındır; ayırt edici olan YILDIR.
   *   * İki yıl da biliniyorsa: |fark| <= 1 ŞART. Ad eşitliği tek başına YETMEZ.
   *   * Sağlayıcıda yıl yoksa: ad eşitliğine (katlanmış) düşülür.
   * Bedeli bilinçli: Claude'un yılı 2+ sene yanlışsa doğru eser de düşer. Eksik
   * seçki, yanlış linkli seçkiden iyidir.
   */
  async findWork(q: CandidateQuery): Promise<WatchMatch | null> {
    const primary = (q.title_en ?? q.title).trim();
    const wanted: ShowType = q.media_type === "tv" ? "series" : "movie";
    const other: ShowType = wanted === "movie" ? "series" : "movie";

    const attempts: { showType: ShowType; query: string }[] = [
      { showType: wanted, query: primary },
    ];
    // Özgün ad tutmazsa yerel adla bir kez daha.
    if (q.title.trim() && foldName(q.title) !== foldName(primary)) {
      attempts.push({ showType: wanted, query: q.title.trim() });
    }
    // Claude bazen mini diziyi film (ya da tersini) etiketliyor: diğer tipi de dene.
    attempts.push({ showType: other, query: primary });

    for (const attempt of attempts) {
      const rows = await this.#search(attempt.showType, attempt.query);
      // Arama BİRDEN ÇOK sonuç döndürüyor ve sıralaması alaka değil isabet
      // temelli değil; ilk satıra sabitlenmiyoruz — güven kapısını geçen İLK
      // satırı alıyoruz. (TMDB'de tek satıra bakılıyordu çünkü orada `year`
      // parametresi aramayı zaten daraltıyordu; burada öyle bir parametre yok.)
      for (const row of rows.slice(0, 5)) {
        const match = toMatch(row);
        if (!match) continue;

        const titleHit =
          foldName(match.title) === foldName(primary) ||
          foldName(match.original_title) === foldName(primary) ||
          foldName(match.title) === foldName(q.title) ||
          foldName(match.original_title) === foldName(q.title);

        // Yıl bilgisi VARSA hakem odur; yoksa ada düşülür (yukarıdaki nota bak).
        const bothYearsKnown = q.year != null && match.year != null;
        const passes = bothYearsKnown
          ? Math.abs(match.year! - q.year!) <= 1
          : titleHit;

        if (!passes) continue;
        return match;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* 2) Servis listesi — yalnızca teşhis                              */
  /* ---------------------------------------------------------------- */

  /**
   * Türkiye'de tanınan servisler. ÜRETİM AKIŞINDA ÇAĞRILMAZ: watch_providers
   * tablosundaki `service_id` zaten sağlayıcının slug'ı, çözülecek bir şey yok.
   *
   * Bu fonksiyon `mode: "services"` teşhisinin girdisi: seed'lediğimiz bir
   * service_id TR'de yoksa o slug'ı seçen kullanıcının filtresi SESSİZCE boşalır
   * ve gevşetme merdiveni bunu "platform dışı öneri" diye gizler. Teşhis, o
   * sessizliği bir listeye çevirir.
   */
  async trServices(): Promise<ServiceInfo[]> {
    type CountryRow = { countryCode?: string; name?: string; services?: unknown };
    const data = await this.#get<Record<string, CountryRow> | CountryRow[]>("/countries", {});
    if (!data) return [];

    const row = Array.isArray(data)
      ? data.find((c) => (c.countryCode ?? "").toLowerCase() === "tr")
      : (data.tr ?? data.TR);
    const services = row?.services;
    if (!Array.isArray(services)) return [];

    return services
      .map((s) => {
        const svc = s as Record<string, unknown>;
        return {
          id: typeof svc.id === "string" ? svc.id : "",
          name: typeof svc.name === "string" ? svc.name : "",
        };
      })
      .filter((s) => s.id);
  }
}

/* ------------------------------------------------------------------ */
/* Ham yanıt -> WatchMatch                                             */
/* ------------------------------------------------------------------ */

type RawShow = {
  id?: unknown;
  showType?: unknown;
  title?: unknown;
  originalTitle?: unknown;
  releaseYear?: unknown;
  firstAirYear?: unknown;
  streamingOptions?: unknown;
};

/**
 * Ham `Show`u WatchMatch'e indirir; kimliği ya da tipi eksikse null.
 *
 * Yıl alanı tipe göre DEĞİŞİYOR: film `releaseYear`, dizi `firstAirYear`. İkisini
 * de okuyoruz — biri yoksa güven kapısı yıl kanadını kaybeder ve aday yalnızca ad
 * eşitliğiyle geçebilir.
 */
function toMatch(raw: RawShow): WatchMatch | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;

  const showType = raw.showType === "series" ? "series" : raw.showType === "movie" ? "movie" : null;
  if (!showType) return null;

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const original = typeof raw.originalTitle === "string" ? raw.originalTitle.trim() : "";
  const yearRaw = typeof raw.releaseYear === "number"
    ? raw.releaseYear
    : typeof raw.firstAirYear === "number"
      ? raw.firstAirYear
      : null;

  return {
    show_id: id,
    media_type: showType === "series" ? "tv" : "movie",
    title: title || original,
    original_title: original || title,
    year: Number.isInteger(yearRaw) ? (yearRaw as number) : null,
    options: parseOptions(raw.streamingOptions),
  };
}

/**
 * `streamingOptions.tr[]` -> StreamOption[]. Tanınmayan `type` değeri DÜŞER:
 * sağlayıcı enum'a yeni bir değer eklerse onu "abonelik" sanıp kullanıcıya yanlış
 * söylemektense hiç göstermemek yeğdir.
 */
function parseOptions(raw: unknown): StreamOption[] {
  if (!raw || typeof raw !== "object") return [];
  // country=tr ile sorguluyoruz, yani tek anahtar bekleniyor; yine de açıkça 'tr'
  // okuyoruz ki bir gün çok ülkeli bir yanıt gelirse yanlış ülkeyi göstermeyelim.
  const list = (raw as Record<string, unknown>).tr;
  if (!Array.isArray(list)) return [];

  const out: StreamOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const service = row.service as Record<string, unknown> | undefined;
    const serviceId = typeof service?.id === "string" ? service.id : "";
    const link = typeof row.link === "string" ? row.link : "";
    if (!serviceId || !link || !isOfferType(row.type)) continue;

    out.push({
      service_id: serviceId,
      service_name: typeof service?.name === "string" ? service.name : serviceId,
      type: row.type,
      link,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Eşzamanlılık                                                        */
/* ------------------------------------------------------------------ */

/** Sıralı partiler; paralel patlama yok (sağlayıcının throttle'ına saygı). */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
