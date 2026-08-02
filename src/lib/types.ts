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
  /** Boş olabilir; `title_readable: false` ile birlikte "başlık okunamadı" rozetini besler. */
  title: string;
  confidence: WorkConfidence;
  title_readable: boolean;
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
