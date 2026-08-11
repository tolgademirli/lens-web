import { supabase } from "./supabase";
import { recordFeedback } from "./feedback";
import type { HitResult, ListItem, WorkType } from "./types";

/**
 * "Listem" — Bekleyenler ve Bitirdiklerim.
 *
 * Satır AÇMA yolu burada yok: listeye giriş yalnızca "İlgimi çekti" sinyaliyle,
 * `record_feedback` RPC'sinin içinden olur. Böylece liste ile sinyal defteri
 * ayrışamaz; buradan da satır açılabilseydi motorun görmediği bir liste öğesi
 * mümkün olurdu.
 */

/** Çıkarılmamış tüm liste öğeleri (bekleyen + bitmiş), yeniden eskiye. */
export async function fetchListItems(): Promise<ListItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("user_id", session.user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listem] okunamadı:", error);
    return [];
  }
  return data as ListItem[];
}

/**
 * "Okudum / İzledim / Dinledim" + "İsabet miydi?" yanıtı.
 *
 * Öğe SİLİNMEZ, Bitirdiklerim'e taşınır ve isabet sonucu rozet olarak kalır.
 * Sinyal 5x kalibrasyon ağırlığıyla ayrıca deftere yazılır — motorun kendi
 * öngörü hatasını görebildiği tek veri budur.
 */
export async function completeListItem(item: ListItem, result: HitResult): Promise<boolean> {
  const { error } = await supabase
    .from("list_items")
    .update({
      status: "completed",
      hit_result: result,
      completed_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  if (error) {
    console.error("[listem] tamamlanamadı:", error);
    return false;
  }

  await recordFeedback(
    {
      workType: item.work_type,
      title: item.work_title ?? "",
      creator: item.work_creator ?? "",
      origin: item.added_from,
      dailyDiscoveryId: item.daily_discovery_id,
      weeklyPickId: item.weekly_pick_id,
      slot: item.slot,
    },
    result
  );

  return true;
}

/**
 * Listeden çıkarma. SOFT delete: satır silinseydi eser tekrar önerilebilir hale
 * gelirdi. Kullanıcı listeden çıkarır, motor unutmaz.
 */
export async function removeListItem(itemId: string): Promise<boolean> {
  const { error } = await supabase
    .from("list_items")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    console.error("[listem] çıkarılamadı:", error);
    return false;
  }
  return true;
}

/** Satırdaki eylem fiili — tür başına farklı. */
export const COMPLETION_VERB: Record<WorkType, string> = {
  book: "Okudum",
  film: "İzledim",
  song: "Dinledim",
};

/** Bitirdiklerim'deki rozet metni. */
export const HIT_LABEL: Record<HitResult, string> = {
  hit: "İsabetliydi",
  partial: "Kısmen",
  miss: "İsabetsizdi",
};

/**
 * "Bu yıl Lens ile N eser bitirdin" bandının eşiği.
 * 3'ün altında gizlenir: 1 eserde bu bant övgü değil, kıtlık gibi okunuyor.
 */
export const COMPLETED_BANNER_MIN = 3;

/** Bu takvim yılında bitirilen eser sayısı — bandın girdisi. */
export function completedThisYear(items: ListItem[]): number {
  const year = new Date().getFullYear();
  return items.filter(
    (i) => i.status === "completed" && i.completed_at &&
      new Date(i.completed_at).getFullYear() === year
  ).length;
}
