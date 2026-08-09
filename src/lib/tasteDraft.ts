import { MAX_ENTRIES_PER_CATEGORY } from "./formLimits";
import type { WorkEntry, WorkSource, WorkType } from "./types";

/**
 * Form taslağının sessionStorage sözleşmesi.
 *
 * Aynı sekmedeki doğrudan yol buradan ilerler; OAuth / magic link redirect'i
 * sessionStorage'ı sıfırladığı için köprü `pendingReport` tarafında yaşar.
 * İkisi kasıtlı — tek kaynağa indirme dürtüsüne kapılma (bkz. CLAUDE.md).
 */

export type CategoryKey = "books" | "movies" | "music";
export type TasteDraft = Record<CategoryKey, WorkEntry[]>;

export const CATEGORY_KEYS: CategoryKey[] = ["books", "movies", "music"];

/** Kategori ↔ user_works.type eşlemesi. Tekil/çoğul farkı tarihsel. */
export const WORK_TYPE_BY_CATEGORY: Record<CategoryKey, WorkType> = {
  books: "book",
  movies: "film",
  music: "song",
};

const VALID_SOURCES: WorkSource[] = ["screenshot", "paste", "manual", "form"];

/** Eski akışın yazdığı 9 anahtar. Bir sürüm boyunca okunur, sonra silinebilir. */
const LEGACY_KEYS: Record<CategoryKey, [string, string]> = {
  books: ["books_sources", "books_work_ids"],
  movies: ["movies_sources", "movies_work_ids"],
  music: ["music_sources", "music_work_ids"],
};

export function emptyDraft(): TasteDraft {
  return { books: [], movies: [], music: [] };
}

export function draftTotal(draft: TasteDraft): number {
  return CATEGORY_KEYS.reduce((sum, key) => sum + draft[key].length, 0);
}

/**
 * Elle yazılan tek satırı sinyale çevirir.
 *
 * SON " - " ile bölünür, ilk değil: eser adının kendisi tire içerebiliyor
 * ("Sıcak - Soğuk Mevsimler - Camus" → başlık "Sıcak - Soğuk Mevsimler").
 * Ayırıcı yoksa tamamı yaratıcıya yazılır — "sadece yazar adı da yeterli"
 * daha sık girilen biçim. Yanlış bölündüyse kullanıcı satır içi düzenlemeyle
 * düzeltir; iki alanın ayrı olmasının asıl sebebi bu.
 */
export function entryFromText(text: string, source: WorkSource): WorkEntry | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const idx = trimmed.lastIndexOf(" - ");
  if (idx !== -1) {
    const title = trimmed.slice(0, idx).trim();
    const creator = trimmed.slice(idx + 3).trim();
    if (title || creator) return { title, creator, source, workId: "" };
  }
  return { title: "", creator: trimmed, source, workId: "" };
}

/** Görüntüleme için tek satırlık özet — listede ve rozetlerde kullanılır. */
export function entryLabel(entry: WorkEntry): string {
  if (entry.creator && entry.title) return `${entry.creator} — ${entry.title}`;
  return entry.creator || entry.title;
}

function normalizeSource(value: unknown): WorkSource {
  return VALID_SOURCES.includes(value as WorkSource) ? (value as WorkSource) : "form";
}

/**
 * Bozuk, elle kurcalanmış ya da eski bir taslağı güvenli hale getirir:
 * alanları string'e zorlar, ikisi de boş satırı atar, tavana kırpar.
 */
export function normalizeEntries(raw: unknown): WorkEntry[] {
  if (!Array.isArray(raw)) return [];

  const out: WorkEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const creator = typeof rec.creator === "string" ? rec.creator.trim() : "";
    if (!title && !creator) continue;
    out.push({
      title,
      creator,
      source: normalizeSource(rec.source),
      workId: typeof rec.workId === "string" ? rec.workId : "",
    });
    if (out.length >= MAX_ENTRIES_PER_CATEGORY) break;
  }
  return out;
}

function readJson(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Eski 9 anahtarlı taslağı (string[] + paralel sources/work_ids) sinyallere yükseltir.
 * Deploy anında akış ortasında olan kullanıcı yazdıklarını kaybetmesin diye var.
 */
function upgradeLegacy(key: CategoryKey, entries: string[]): WorkEntry[] {
  const [sourceKey, idKey] = LEGACY_KEYS[key];
  const sources = readJson(sourceKey);
  const ids = readJson(idKey);
  const at = (arr: unknown, i: number) => (Array.isArray(arr) ? arr[i] : undefined);

  return normalizeEntries(
    entries.map((text, i) => {
      const parsed = entryFromText(text, normalizeSource(at(sources, i)));
      if (!parsed) return null;
      const id = at(ids, i);
      return { ...parsed, workId: typeof id === "string" ? id : "" };
    })
  );
}

export function readSessionDraft(): TasteDraft {
  const draft = emptyDraft();
  for (const key of CATEGORY_KEYS) {
    const raw = readJson(key);
    if (!Array.isArray(raw)) continue;
    // Eleman string ise eski akıştan kalma taslak: yükselt.
    draft[key] = typeof raw[0] === "string"
      ? upgradeLegacy(key, raw as string[])
      : normalizeEntries(raw);
  }
  return draft;
}

export function writeSessionDraft(draft: TasteDraft): void {
  for (const key of CATEGORY_KEYS) {
    sessionStorage.setItem(key, JSON.stringify(draft[key]));
  }
}

export function clearSessionDraft(): void {
  for (const key of CATEGORY_KEYS) {
    sessionStorage.removeItem(key);
    const [sourceKey, idKey] = LEGACY_KEYS[key];
    sessionStorage.removeItem(sourceKey);
    sessionStorage.removeItem(idKey);
  }
}
