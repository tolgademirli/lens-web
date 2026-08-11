import { supabase } from "./supabase";
import type {
  DiscoveryFeedback,
  FeedbackDecision,
  FeedbackOrigin,
  FeedbackReason,
  SignalType,
  WorkType,
} from "./types";

/**
 * Karar → sinyal tipi. **Görüntüleme ve istemci mantığı için**; otorite veritabanında
 * (`lens_signal_type`). Ağırlık asla client'tan gitmez: `record_feedback` RPC'si
 * ağırlığı kararın kendisinden türetir, aksi halde 50 rezonans 5x ağırlıkla
 * yollanabilirdi.
 */
export const SIGNAL_TYPE: Record<FeedbackDecision, SignalType> = {
  interested: "resonance",
  not_interested: "resonance",
  known_liked: "taste",
  known_disliked: "taste",
  known_neutral: "taste",
  hit: "calibration",
  partial: "calibration",
  miss: "calibration",
};

/**
 * Sinyal tipine göre güven ağırlığı. Üçü asla eşit işlenmez:
 * rezonans tüketim ÖNCESİ verilir — kullanıcı kartta yazan gerekçenin ikna gücünü
 * oylar, eseri değil. Eşitlenseydi motor "daha isabetli eser seçmeyi" değil
 * "daha ikna edici blurb yazmayı" öğrenirdi.
 */
export const SIGNAL_WEIGHT: Record<SignalType, number> = {
  resonance: 1,
  taste: 3,
  calibration: 5,
};

/** Eksen ayarının devreye girmesi için gereken toplam ağırlıklı sinyal. */
export const AXIS_TUNING_THRESHOLD = 5;

/** "İlgimi çekmedi" neden seçenekleri — kartta bu sırayla görünür. */
export const REASON_LABELS: { value: FeedbackReason; label: string }[] = [
  { value: "too_dark", label: "Fazla karanlık" },
  { value: "too_popular", label: "Çok popüler" },
  { value: "mood_mismatch", label: "Ruh halime uymadı" },
  { value: "genre_mismatch", label: "Türü bana göre değil" },
];

/**
 * Onay satırı metinleri. **Tek satıra sığmak zorunda** — kart genişliğinde kesilirse
 * "geri al" bağlantısı erişilemez hale gelir. Uzatma.
 */
export function confirmationText(decision: FeedbackDecision, reason?: FeedbackReason | null): string {
  switch (decision) {
    case "interested":
      return "Listene eklendi.";
    case "not_interested": {
      const label = REASON_LABELS.find((r) => r.value === reason)?.label;
      return label ? `"${label}" not alındı.` : "Not alındı.";
    }
    case "known_liked":
      return "Sevdiğin not alındı.";
    case "known_disliked":
      return "Sevmediğin not alındı.";
    case "known_neutral":
      return "Kararsızlığın not alındı.";
    case "hit":
      return "İsabetliydi, not alındı.";
    case "partial":
      return "Kısmen isabetli, not alındı.";
    case "miss":
      return "İsabetsizdi, not alındı.";
  }
}

export interface FeedbackTarget {
  workType: WorkType;
  title: string;
  creator: string;
  origin: FeedbackOrigin;
  /** Günlük keşif satırının id'si — varsa geri bildirim ona bağlanır. */
  dailyDiscoveryId?: string | null;
  weeklyPickId?: string | null;
  /** `book`/`film`/`music` ya da seçkideki film indeksi. */
  slot?: string | null;
}

/**
 * Sinyali yazar ve satır id'sini döner (geri alma bunu kullanır).
 * Hata durumunda null — çağıran optimistic durumu geri alır.
 */
export async function recordFeedback(
  target: FeedbackTarget,
  decision: FeedbackDecision,
  reason?: FeedbackReason | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc("record_feedback", {
    p_work_type: target.workType,
    p_title: target.title,
    p_creator: target.creator,
    p_decision: decision,
    p_reason: reason ?? null,
    p_origin: target.origin,
    p_daily_discovery_id: target.dailyDiscoveryId ?? null,
    p_weekly_pick_id: target.weeklyPickId ?? null,
    p_slot: target.slot ?? null,
  });

  if (error) {
    console.error("[feedback] yazılamadı:", error);
    return null;
  }
  return data as string;
}

/**
 * Geri alma: kaydı gerçekten siler ve motor hesabından da çıkarır.
 *
 * Çakışmayla karıştırma — çakışmada eski sinyal KORUNUR (hata kaydı olarak),
 * burada kullanıcı yanlış dokunuşunu iptal ediyor.
 */
export async function retractFeedback(feedbackId: string): Promise<boolean> {
  const { error } = await supabase.rpc("retract_feedback", { p_feedback_id: feedbackId });
  if (error) {
    console.error("[feedback] geri alınamadı:", error);
    return false;
  }
  return true;
}

/**
 * Kullanıcının bugünkü keşif ve seçki kartlarına verdiği aktif sinyaller.
 * Kart açılışında hangi butonun dolu geleceğini bu belirler — sayfa yenilense de
 * verilmiş geri bildirim kaybolmuş görünmemeli.
 */
export async function fetchActiveFeedback(): Promise<DiscoveryFeedback[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from("discovery_feedback")
    .select("*")
    .eq("user_id", session.user.id)
    .is("superseded_by", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[feedback] okunamadı:", error);
    return [];
  }
  return data as DiscoveryFeedback[];
}

/**
 * Eksen ayarı eşiğine kalan sinyal sayısı. Sayaç her dokunuşta canlı düşsün diye
 * geri bildirim sayısından türetilir — keşif yanıtını beklemez.
 *
 * Yaklaşık bir sayıdır: gerçek eşik bayatlamış ağırlıklara bakar, bu ise ham
 * ağırlıkları toplar. Kullanıcıya gösterilen bir ilerleme hissi, muhasebe değil.
 */
export function signalsUntilProfile(feedback: DiscoveryFeedback[]): number {
  const total = feedback
    // "Kararsızım" eşiğe sayılmaz: eşik "profili değiştirecek kadar YÖN kanıtı
    // var mı" sorusudur ve kararsızlık yön bildirmez. recompute_taste_profile
    // da aynı kuralı uyguluyor — ikisi ayrışırsa sayaç yalan söyler.
    .filter((f) => f.decision !== "known_neutral")
    .reduce((sum, f) => sum + f.weight, 0);
  return Math.max(0, AXIS_TUNING_THRESHOLD - total);
}
