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

  /**
   * Haftalık seçkiye özgü, opsiyonel alanlar. Günlük keşifte yoktur.
   * Eskiden bu bilgiler weeklyPickCards içinde DÜŞÜRÜLÜYORDU — kart, elindeki
   * "nerede izlenir" linkini kullanıcıya hiç göstermiyordu.
   */
  year?: number;
  /** "Nerede izlenir" linki — v2 `watch_url`, v1 satırlarda `justwatch_url`. */
  watchUrl?: string;
  mediaType?: "movie" | "tv";
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

/**
 * Haftalık seçkiyi kart verisine çevirir. Burada seçim YAPILMAZ — kürasyon
 * generate-weekly-picks'in işi.
 *
 * `slot: String(index)` DEĞİŞTİRİLEMEZ: geri bildirimin bağlama anahtarı bu ve
 * `lens_active_signals`'ın haftalık seçki etiketlerini bulmak için kullandığı
 * `(ord - 1)::TEXT = f.slot` eşlemesi buna dayanıyor. Dizi indeksinden başka bir
 * şeye geçmek geçmiş bütün sinyalleri yanlış eserlere bağlar.
 *
 * Dizi de motorda `film` tipinde yaşıyor (work_type CHECK'i böyle); mediaType
 * yalnızca GÖSTERİM için taşınıyor.
 */
export function weeklyPickCards(pick: WeeklyPick): DiscoveryCardData[] {
  return (pick.films ?? []).map((film, index) => ({
    key: `weekly-${index}`,
    workType: "film" as WorkType,
    title: film.title,
    creator: film.director ?? "",
    reason: film.blurb,
    slot: String(index),
    year: Number.isFinite(film.year) ? film.year : undefined,
    // v2 alanı önce, v1 yedek: elle girilmiş eski satırlar linkini kaybetmesin.
    watchUrl: film.watch_url || film.justwatch_url || undefined,
    mediaType: film.media_type,
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
