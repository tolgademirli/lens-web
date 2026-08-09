import { BookOpen, Clapperboard, Music, type LucideIcon } from "lucide-react";
import type { CategoryKey } from "@/lib/tasteDraft";
import type { WorkType } from "@/lib/types";

/**
 * Üç kategorinin kullanıcıya dönük tanımı. Metinler eski adım bileşenlerinden
 * olduğu gibi taşındı — her biri ayrı ayrı gözden geçirilmişti, yeniden yazma.
 *
 * "Favori" kelimesi bilinçli olarak yok: soru "en sevdiğin üç film ne?" değil,
 * "son zamanlarda sende ne iz bıraktı?".
 */
export interface CategoryConfig {
  key: CategoryKey;
  workType: WorkType;
  /** Sekme etiketi. */
  label: string;
  /**
   * Kategorinin ikonu. Giriş sayfasındaki kategori şeridinde ve sinyal listesinde
   * AYNI ikon kullanılır — liste eskiden "Kt/Fl/Mz" kısaltmaları taşıyordu, ikisi
   * de düşük kontrastlı ve anlamı belirsizdi ("Fl" film mi?).
   * Emoji kullanma: ürünün tipografi ağırlıklı dilini bozuyor ve platformlar arası
   * tutarsız render ediliyor. Outline/line-style lucide ikonları.
   */
  icon: LucideIcon;
  placeholder: string;
  help: string;
  /** Bu kategoride en iyi sonucu veren kaynaklar. */
  sourceChips: string[];
  textPlaceholder: string;
}

export const CATEGORIES: CategoryConfig[] = [
  {
    key: "books",
    workType: "book",
    label: "Kitaplar",
    icon: BookOpen,
    placeholder: "örn: Martin Eden",
    help: "Bir kitap ya da yazar — aklında ne kaldıysa.",
    sourceChips: ["Goodreads rafı", "StoryGraph", "Instagram", "düz metin"],
    textPlaceholder:
      "Kitap listeni buraya yapıştır...\nörn: Dostoyevski - Karamazov Kardeşler\nOrhan Pamuk\nDünya Nimetleri - Gide",
  },
  {
    key: "movies",
    workType: "film",
    label: "Film & Diziler",
    icon: Clapperboard,
    placeholder: "örn: Masumiyet",
    help: "Bir film, dizi ya da yönetmen — sende iz bırakan neyse.",
    sourceChips: ["Letterboxd listen", "IMDb", "Netflix geçmişi", "düz metin"],
    textPlaceholder:
      "Film ve dizi listeni buraya yapıştır...\nörn: Uzak - Nuri Bilge Ceylan\nLeyla ile Mecnun\nKrzysztof Kieślowski",
  },
  {
    key: "music",
    workType: "song",
    label: "Müzik",
    icon: Music,
    placeholder: "örn: Sevme Zamanı",
    help: "Bir sanatçı, albüm ya da şarkı — dönüp durduğun neyse.",
    sourceChips: ["Spotify Wrapped", "çalma listesi", "Apple Music", "düz metin"],
    textPlaceholder:
      "Müzik listeni buraya yapıştır...\nörn: Adamlar\nBLOK3\nLa vie en rose - Edith Piaf",
  },
];

export const CATEGORY_BY_KEY: Record<CategoryKey, CategoryConfig> = {
  books: CATEGORIES[0],
  movies: CATEGORIES[1],
  music: CATEGORIES[2],
};

/** Kaynak rozetinde görünen etiket; elle girilenlerde rozet çıkmaz. */
export const SOURCE_LABELS: Record<string, string> = {
  screenshot: "ekran görüntüsü",
  paste: "yapıştırılan liste",
};
