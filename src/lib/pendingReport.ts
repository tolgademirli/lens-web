const KEY = "lens_pending_report";
const MAX_AGE_MS = 60 * 60 * 1000; // 60 dakika

export interface PendingReport {
  books: string[];
  movies: string[];
  music: string[];
  /**
   * Girişlerle aynı sıradaki edinim yolları. Buraya da yazılıyor çünkü OAuth /
   * magic link redirect'i sessionStorage'ı sıfırlıyor — giriş yapmamış kullanıcı
   * (yani çoğu yeni kullanıcı) bu yoldan geçiyor ve aksi halde source kaybolurdu.
   */
  sources?: { books: string[]; movies: string[]; music: string[] };
  /** Havuzda zaten oluşturulmuş kayıtların id'leri — analyze aynı eseri tekrar yazmasın. */
  workIds?: { books: string[]; movies: string[]; music: string[] };
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
    return {
      books: parsed.books ?? [],
      movies: parsed.movies ?? [],
      music: parsed.music ?? [],
      sources: parsed.sources,
      workIds: parsed.workIds,
    };
  } catch {
    return null;
  }
}

export function clearPendingReport() {
  localStorage.removeItem(KEY);
}
