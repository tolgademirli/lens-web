// Haftalık seçki üretiminin prompt katmanı.
//
// daily-discovery/index.ts:10-289'un kardeşi ama AYNI DEĞİL:
//   * kitap/müzik yok — yalnızca film ve dizi
//   * 3 değil 5-9 ADAY isteniyor (erişilebilirlik doğrulaması ve platform filtresi
//     bazılarını düşürecek; aşırı üretim o kaybı karşılıyor)
//   * her aday `title_en` (özgün/uluslararası ad) taşımak zorunda — erişilebilirlik
//     aramasının isabeti buna bağlı
//   * her aday `year` ve `media_type` taşımak zorunda — doğru eseri bulmanın ve
//     güven kapısını geçmenin tek yolu
//   * etiketler (tone/popularity/era/genre) İÇ İÇE `tags` altında değil, düz
//     geliyor; normalizeCandidates onları `tags` nesnesine indiriyor (films JSONB v2)

export type Candidate = {
  title: string;
  title_en: string;
  year: number | null;
  media_type: "movie" | "tv";
  creator: string;
  blurb: string;
  tags: { tone: number; popularity: number; era: number; genre: string };
};

export type ReportSeed = {
  hero?: Record<string, unknown> | null;
  texture?: Record<string, unknown> | null;
  books?: unknown;
  films?: unknown;
  songs?: unknown;
};

export type ProfileSeed = {
  axes: Record<string, number> | null;
  genre_weights: Record<string, number> | null;
} | null;

export type BlockedWork = {
  work_key: string;
  work_type: string;
  work_creator: string | null;
  work_title: string | null;
  why: string;
};

/**
 * Yasak listenin prompt'a giren kısmı. `disliked` satırlar TAMAMEN girer (onları
 * tekrar önermek en pahalı hata); diğer nedenler 80'de kapanır.
 *
 * Kod tarafındaki doğrulama HER ZAMAN tam liste ile yapılır — bu kısıt yalnızca
 * prompt boyutu içindir. (daily-discovery:103-109 ile aynı politika.)
 */
const PROMPT_BLOCK_LIMIT = 80;

export function trimBlocked(blocked: BlockedWork[]): BlockedWork[] {
  const disliked = blocked.filter((b) => b.why === "disliked");
  const rest = blocked.filter((b) => b.why !== "disliked").slice(0, PROMPT_BLOCK_LIMIT);
  return [...disliked, ...rest];
}

export const SYSTEM_PROMPT = `Sen 'Lens' adlı kişisel kültür rehberinin zekasısın.

## KİMLİĞİN
Bir sinema küratörünün derinliğine, bir mahalle arkadaşının samimiyetine sahipsin.
Akademik mesafe değil, samimi zeka. Yargılayan değil, merak eden bir ton.

## TON VE DİL
- 1.5 doz entelektüel, 1 doz esprili ve sade
- Ağır, akademik dilden kaçın
- Emoji kullanma
- Klişe ifadelerden kaçın
- Türkçe yaz
- Keşif tonu — merak uyandır, dayatma
- Türkçe karakterleri (ı, ş, ğ, ü, ö, ç, İ) eksiksiz ve doğru kullan; "sıkışır" yerine
  "sikisir" gibi ASCII yazım KESİNLİKLE yasak
- Latin dışı alfabelerden karakter kullanma

## GÖREVİN
Kullanıcının estetik kimliğine göre bu hafta izleyebileceği FİLM ve DİZİ öner.
İstenen sayıda aday üret — hepsi kullanılmayacak, bir kısmı erişilebilirlik
kontrolünden düşecek. Bu yüzden hepsi GERÇEKTEN önerilebilir olmalı; dolgu koyma.

Kullanıcının daha önce girdiği eserlerle KESİNLİKLE çakışma.
"ÖNERME" listesindeki eserleri KESİNLİKLE önerme — farklı yazımlarını da önerme.

## ALANLAR — HER ADAY İÇİN ZORUNLU
- title: eserin Türkçe'de bilinen adı (yoksa özgün adı)
- title_en: ÖZGÜN ya da ULUSLARARASI ad (İngilizce). Veritabanı aramasında bu
  kullanılıyor; yanlışsa eser bulunamaz ve aday düşer. Emin değilsen özgün adı yaz.
- year: ilk gösterim/yayın yılı (sayı). Doğru eseri ayırt etmenin anahtarı — TAHMİN
  ETME, bilmiyorsan o adayı hiç önerme.
- media_type: "movie" (film) ya da "tv" (dizi/mini dizi). Mini diziler "tv"dir.
- creator: film için yönetmen, dizi için yaratıcı/showrunner
- blurb: kullanıcıya neden uygun olduğunu söyleyen TEK cümle (max 14 kelime).
  Konu özeti DEĞİL — bu kişiye neden bu eser, onu söyle.
- tone, popularity, era: -1 ile 1 arasında sayı (aşağıya bak)
- genre: tek kelimelik tür etiketi (örn. "polisiye", "dram", "bilimkurgu")

## ETİKETLER
Bu etiketler kullanıcının geri bildiriminin nasıl işleneceğini belirler, kullanıcıya
GÖSTERİLMEZ. Dürüst ol; eseri olduğundan farklı etiketlemek motoru bozar.
- tone: -1 aydınlık/hafif ... +1 karanlık/ağır
- popularity: -1 niş/az bilinen ... +1 çok popüler
- era: -1 klasik/eski ... +1 çağdaş/yeni

## ÇIKTI FORMATI
SADECE geçerli JSON döndür. Başka hiçbir şey yazma:

{
  "items": [
    {
      "title": "Chungking Express",
      "title_en": "Chungking Express",
      "year": 1994,
      "media_type": "movie",
      "creator": "Wong Kar-wai",
      "blurb": "Şehirde iki insanın birbirini ıskalaması, tam senin tempon.",
      "genre": "romantik",
      "tone": 0.1,
      "popularity": -0.3,
      "era": -0.4
    }
  ]
}`;

