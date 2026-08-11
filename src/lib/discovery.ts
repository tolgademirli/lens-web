import type {
  DailyDiscovery,
  DiscoveryFeedback,
  DiscoverySlot,
  WeeklyPick,
  WorkType,
} from "./types";

/** Karta basılacak tek öneri — günlük keşif ve haftalık seçki aynı biçime iner. */
export interface DiscoveryCardData {
  key: string;
  workType: WorkType;
  title: string;
  creator: string;
  reason: string;
  slot: string;
}

const SLOT_TO_TYPE: Record<DiscoverySlot, WorkType> = {
  book: "book",
  film: "film",
  music: "song",
};

/**
 * Eski `"Başlık - Yaratıcı"` biçimini böler. **Yalnızca geriye dönük okuma yolu:**
 * `items` kolonu gelmeden önce yazılmış keşif satırları için.
 *
 * Ayırıcısız satırlarda tahmin yürütmez — tamamını başlık sayar. CLAUDE.md'deki
 * ders bunun tersiydi: ayırıcı bulunamayan satır yaratıcı sanılıyor, yalnız eser
 * adı yanlış kolona yazılıyordu.
 */
function splitLegacy(raw: string, musicSlot: boolean): { title: string; creator: string } {
  const value = (raw ?? "").trim();
  if (!value) return { title: "", creator: "" };
  // Müzik önerisi zaten yalnızca sanatçı adıdır.
  if (musicSlot) return { title: "", creator: value };

  // SON ayırıcıdan böl, ilkinden değil: biçim "{başlık} - {yaratıcı}" ve ayırıcı
  // başlıkta geçebiliyor ("Blade Runner - 2049 - Denis Villeneuve"), yaratıcı
  // adında geçmesi ise nadir. İlk ayırıcı kullanılsaydı başlık "Blade Runner",
  // yaratıcı "2049 - Denis Villeneuve" olurdu.
  const index = value.lastIndexOf(" - ");
  if (index === -1) return { title: value, creator: "" };
  return {
    title: value.slice(0, index).trim(),
    creator: value.slice(index + 3).trim(),
  };
}

/** Günlük keşfi kart verisine çevirir. `items` varsa onu kullanır. */
export function dailyDiscoveryCards(discovery: DailyDiscovery): DiscoveryCardData[] {
  if (discovery.items?.length) {
    return discovery.items.map((item) => ({
      key: `daily-${item.slot}`,
      workType: SLOT_TO_TYPE[item.slot],
      title: item.title,
      creator: item.creator,
      reason: item.reason,
      slot: item.slot,
    }));
  }

  const slots: DiscoverySlot[] = ["book", "film", "music"];
  return slots.map((slot) => {
    const { title, creator } = splitLegacy(discovery[slot], slot === "music");
    return {
      key: `daily-${slot}`,
      workType: SLOT_TO_TYPE[slot],
      title,
      creator,
      reason: discovery.reasons?.[slot] ?? "",
      slot,
    };
  });
}

/** Haftalık seçkiyi kart verisine çevirir. Kürasyon manuel — burada seçim yapılmaz. */
export function weeklyPickCards(pick: WeeklyPick): DiscoveryCardData[] {
  return (pick.films ?? []).map((film, index) => ({
    key: `weekly-${index}`,
    workType: "film" as WorkType,
    title: film.title,
    creator: film.director ?? "",
    reason: film.blurb,
    slot: String(index),
  }));
}

/**
 * Bir kartın mevcut aktif sinyali. Eşleşme eserin adına değil, kartın KİMLİĞİNE
 * (keşif/seçki id'si + slot) bakar — ad eşleşmesi normalizasyon gerektirirdi ve
 * o hesap yalnızca veritabanında yaşıyor.
 */
export function feedbackForCard(
  feedback: DiscoveryFeedback[],
  sourceId: string | null | undefined,
  slot: string
): DiscoveryFeedback | null {
  if (!sourceId) return null;
  return (
    feedback.find(
      (f) =>
        (f.daily_discovery_id === sourceId || f.weekly_pick_id === sourceId) && f.slot === slot
    ) ?? null
  );
}
