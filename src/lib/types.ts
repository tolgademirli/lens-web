export interface HeroData {
  archetype: string;
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

export interface DailyDiscovery {
  book: string;
  film: string;
  music: string;
  reasons: { book: string; film: string; music: string };
  date: string;
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

/** user_preferences satırı. Satırın yokluğu "hepsi varsayılan" demektir. */
export interface UserPreferences {
  user_id: string;
  weekly_picks_enabled: boolean;
  updated_at: string;
}

/** Haftalık seçkideki tek film. Kürasyon manuel — bu satırlar elle girilir. */
export interface WeeklyPickFilm {
  title: string;
  year: number;
  blurb: string;
  justwatch_url: string;
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
