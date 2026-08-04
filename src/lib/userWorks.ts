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

/**
 * Havuza yazar ve id'leri giriş sırasıyla döner; hata olursa null.
 *
 * Tekillik veritabanında uygulanıyor: upsert_user_works, aynı kullanıcıda aynı
 * (tür, yaratıcı, eser) zaten varsa yeni satır AÇMAZ, mevcut id'yi döner.
 * Böylece aynı liste ikinci kez import edilince kütüphane şişmez; eserin yeni
 * rapora girmesi report_works'te yeni bağlantı olarak kaydedilir.
 *
 * user_id parametre olarak gitmez — fonksiyon auth.uid() kullanır, aksi halde
 * bir kullanıcı başkasının kütüphanesine yazabilirdi.
 */
async function insertWorks(
  _userId: string,
  type: WorkType,
  works: LibraryWork[],
  batchId: string
): Promise<string[] | null> {
  const payload = works.map((w) => ({
    // İkisinden biri yeterli: yalnızca eser adı bilinen kayıtlar da havuza girer.
    creator: w.creator.trim(),
    title: w.title.trim(),
    source: w.source,
    confidence: w.confidence ?? null,
  }));

  const { data, error } = await supabase.rpc("upsert_user_works", {
    p_type: type,
    p_batch_id: batchId,
    p_works: payload,
  });

  if (error || !Array.isArray(data)) {
    console.error("[user_works] Havuza yazılamadı:", error);
    return null;
  }
  return data as string[];
}
