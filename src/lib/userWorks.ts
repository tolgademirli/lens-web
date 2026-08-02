import { supabase } from "./supabase";
import { clearLibraryStash, readLibraryStash, stashLibraryWorks } from "./pendingLibrary";
import type { WorkConfidence, WorkSource, WorkType } from "./types";

export interface LibraryWork {
  creator: string;
  title: string;
  source: WorkSource;
  confidence?: WorkConfidence;
  /** Rapora seçildi mi — yalnızca seçilenlerin id'si geri döner. */
  selected: boolean;
}

/** Girişlerle aynı sırada, rapora seçilen eserlerin havuz id'leri. Boş string = ertelendi. */
export type SelectedWorkIds = string[];

/**
 * Onay ekranında bırakılan TÜM eserleri havuza yazar — rapora seçilmeyenler dahil.
 * "Kütüphane sınırsız, rapor bounded" kararının kütüphane yarısı burada gerçekleşir.
 *
 * Oturum yoksa yazamayız (RLS), o yüzden localStorage'a saklanır ve girişten sonra
 * flushLibraryStash() ile yazılır. Bu durumda dönen id'ler boştur; analyze rapora
 * giren satırların kayıtlarını kendisi oluşturur.
 */
export async function saveWorksToLibrary(
  type: WorkType,
  works: LibraryWork[],
  batchId: string
): Promise<SelectedWorkIds> {
  const selected = works.filter((w) => w.selected);
  if (works.length === 0) return [];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    stashLibraryWorks(type, batchId, works);
    return selected.map(() => "");
  }

  const ids = await insertWorks(user.id, type, works, batchId);
  if (!ids) {
    // Yazılamadıysa kaybetme: sakla, girişten sonraki flush tekrar dener.
    stashLibraryWorks(type, batchId, works);
    return selected.map(() => "");
  }

  // ids works ile aynı sırada; seçilenlerin id'lerini sırayla ayıkla.
  return works.map((w, i) => (w.selected ? ids[i] ?? "" : null)).filter((v): v is string => v !== null);
}

/**
 * Girişten sonra bekleyen eserleri havuza yazar.
 * Kategori başına, rapora seçilmiş olanların id'lerini eklenme sırasıyla döner —
 * çağıran bunları girişlerle eşleştirip report_works bağlantısını kurar.
 */
export async function flushLibraryStash(): Promise<Record<WorkType, string[]>> {
  const empty: Record<WorkType, string[]> = { book: [], film: [], song: [] };
  const stash = readLibraryStash();
  if (!stash) return empty;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;

  const result = { ...empty };
  let allOk = true;

  for (const type of ["book", "film", "song"] as WorkType[]) {
    for (const batch of stash[type] ?? []) {
      const ids = await insertWorks(user.id, type, batch.works, batch.batchId);
      if (!ids) {
        allOk = false;
        continue;
      }
      batch.works.forEach((w, i) => {
        if (w.selected) result[type].push(ids[i] ?? "");
      });
    }
  }

  // Yalnızca tamamı yazıldıysa temizle; aksi halde bir sonraki denemede tekrar dener.
  if (allOk) clearLibraryStash();
  return result;
}

/** Ekler ve id'leri giriş sırasıyla döner; hata olursa null. */
async function insertWorks(
  userId: string,
  type: WorkType,
  works: LibraryWork[],
  batchId: string
): Promise<string[] | null> {
  const rows = works.map((w) => ({
    user_id: userId,
    type,
    creator: w.creator.trim(),
    title: w.title.trim() || null,
    source: w.source,
    confidence: w.confidence ?? null,
    batch_id: batchId,
  }));

  const { data, error } = await supabase.from("user_works").insert(rows).select("id");
  if (error || !data) {
    console.error("[user_works] Havuza yazılamadı:", error);
    return null;
  }
  return data.map((r: { id: string }) => r.id);
}
