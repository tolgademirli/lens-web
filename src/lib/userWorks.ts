import { supabase } from "./supabase";
import type { WorkConfidence, WorkSource, WorkType } from "./types";

export interface LibraryWork {
  creator: string;
  title: string;
  source: WorkSource;
  confidence?: WorkConfidence;
}

/**
 * Onay ekranında bırakılan TÜM eserleri havuza yazar — rapora seçilmeyenler dahil.
 * "Kütüphane sınırsız, rapor bounded" kararının kütüphane yarısı burada gerçekleşir.
 *
 * Dönen id dizisi girişlerle aynı sıradadır; rapora giren satırlar bu id'lerle
 * report_works'e bağlanır, böylece analyze aynı eseri ikinci kez yazmaz.
 * Yazım başarısız olursa boş id'ler döner — analyze o satırları kendisi oluşturur,
 * yani rapor yine üretilir; kaybedilen yalnızca rapora girmeyen satırlar olur.
 */
export async function saveWorksToLibrary(
  type: WorkType,
  works: LibraryWork[],
  batchId: string
): Promise<string[]> {
  if (works.length === 0) return [];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[user_works] Oturum yok, havuza yazılamadı.");
    return works.map(() => "");
  }

  const rows = works.map((w) => ({
    user_id: user.id,
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
    return works.map(() => "");
  }

  return data.map((r: { id: string }) => r.id);
}
