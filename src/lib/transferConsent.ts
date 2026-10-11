import { supabase } from "./supabase";
import { TRANSFER_CONSENT_VERSION } from "./legal";

/**
 * Yurt dışı aktarımına verilen açık rızanın (KVKK m.9) kaydı.
 *
 * Rıza girişten ÖNCE alınır — e-posta adresi "bağlantı gönder"e basıldığı an
 * yurt dışındaki sunucuya gider, o yüzden kutu giriş ekranındadır. Ama o anda
 * ortada bir kullanıcı yoktur, kayıt yazılamaz. İşaret bu arayı kapatır:
 * kutuyu işaretleyip devam eden kişinin kararı `localStorage`'da bekler,
 * giriş dönüşünde `user_consents`'e yazılır (`lens_auth_method` ve
 * `lens_pending_report` ile aynı köprü: OAuth/magic link yönlendirmesi sekmenin
 * belleğini sıfırlar).
 *
 * İşaret yoksa — bağlantı başka cihazda açıldıysa ya da hesap bu kapıdan önce
 * açıldıysa — `TransferConsentGate` girişten sonra sorar.
 */
const KIND = "transfer_abroad";
const PENDING_KEY = "lens_pending_consent";
// pendingReport ile aynı ömür: giriş bağlantısı bu süre içinde açılmadıysa karar
// bayatlamıştır, yeniden sorulur.
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

/** Giriş ekranında kutu işaretlenip devam edildiğinde çağrılır. */
export function markPendingTransferConsent() {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ version: TRANSFER_CONSENT_VERSION, at: Date.now() })
    );
  } catch {
    /* saklanamadı; girişten sonra kapı sorar */
  }
}

function readPending(): boolean {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { version?: string; at?: number };
    return (
      parsed.version === TRANSFER_CONSENT_VERSION &&
      typeof parsed.at === "number" &&
      Date.now() - parsed.at < PENDING_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* erişilemiyorsa yazılamamıştır da */
  }
}

/**
 * Rızayı oturumdaki kullanıcı için kaydeder. Zaman damgasını sunucu vurur
 * (`user_consents` trigger'ı); aynı sürüm ikinci kez yazılırsa ilk kayıt kalır.
 */
export async function recordTransferConsent(userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("user_consents")
    .upsert(
      { user_id: userId, kind: KIND, version: TRANSFER_CONSENT_VERSION },
      { onConflict: "user_id,kind,version", ignoreDuplicates: true }
    );
  if (error) {
    console.error("[transfer-consent] kaydedilemedi:", error);
    return false;
  }
  clearPending();
  return true;
}

/**
 * Kullanıcının güncel sürümde rıza kaydı var mı; yoksa ve giriş ekranından
 * taşınan bir işaret varsa kaydı o an yazar.
 *
 * `false` = sorulması gerek. Kayıt OKUNAMIYORSA `true` döner (fail-open):
 * tablo yokken ya da ağ koptuğunda herkesi kapının arkasında bırakmak, rızayı
 * bir sonraki açılışta sormaktan kötüdür. Günlükte `[transfer-consent]` hatası
 * sıklaşırsa kapı sessizce kapalı demektir.
 */
export async function hasTransferConsent(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_consents")
    .select("version")
    .eq("user_id", userId)
    .eq("kind", KIND)
    .eq("version", TRANSFER_CONSENT_VERSION)
    .maybeSingle();

  if (error) {
    console.error("[transfer-consent] okunamadı:", error);
    return true;
  }
  if (data) {
    clearPending();
    return true;
  }
  if (readPending()) return recordTransferConsent(userId);
  return false;
}
