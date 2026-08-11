import { fetchPreferences } from "./preferences";
import type { UserPlan } from "./types";

/**
 * Paket okumanın **tek** noktası. Yetki kontrolü koda dağılırsa bir yerde
 * güncellenip başka yerde unutulur.
 *
 * Kaynak `user_preferences.plan`. Kullanıcı bu kolonu kendi değiştiremez —
 * tabloda kendi satırını UPDATE edebiliyor olsa da `guard_user_preferences_plan`
 * trigger'ı plan değişimini yutar; yazma yalnızca service_role ile mümkündür.
 * Ödeme akışı (US-08) geldiğinde yazacağı yer de burasıdır.
 */
export async function fetchPlan(): Promise<UserPlan> {
  const prefs = await fetchPreferences();
  return prefs.plan;
}

/**
 * Paketin öneri motorundaki karşılığı. Geri bildirim VERMEK iki pakette de
 * tamamen açıktır; ayrım yalnızca temposu ve hafıza penceresidir.
 */
export interface PlanTempo {
  /** Eksen ayarı her geri bildirimde mi, haftalık toplu mu? */
  axisTuning: "immediate" | "weekly";
  /** Motorun geriye baktığı gün sayısı; null = sınırsız. */
  memoryWindowDays: number | null;
}

export const PLAN_TEMPO: Record<UserPlan, PlanTempo> = {
  free: { axisTuning: "weekly", memoryWindowDays: 30 },
  premium: { axisTuning: "immediate", memoryWindowDays: null },
};
