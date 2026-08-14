export interface HeroData {
  /** Arketibin tam hali. Raporda HER ZAMAN bu gösterilir — bölünmüş hali yalnızca posterde. */
  archetype: string;
  /**
   * Posterdeki iki katmanlı başlık. Bölmeyi üretici yapar (anlam bütünlüğüne
   * göre), `analyze` düzleştirerek yazar. Bu değişiklikten ÖNCE üretilmiş
   * raporlarda yok — poster o durumda tek katmana düşer.
   */
  archetype_qualifier?: string;
  archetype_core?: string;
  summary: string;
}

export interface ColorItem {
  name: string;
  hex: string;
  description: string;
}

export interface TextureData {
  descriptions: string[];
  colors: ColorItem[];
}

export interface ThreadItem {
  title: string;
  description: string;
}

export interface ContrastSide {
  title: string;
  subtitle?: string;
  /** Posterdeki tek kelimelik kutup etiketi ("TOZ ⟷ IŞIK"). Rapor sayfası kullanmaz. */
  poster?: string;
  description: string;
  footnote?: string;
}

export interface ContrastItem {
  left: ContrastSide;
  right: ContrastSide;
  explanation: {
    title: string;
    text: string;
  };
}

export interface ShadowItem {
  type: "Kitap" | "Film" | "Müzik";
  title: string | null;
  author_or_artist: string;
  year?: string | null;
  description: string;
}

/** Keşif kartındaki tek öneri. `slot` kart kimliğinin yarısıdır (diğer yarısı keşif id'si). */
export interface DiscoveryItem {
  slot: DiscoverySlot;
  title: string;
  creator: string;
  /** Kartta italik görünen kısa gerekçe (max 12 kelime). */
  reason: string;
  /** Eksen ayarının girdisi — bkz. `taste_profile.axes`. Eski satırlarda yok. */
  genre?: string;
  /** -1 aydınlık .. +1 karanlık */
  tone?: number;
  /** -1 niş .. +1 popüler */
  popularity?: number;
  /** -1 klasik .. +1 çağdaş */
  era?: number;
}

export type DiscoverySlot = "book" | "film" | "music";

export interface DailyDiscovery {
  book: string;
  film: string;
  music: string;
  reasons: { book: string; film: string; music: string };
  date: string;
  /** Keşif satırının id'si — geri bildirim buna bağlanır. Eski cache'lerde yok. */
  id?: string;
  /**
   * Yapılandırılmış öneriler. Yoksa (eski satır) client `book`/`film`/`music`
   * string'lerini bölerek gösterir — yalnızca geriye dönük okuma yolu.
   */
  items?: DiscoveryItem[];
  /** O çağrıda haftalık eksen ayarı çalıştıysa true (ücretsiz pakette işaret gösterilir). */
  profile_refreshed?: boolean;
  /** Eşik dolmadıysa kalan sinyal sayısı; dolduysa 0. */
  signals_until_profile?: number;
}

export type WorkType = "book" | "film" | "song";

/** Eserin havuza hangi yoldan girdiği. 'form' = Screenshot-to-DNA öncesi akış. */
export type WorkSource = "screenshot" | "paste" | "manual" | "form";

export type WorkConfidence = "high" | "medium" | "low";

/**
 * Rapora giren tek sinyal — formun ve `analyze` payload'ının taşıdığı birim.
 *
 * `title` ve `creator` ayrı tutuluyor çünkü kullanıcı ikisini ayrı ayrı
 * düzenleyebiliyor. Eski tek-string biçimi ("Başlık - Yaratıcı") yalnızca
 * geriye dönük okuma yollarında kaldı: orada yalnızca-eser-adı girdisi
 * ayırıcı bulunamadığı için yaratıcı sanılıyordu.
 *
 * İkisi birden boş olamaz; biri boş olabilir ("sadece yazar adı da yeterli").
 * `source` ve `workId` nesnenin içinde durur — eskiden paralel dizilerdeydi ve
 * indeks kayması sessizce yanlış edinim yolu yazıyordu.
 */
