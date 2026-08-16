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
  /**
   * Platform tercihi. NULL = "Tümü" ve DB'de de DEFAULT yok — yani "dokunmamış
   * kullanıcı" ile "Tümü seçmiş kullanıcı" aynı şey. Boş dizi DB'de CHECK ile
   * yasak; buraya da asla [] yazılmaz.
   *
   * Tercih her pakette SAKLANIR ama yalnızca premium'da UYGULANIR — zorlama
   * `lens_weekly_pick_candidates` içinde (tek nokta). Buradaki ve Ayarlar'daki
   * paket kontrolü kullanıcıya durumu ANLATMAK içindir, güvenlik sınırı değil.
   */
  platforms: null,
} as const;

export type PreferenceValues = {
  weekly_picks_enabled: boolean;
  plan: UserPlan;
  platforms: string[] | null;
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
    .select("weekly_picks_enabled, plan, platforms")
    .eq("user_id", session.user.id)
    .maybeSingle<Pick<UserPreferences, "weekly_picks_enabled" | "plan" | "platforms">>();

  if (error) {
    console.error("[preferences] okunamadı:", error);
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    weekly_picks_enabled: data?.weekly_picks_enabled ?? DEFAULT_PREFERENCES.weekly_picks_enabled,
    plan: (data?.plan ?? DEFAULT_PREFERENCES.plan) as UserPlan,
    // Boş dizi gelirse (elle yazılmış bayat satır) "Tümü" olarak okunur.
    platforms: data?.platforms && data.platforms.length > 0 ? data.platforms : null,
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

/**
 * Platform tercihini yazar.
 *
 * setWeeklyPicksEnabled ile BİRLEŞTİRİLMEDİ ve bu bilinçli: tek bir
 * `savePreferences(prefs)` yazıcısı, bayat bir bellek-içi `weekly_picks_enabled`
 * değerinin daha yenisini EZMESİNE izin verir (kullanıcı başka bir sekmede
 * kapatmışsa). Ayrıca payload'a `plan` girme riskini yeniden açar.
 *
 * `slugs` boşsa NULL yazılır — DB'de boş dizi CHECK ile yasak ve "hiçbir platform
 * kabul değil" anlamına gelirdi.
 *
 * PAKET DENETİMİ BURADA YOK ve bu bilinçli: filtreyi uygulayan tek yer
 * `lens_weekly_pick_candidates` ve orası ücretsiz pakette `platforms`'ı zaten NULL
 * döndürüyor. Buraya ikinci bir kapı koymak, premium'dan düşen kullanıcının
 * tercihini yazamaz hâle getirir ve iki kapı zamanla ayrışır.
 */
export async function setPlatforms(slugs: string[]): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const platforms = slugs.length > 0 ? slugs : null;

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: session.user.id, platforms },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[preferences] platformlar yazılamadı:", error);
    return false;
  }
  return true;
}
