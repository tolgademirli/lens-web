import { MIN_TOTAL_ENTRIES } from "./formLimits";
import {
  CATEGORY_KEYS,
  draftTotal,
  emptyDraft,
  entryFromText,
  normalizeEntries,
  type CategoryKey,
  type TasteDraft,
} from "./tasteDraft";
import type { WorkEntry, WorkSource } from "./types";

const KEY = "lens_pending_report";
const MAX_AGE_MS = 60 * 60 * 1000; // 60 dakika

/**
 * OAuth / magic link köprüsü. Redirect sessionStorage'ı sıfırlıyor — giriş
 * yapmamış kullanıcı (yani çoğu yeni kullanıcı) bu yoldan geçiyor ve aksi halde
 * tüm taslak kaybolurdu. sessionStorage ile birlikte çift yazım kasıtlı.
 */

function isFresh(savedAt: unknown): boolean {
  return typeof savedAt !== "number" || Date.now() - savedAt <= MAX_AGE_MS;
}

/**
 * Eski istemcinin yazdığı biçim: string[] + paralel sources/work_ids nesneleri.
 * 60 dakikalık TTL boyunca karşımıza çıkabilir, o yüzden okurken yükseltiyoruz.
 */
function upgradeLegacy(
  key: CategoryKey,
  entries: string[],
  parsed: Record<string, any>
): WorkEntry[] {
  const sources = parsed.sources?.[key];
  const ids = parsed.workIds?.[key];
  const at = (arr: unknown, i: number) => (Array.isArray(arr) ? arr[i] : undefined);

  return normalizeEntries(
    entries.map((text, i) => {
      const entry = entryFromText(text, at(sources, i) as WorkSource);
      if (!entry) return null;
      const id = at(ids, i);
      return { ...entry, workId: typeof id === "string" ? id : "" };
    })
  );
}

/** Süresi geçmiş kayıt silinir ve null döner. Biçim ne olursa olsun taslak döner. */
export function readPendingReport(): TasteDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isFresh(parsed?.savedAt)) {
      localStorage.removeItem(KEY);
      return null;
    }

    const draft = emptyDraft();
    for (const key of CATEGORY_KEYS) {
      const value = parsed?.[key];
      if (!Array.isArray(value)) continue;
      draft[key] = typeof value[0] === "string"
        ? upgradeLegacy(key, value as string[], parsed)
        : normalizeEntries(value);
    }
    return draft;
  } catch {
    return null;
  }
}

export function writePendingReport(draft: TasteDraft): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      books: draft.books,
      movies: draft.movies,
      music: draft.music,
      savedAt: Date.now(),
    })
  );
}

/**
 * Rapor üretmeye yetecek veri var mı. Eşik kategori başına değil, TOPLAMDA —
 * "var mı" kontrolü yetmiyordu: eksik kayıt kullanıcıyı /generating'e atıyor,
 * orası da onu geri fırlatıyordu.
 */
export function pendingReportIsComplete(draft: TasteDraft | null): draft is TasteDraft {
  return !!draft && draftTotal(draft) >= MIN_TOTAL_ENTRIES;
}

export function clearPendingReport() {
  localStorage.removeItem(KEY);
}
