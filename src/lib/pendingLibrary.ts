import type { WorkConfidence, WorkSource, WorkType } from "./types";

const KEY = "lens_pending_library";
const MAX_AGE_MS = 60 * 60 * 1000; // pendingReport ile aynı ömür

export interface StashedWork {
  creator: string;
  title: string;
  source: WorkSource;
  confidence?: WorkConfidence;
  /** Rapora seçildi mi — flush sonrası id eşlemesi buna göre yapılır. */
  selected: boolean;
}

interface StashBatch {
  batchId: string;
  works: StashedWork[];
}

type Stash = Partial<Record<WorkType, StashBatch[]>> & { savedAt?: number };

/**
 * Giriş yapmamış kullanıcının onayladığı eserleri geçici olarak saklar.
 * Çıkarım anonim yapılabiliyor ama user_works'e yazmak oturum istiyor (RLS);
 * bu köprü olmasa girişten önce onaylanan her şey kaybolurdu.
 *
 * Batch'ler eklendikleri sırada durur — flush sonrası id'ler bu sırayla eşleşir.
 */
export function stashLibraryWorks(type: WorkType, batchId: string, works: StashedWork[]) {
  if (works.length === 0) return;
  try {
    const stash = read() ?? {};
    const batches = stash[type] ?? [];
    batches.push({ batchId, works });
    stash[type] = batches;
    stash.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(stash));
  } catch (err) {
    console.error("[pendingLibrary] Saklanamadı:", err);
  }
}

export function readLibraryStash(): Stash | null {
  return read();
}

export function clearLibraryStash() {
  localStorage.removeItem(KEY);
}

function read(): Stash | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stash;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
