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
