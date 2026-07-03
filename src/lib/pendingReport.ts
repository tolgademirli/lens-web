const KEY = "lens_pending_report";
const MAX_AGE_MS = 60 * 60 * 1000; // 60 dakika

export interface PendingReport {
  books: string[];
  movies: string[];
  music: string[];
}

export function readPendingReport(): PendingReport | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { books: parsed.books ?? [], movies: parsed.movies ?? [], music: parsed.music ?? [] };
  } catch {
    return null;
  }
}

export function clearPendingReport() {
  localStorage.removeItem(KEY);
}