export interface WorkEntry {
  title: string;
  creator: string;
  source: WorkSource;
  /** Havuzdaki (user_works) karşılığı; yoksa "" — analyze o zaman kendisi yazar. */
  workId: string;
}

/** user_works satırı — kullanıcının sınırsız eser havuzu. */
export interface UserWork {
  id: string;
  created_at: string;
  user_id?: string | null;
  telegram_user_id?: number | null;
  type: WorkType;
  /** Yaratıcı adı (yazar / yönetmen / sanatçı) — zorunlu. */
  creator: string;
  /** Eser başlığı — çoğu zaman boş. */
  title?: string | null;
  source: WorkSource;
  /** Tek bir çıkarım işleminden gelen eserleri gruplar. */
  batch_id?: string | null;
  /** Vision çıkarımının güven sinyali; manuel girişlerde null. */
  confidence?: WorkConfidence | null;
  /** Dolu ise kayıt havuzdan çıkarılmış (soft delete). */
  deleted_at?: string | null;
}

/**
 * `extract-works` endpoint'inin döndürdüğü ham çıkarım satırı.
 * Henüz havuza yazılmadı — onay ekranından geçtikten sonra `UserWork` olur.
 */
export interface ExtractedWork {
  /** Girdide yazmıyorsa boş olabilir — kullanıcı onay ekranında tamamlar. */
  creator: string;
  /** Girdide eser adı yoksa ya da seçilemediyse boş. Okuma kalitesi confidence'ta. */
  title: string;
  confidence: WorkConfidence;
  /** Yaratıcı girdide yoktu, model eseri tanıyıp tamamladı — kullanıcı doğrulamalı. */
  creator_inferred: boolean;
  source: Extract<WorkSource, "screenshot" | "paste">;
}

/** `works` boş dönerse guardrail ekranı gösterilir — sistem eser uydurmaz. */
export interface ExtractWorksResponse {
  works: ExtractedWork[];
  batch_id: string;
}

/** report_works satırı — raporun hangi havuz kayıtlarından üretildiği. */
export interface ReportWork {
  report_id: string;
  work_id: string;
  created_at: string;
}

/**
 * Üyelik paketi. Geri bildirim VERMEK iki pakette de tamamen açıktır; ayrım
 * yalnızca sistemin ne sıklıkta güncellendiği ve ne kadar geriye baktığındadır.
 * Kullanıcı bu değeri kendi değiştiremez — `user_preferences` üzerindeki
 * `guard_user_preferences_plan` trigger'ı yazımı yutar.
 */
export type UserPlan = "free" | "premium";

/** user_preferences satırı. Satırın yokluğu "hepsi varsayılan" demektir. */
export interface UserPreferences {
  user_id: string;
  weekly_picks_enabled: boolean;
  plan: UserPlan;
  updated_at: string;
}

/* ---------------------------------------------------------------------------
 * Geri bildirim (US-05)
 * ------------------------------------------------------------------------- */

/**
 * Kullanıcının bir keşif kartında verebileceği kararlar.
 * `interested`/`not_interested` karttan, `known_*` "bunu biliyorum" alt sorusundan,
 * `hit`/`partial`/`miss` Listem'deki "isabet miydi" sorusundan gelir.
 */
export type FeedbackDecision =
  | "interested"
  | "not_interested"
  | "known_liked"
  | "known_disliked"
  | "known_neutral"
  | "hit"
  | "partial"
  | "miss";

/**
 * Sinyalin güvenilirlik sınıfı. Üçü ASLA eşit işlenmez — bkz. `SIGNAL_WEIGHT`.
 * Rezonans tüketim ÖNCESİ verilir: kullanıcı kartta yazan gerekçenin ikna gücünü
 * oylar, eseri değil.
 */
export type SignalType = "resonance" | "taste" | "calibration";

/** "İlgimi çekmedi" nedeni. Opsiyoneldir; verilmemesi geri bildirimi geçersiz kılmaz. */
export type FeedbackReason = "too_dark" | "too_popular" | "mood_mismatch" | "genre_mismatch";

/** Sinyalin hangi yüzeyden geldiği. `chat` (US-06) ve `onboarding` henüz üretilmiyor. */
export type FeedbackOrigin = "daily_discovery" | "weekly_pick" | "chat" | "onboarding";

