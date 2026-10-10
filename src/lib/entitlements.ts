import { supabase } from "./supabase";
import { WEEKLY_PICKS_EMAIL_PAUSED } from "./preferences";
import type { UserPlan } from "./types";

/**
 * Paket okumanın **tek** noktası. Yetki kontrolü koda dağılırsa bir yerde
 * güncellenip başka yerde unutulur.
 *
 * PREMIUM ANAHTARI. Paket ayrımının tamamı veritabanındaki tek bir anahtara
 * bağlı (`lens_private.premium_switch`, bkz. `20261010090000_premium_switch.sql`).
 * Kapalıyken premium diye bir şey YOK: backend herkese tek davranışı uygular ve
 * arayüz "paket", "premium", "ücretsiz" kelimelerini hiç kurmaz — "ücretsiz
 * paket" demek bile ücretli bir paketin varlığını ima eder.
 *
 * Anahtar kod sabiti DEĞİL ve bu bilinçli: web ile backend aynı satırı okur,
 * yani biri açık öbürü kapalı bir yarım durum oluşamaz ve çevirmek deploy
 * istemez. Açma: `select lens_private.set_premium(true, 'lansman');`
 *
 * `user_preferences.plan` kolonunu buradan başka HİÇBİR yer okumamalı: kolon
 * anahtarı bilmez, `lens_entitlements()` bilir. Kullanıcı kolonu kendi de
 * değiştiremez (`guard_user_preferences_plan` trigger'ı yazımı yutar); ödeme
 * akışı (US-08) geldiğinde service_role ile yazacak.
 */
export interface Entitlements {
  /** Premium anahtarı açık mı. Kapalıyken paketle ilgili hiçbir şey gösterilmez. */
  premiumEnabled: boolean;
  /** ETKİN paket — anahtar kapalıyken herkes için "free". */
  plan: UserPlan;
}

/** Okunamadıysa KAPALI: emin olmadığımız bir premium'u ekrana söz olarak yazmayız. */
const CLOSED: Entitlements = { premiumEnabled: false, plan: "free" };

/*
  Kullanıcı başına tek okuma. Panel kabuğu her sekmede yeniden kurulduğu için
  önbelleksiz hâlde her sekme değişimi bir RPC demekti. Anahtar kullanıcı
  oturumuyla birlikte tutuluyor: aynı sekmede çıkış yapıp başka hesapla giren
  biri öncekinin paketini devralmasın.
*/
let cache: { userId: string | null; value: Promise<Entitlements> } | null = null;

/** Son başarılı okumadaki anahtar durumu — bkz. `knownPremiumEnabled`. */
let lastPremiumEnabled = false;

async function loadEntitlements(): Promise<Entitlements> {
  const { data, error } = await supabase.rpc("lens_entitlements");

  if (error) {
    console.error("[entitlements] okunamadı:", error);
    // Hata önbelleğe ALINMAZ: geçici bir ağ hatası oturum boyunca premium'u gizlemesin.
    cache = null;
    return { ...CLOSED };
  }

  const row = (data ?? {}) as { premium_enabled?: unknown; plan?: unknown };
  const premiumEnabled = row.premium_enabled === true;
  lastPremiumEnabled = premiumEnabled;

  return {
    premiumEnabled,
    // Sunucu zaten etkin paketi döndürüyor; buradaki `premiumEnabled &&` yalnızca
    // "anahtar kapalı ama paket premium" gibi bir yanıtı temsil edilemez kılar.
    plan: premiumEnabled && row.plan === "premium" ? "premium" : "free",
  };
}

export async function fetchEntitlements(): Promise<Entitlements> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  if (cache?.userId === userId) return cache.value;

  const value = loadEntitlements();
  cache = { userId, value };
  return value;
}

/** Etkin paket. Anahtar kapalıyken her zaman "free". */
export async function fetchPlan(): Promise<UserPlan> {
  return (await fetchEntitlements()).plan;
}

/**
 * Anahtarın bilinen son durumu, beklemeden. Yalnızca panel kabuğunun İLK
 * çizimi için: kabuk her sekmede yeniden kurulduğundan, bu olmadan "Hesabım"
 * sekmesi her geçişte bir an kaybolup geri gelirdi. Karar vermek için KULLANMA —
 * henüz hiç okunmadıysa `false` döner; gerçek cevap `fetchEntitlements`.
 */
export const knownPremiumEnabled = (): boolean => lastPremiumEnabled;

/**
 * "Hesabım" sayfası gösterilsin mi?
 *
 * Sayfanın iki içeriği var: paket + platform filtresi (premium anahtarı) ve
 * haftalık seçki e-posta tercihi (`WEEKLY_PICKS_EMAIL_PAUSED`). İkisi de
 * kapalıyken geriye yalnızca kilitli, dokunulamayan tek bir anahtar kalıyor —
 * yapılacak hiçbir şeyi olmayan bir sekme.
 *
 * Üçüncü bir bayrak YOK ve olmamalı: görünürlük bu ikisinden TÜRER. Ayrı bir
 * "sayfayı gizle" bayrağı, mail açıldığı gün unutulur ve kullanıcı e-postayı
 * kapatacak (ya da `unsubscribe` sonrası geri açacak) yeri bulamaz. Böyle,
 * ikisinden biri açıldığı an sayfa kendiliğinden geri gelir.
 */
export const accountPageVisible = (premiumEnabled: boolean): boolean =>
  premiumEnabled || !WEEKLY_PICKS_EMAIL_PAUSED;

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