function asList(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const title = typeof row.title === "string" ? row.title : "";
        const creator = typeof row.creator === "string" ? row.creator : "";
        return [title, creator].filter(Boolean).join(" - ");
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Eksenleri insan diline çevirir. daily-discovery:118-131 ile AYNI eşikler —
 * iki üreticinin profili farklı okuması, kullanıcıya tutarsız öneri demek olurdu.
 */
export function describeAxes(axes: Record<string, number> | null | undefined): string[] {
  if (!axes) return [];
  const label: Record<string, [string, string]> = {
    tone: ["aydınlık ve hafif", "karanlık ve ağır"],
    popularity: ["niş, az bilinen", "popüler, bilinen"],
    era: ["klasik, eski", "çağdaş, yeni"],
  };
  const out: string[] = [];
  for (const [axis, value] of Object.entries(axes)) {
    const pair = label[axis];
    if (!pair || typeof value !== "number" || Math.abs(value) < 0.15) continue;
    const strength = Math.abs(value) > 0.5 ? "belirgin şekilde" : "hafifçe";
    out.push(`${strength} ${value > 0 ? pair[1] : pair[0]}`);
  }
  return out;
}

export type PromptInput = {
  report: ReportSeed;
  profile: ProfileSeed;
  blocked: BlockedWork[];
  /** Kullanıcının seçtiği platformların görünen adları. Boş = Tümü. */
  platformLabels: string[];
  /** Kaç aday istenecek. */
  wanted: number;
  /** Erişilemediği için düşen adaylar — ikinci denemede tekrar önerilmesin. */
  unavailable?: string[];
  /** Yasak listeye rağmen önerilen eser — ikinci denemede uyarı olarak girer. */
  violation?: string;
};

export function buildPrompt(input: PromptInput): string {
  const { report, profile, blocked, platformLabels, wanted } = input;

  const hero = (report.hero ?? {}) as Record<string, unknown>;
  const archetype = typeof hero.archetype === "string" ? hero.archetype : "";
  const summary = typeof hero.summary === "string" ? hero.summary : "";

  const texture = report.texture as Record<string, unknown> | null | undefined;
  const descriptions = texture?.descriptions;
  const textureLine =
    Array.isArray(descriptions) && typeof descriptions[0] === "string" ? descriptions[0] : "";

  const booksList = asList(report.books);
  const filmsList = asList(report.films);
  const songsList = asList(report.songs);

  const blockedLines = trimBlocked(blocked)
    .map((b) => [b.work_title, b.work_creator].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join("\n- ");

  const axisLines = describeAxes(profile?.axes);

  // Tür ağırlıkları: |w| >= 1 anlamlı sayılır (daily-discovery:165-170 ile aynı).
  const genres = Object.entries(profile?.genre_weights ?? {})
    .filter(([, w]) => typeof w === "number" && Math.abs(w) >= 1)
    .sort((a, b) => b[1] - a[1]);
  const liked = genres.filter(([, w]) => w > 0).map(([g]) => g);
  const disliked = genres.filter(([, w]) => w < 0).map(([g]) => g);

  // Platform ipucu: Claude'un "bu başlık Netflix TR'de olabilir mi" önsezisi fena
  // değil ve bu satır, hayatta kalma oranını EK ADAY istemekten daha ucuza yükseltiyor.
  // Yine de bir GARANTİ değil — asıl filtre erişilebilirlik doğrulaması. Ücretsiz
  // yolda platformLabels BOŞ gelir (filtre yok), bu satır hiç kurulmaz.
  const platformLine = platformLabels.length
    ? `Kullanıcı yalnızca şu platformları kullanıyor: ${platformLabels.join(", ")}. ` +
      `Türkiye'de BU platformlarda bulunma olasılığı yüksek başlıklar seç. ` +
      `Emin olmadığın bir başlığı, sırf bu platformlarda olabilir diye önerme.`
    : "";

  const unavailableLine = input.unavailable?.length
    ? `\nŞu başlıklar erişilebilirlik kontrolünden geçemedi, TEKRAR ÖNERME: ${input.unavailable.join(", ")}.`
    : "";

  const violationLine = input.violation
    ? `\nÖNEMLİ: Az önce "${input.violation}" önerdin, bu ÖNERME listesindeydi. Bu kez farklı eserler seç.`
    : "";

  return `${archetype ? `Kullanıcının estetik arketipi: "${archetype}"` : ""}
${summary ? `Arketip özeti: "${summary}"` : ""}
${textureLine ? `Atmosfer/doku: "${textureLine}"` : ""}

Kullanıcının daha önce girdiği eserler (BUNLARLA KESİNLİKLE ÇAKIŞMA):
- Kitaplar: ${booksList || "(yok)"}
- Filmler: ${filmsList || "(yok)"}
- Müzisyenler/Sanatçılar: ${songsList || "(yok)"}

${blockedLines ? `ÖNERME — kullanıcı bunları zaten değerlendirdi (farklı yazımları da dahil):\n- ${blockedLines}` : ""}

${axisLines.length ? `Kullanıcının geri bildirimlerinden çıkan yönelim: ${axisLines.join(", ")}.` : ""}
${liked.length ? `Yakınlık duyduğu türler: ${liked.join(", ")}.` : ""}
${disliked.length ? `Uzak durduğu türler: ${disliked.join(", ")}.` : ""}

${platformLine}${unavailableLine}${violationLine}

Bu zevke uygun, yukarıdaki eserlerle çakışmayan ${wanted} film/dizi adayı öner.
Film ve dizi karışık olabilir. Her aday için title, title_en, year, media_type,
creator, blurb, genre, tone, popularity, era alanlarının HEPSİNİ doldur.
Sadece JSON döndür.`;
}

/** ```json çitini soyar; olmazsa ilk { ile son } arasını dener. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const clampAxis = (raw: unknown): number => {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
};

/**
 * Claude çıktısını Candidate'a indirir. Eksik/bozuk aday DÜŞER — bütün yanıtı
 * çöpe atmıyoruz, çünkü 9 adaydan 7'si sağlamsa seçki yine kurulabilir.
 *
 * year ve title_en ZORUNLU: ikisi de erişilebilirlik doğrulamasının girdisi. Ücretsiz
 * yolda doğrulama yapılmasa da alanları zorunlu tutuyoruz — aynı adayın iki yolda
 * farklı standarda tabi olması, yalnızca premium'da ortaya çıkan hatalar üretirdi.
 */
export function normalizeCandidates(raw: unknown): Candidate[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const title = typeof row.title === "string" ? row.title.trim() : "";
    const titleEn = typeof row.title_en === "string" ? row.title_en.trim() : "";
    const blurb = typeof row.blurb === "string" ? row.blurb.trim() : "";
    const yearRaw = typeof row.year === "number" ? row.year : Number(row.year);
    const year = Number.isInteger(yearRaw) && yearRaw > 1880 && yearRaw < 2100 ? yearRaw : null;

    if (!title || !blurb || !year) continue;

    const mediaType = row.media_type === "tv" ? "tv" : "movie";
    const genre = typeof row.genre === "string" ? row.genre.trim().toLocaleLowerCase("tr-TR") : "";

    // Aynı yanıt içinde tekrar eden adayı at (Claude bazen aynı eseri iki yazımla verir).
    const dedupeKey = `${mediaType}|${(titleEn || title).toLocaleLowerCase("tr-TR")}|${year}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      title,
      title_en: titleEn || title,
      year,
      media_type: mediaType,
      creator: typeof row.creator === "string" ? row.creator.trim() : "",
      blurb,
      tags: {
        tone: clampAxis(row.tone),
        popularity: clampAxis(row.popularity),
        era: clampAxis(row.era),
        genre,
      },
    });
  }
  return out;
}

/**
 * Kaç aday isteyeceğiz? Filtre daraldıkça hayatta kalma oranı düşer.
 * Rakamlar ilk kalibrasyon; dry-run çıktısındaki `relaxations` alanına bakarak
 * ayarlanacak (docs/weekly-picks.md).
 */
export function candidateCount(platformCount: number): number {
  // 0 = filtre yok (ücretsiz yol ya da premium "Tümü"): doğrulama da yapılmadığı
  // için düşme oranı ~0; 5 aday 3 öğeyi rahat dolduruyor.
  if (platformCount === 0) return 5;
  if (platformCount <= 2) return 9; // "sadece Netflix + Apple": oran ~%30-40
  return 7;
}