/** discovery_feedback satırı — append-only sinyal defteri. */
export interface DiscoveryFeedback {
  id: string;
  user_id: string;
  work_type: WorkType;
  work_creator?: string | null;
  work_title?: string | null;
  /** GENERATED kolon — client hesaplamaz, yalnızca okur. */
  work_key: string;
  decision: FeedbackDecision;
  signal_type: SignalType;
  weight: number;
  reason?: FeedbackReason | null;
  /** Yalnız `mood_mismatch`: bu tarihe kadar önerilmez, sonra tekrar aday olur. */
  defer_until?: string | null;
  origin: FeedbackOrigin;
  daily_discovery_id?: string | null;
  weekly_pick_id?: string | null;
  slot?: string | null;
  /** Dolu ise bu sinyal daha güçlü bir sinyalle aşıldı — SİLİNMİŞ değil, hata kaydı. */
  superseded_by?: string | null;
  created_at: string;
}

export type ListItemStatus = "pending" | "completed";

/** "İsabet miydi?" yanıtı — Bitirdiklerim'deki rozet. */
export type HitResult = "hit" | "partial" | "miss";

/** list_items satırı — "Listem". */
export interface ListItem {
  id: string;
  user_id: string;
  work_type: WorkType;
  work_creator?: string | null;
  work_title?: string | null;
  work_key: string;
  status: ListItemStatus;
  hit_result?: HitResult | null;
  added_from: FeedbackOrigin;
  daily_discovery_id?: string | null;
  weekly_pick_id?: string | null;
  slot?: string | null;
  completed_at?: string | null;
  /** Soft delete: listeden çıkarıldı ama motor unutmadı (tekrar önerilmez). */
  removed_at?: string | null;
  created_at: string;
}

/** Profilin eksenleri; her biri [-1, 1]. */
export interface TasteAxes {
  /** -1 aydınlık .. +1 karanlık */
  tone?: number;
  /** -1 niş .. +1 popüler */
  popularity?: number;
  /** -1 klasik .. +1 çağdaş */
  era?: number;
}

/** taste_profile satırı — biriken ağırlıklı sinyallerden TÜRETİLİR, elle yazılmaz. */
export interface TasteProfile {
  user_id: string;
  /** null = eşik (5 ağırlıklı sinyal) henüz dolmadı, profil hiç yazılmadı. */
  axes: TasteAxes | null;
  genre_weights: Record<string, number> | null;
  signal_weight_total: number;
  calibration_weight_total: number;
  computed_at: string;
  computed_through?: string | null;
}

/** Haftalık seçkideki tek film. Kürasyon manuel — bu satırlar elle girilir. */
export interface WeeklyPickFilm {
  title: string;
  year: number;
  blurb: string;
  justwatch_url: string;
  /** Yönetmen — uygulama içi kartta başlığın altında görünür. Mailde kullanılmaz. */
  director?: string;
}

/** Mail giriş paragrafını belirler. */
export type WeeklyPickIntroVariant = "standart" | "sessiz";

/** `overpast` = haftası geçtiği için kapatıldı; bir daha gönderim değerlendirmesine girmez. */
export type WeeklyPickStatus = "draft" | "sent" | "failed" | "overpast";

/** weekly_picks satırı — bir kullanıcının bir haftalık seçkisi. */
export interface WeeklyPick {
  id: string;
  user_id: string;
  /** O haftanın işareti (örn. gönderim Cuma'sı), YYYY-MM-DD. */
  week: string;
  films: WeeklyPickFilm[];
  intro_variant: WeeklyPickIntroVariant;
  status: WeeklyPickStatus;
  sent_at?: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  created_at: string;
  telegram_user_id?: number;
  user_id?: string;
  source?: string;
  books?: { title: string; author: string }[];
  films?: { title: string; director: string }[];
  songs?: { title: string; artist: string }[];
  hero: HeroData;
  texture: TextureData;
  threads: ThreadItem[];
  contrasts: ContrastItem[];
  shadow: ShadowItem[];
  is_public: boolean;
}
