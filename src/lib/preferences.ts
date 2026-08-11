import { supabase } from "./supabase";
import type { UserPlan, UserPreferences } from "./types";

/**
 * Tercih varsayılanları. `user_preferences` satırı OLMAYAN kullanıcı için
 * geçerli olan değerler — DB'deki DEFAULT ile birebir aynı kalmalı.
 * Gönderim sorgusu (send-weekly-picks) da aynı varsayımı kullanır.
 */
export const DEFAULT_PREFERENCES = {
  weekly_picks_enabled: true,
  /**
   * Paket. Satırı olmayan kullanıcı ücretsizdir; DB kolonunun DEFAULT'u da 'free'.
   * Kullanıcı bu değeri kendi yazamaz (guard_user_preferences_plan trigger'ı),
   * o yüzden aşağıdaki upsert'lerde hiç gönderilmez.
   */
  plan: "free",
} as const;

export type PreferenceValues = {
  weekly_picks_enabled: boolean;
  plan: UserPlan;
};

/**
 * Oturum açmış kullanıcının tercihleri. Satır yoksa varsayılanlar döner —
 * bu bir hata değil, normal durum (kullanıcı ayara hiç dokunmamış).
 */
export async function fetchPreferences(): Promise<PreferenceValues> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ...DEFAULT_PREFERENCES };

  const { data, error } = await supabase
    .from("user_preferences")
    .select("weekly_picks_enabled, plan")
    .eq("user_id", session.user.id)
    .maybeSingle<Pick<UserPreferences, "weekly_picks_enabled" | "plan">>();

  if (error) {
    console.error("[preferences] okunamadı:", error);
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    weekly_picks_enabled: data?.weekly_picks_enabled ?? DEFAULT_PREFERENCES.weekly_picks_enabled,
    plan: (data?.plan ?? DEFAULT_PREFERENCES.plan) as UserPlan,
  };
}

/**
 * Haftalık seçki tercihini yazar. Satır yoksa açar (upsert) — kullanıcı ayara
 * ilk kez dokunduğunda satırı burada doğar.
 *
 * Dönen değer başarı durumudur; çağıran optimistic update'i buna göre geri alır.
 */
export async function setWeeklyPicksEnabled(enabled: boolean): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: session.user.id, weekly_picks_enabled: enabled },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[preferences] yazılamadı:", error);
    return false;
  }
  return true;
}
