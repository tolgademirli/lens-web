/**
 * Poster metin mantığı: arketip katmanları, karşıtlık etiketleri, Türkçe
 * büyük harf ve kırpma.
 */
import type { ContrastItem, HeroData } from "../../src/lib/types.js";

/**
 * Türkçe büyük harf. `toUpperCase()` KULLANMA:
 *   "ışık".toUpperCase()  → "ISIK"   (İ kayboldu)
 *   "sezgi".toUpperCase() → "SEZGI"  (İ yerine I)
 * Posterde karşıtlık satırları, üst çubuk ve etiketler hep büyük harf.
 */
export function trUpper(s: string): string {
  return s.toLocaleUpperCase("tr-TR");
}

export interface ArchetypeLayers {
  /** Üst katman — küçük punto, italic değil. Boşsa tek katman demektir. */
  qualifier: string;
  /** Ana katman — hero puntosu, Playfair italic. */
  core: string;
  /** İki katman mı çizilecek? */
  twoLayer: boolean;
}

/**
 * Arketibi poster katmanlarına ayırır.
 *
 * Bölme burada HESAPLANMAZ — üretici yapar, `analyze` doğrulayıp yazar.
 * "son iki kelimeyi al" gibi bir heuristik kırılgandı: "Gece Vardiyası
 * Varoluşçusu" tek anlam birimi, bölünmemeli; "Kıyıda Ateş Yakan Maceraperest"
 * bölünmeli. Kod bu ikisini ayırt edemez.
 *
 * Alanlar yoksa (bu değişiklikten önce üretilmiş raporlar) tek katmana düşülür
 * ve punto küçülerek sığar.
 */
export function archetypeLayers(hero: HeroData | undefined): ArchetypeLayers {
  const full = (hero?.archetype ?? "").trim();
  const qualifier = (hero?.archetype_qualifier ?? "").trim();
  const core = (hero?.archetype_core ?? "").trim();

  if (qualifier && core) return { qualifier, core, twoLayer: true };
  return { qualifier: "", core: core || full, twoLayer: false };
}

/** Posterde bir karşıtlık satırı. */
export interface ContrastPair {
  left: string;
  right: string;
}

/** Tek kelimelik kutup etiketi için üst sınır — aşan değer geçersiz sayılır. */
const POSTER_LABEL_MAX = 10;

/**
 * Kutup etiketini seçer: `poster` → `subtitle`'ın ilk kelimesi → `title`.
 *
 * `poster` alanı üreticiden gelir ama garanti değil: uzunluk kuralı yumuşak
 * tutuldu (Türkçede "KALABALIK"/"YALNIZLIK" gibi çiftler sıkışık, sert tavan
 * modeli anlamı bozmaya zorlar). Kural yumuşak, doğrulama burada sert —
 * kırpma yok, geçersizse zincirdeki bir alta düşülür.
 */
function poleLabel(side: { poster?: string; subtitle?: string; title?: string } | undefined): string {
  const poster = (side?.poster ?? "").trim();
  if (poster && !/\s/.test(poster) && poster.length <= POSTER_LABEL_MAX) return poster;

  const firstWord = (side?.subtitle ?? "").trim().split(/\s+/)[0] ?? "";
  if (firstWord && firstWord.length <= POSTER_LABEL_MAX) return firstWord;

  const title = (side?.title ?? "").trim();
  if (title) return title;

  return firstWord || poster;
}

/**
 * Posterde çizilecek karşıtlık satırları — en fazla 2, en az 0.
 *
 * Rapor 1 veya 2 kontrast içerebiliyor; "2 satır" bir tavan, garanti değil.
 * Bir kutbun etiketi boş çıkarsa o satır tamamen atlanır (tek taraflı bir ok
 * anlamsız durur).
 */
export function contrastPairs(contrasts: ContrastItem[] | undefined): ContrastPair[] {
  if (!Array.isArray(contrasts)) return [];
  return contrasts
    .slice(0, 2)
    .map((c) => ({ left: trUpper(poleLabel(c?.left)), right: trUpper(poleLabel(c?.right)) }))
    .filter((p) => p.left && p.right);
}

/** Kelime sınırında kırpar ve … ekler. Sadece son çare — önce punto küçülür. */
export function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Dosya adı için sadeleştirilmiş arketip ("nostaljik-mimar"). */
export function slugify(s: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
  };
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (ch) => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "lens";
}
