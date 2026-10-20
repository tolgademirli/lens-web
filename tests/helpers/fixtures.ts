import type { Report } from "../../src/lib/types";

/** `analyze`'ın Claude'dan beklediği ham çıktı (arketip henüz NESNE). */
export function claudeReportJson() {
  return {
    hero: {
      archetype: {
        full: "Kadife Ceketli Sokak Filozofu",
        qualifier: "Kadife ceketli",
        core: "Sokak Filozofu",
      },
      summary: "Salonla sokağı aynı cümlede buluşturan, merakı ciddiyetinden büyük biri.",
    },
    texture: {
      descriptions: ["Islak asfaltta yürürken duyulan uzak bir plak sesi."],
      colors: [
        { name: "Is Siyahı", hex: "#1a1a1a", description: "Gecenin dibi." },
        { name: "Pas Turuncusu", hex: "#b5532a", description: "Eskimiş sıcaklık." },
        { name: "Soluk Krem", hex: "#e8dfc8", description: "Sararmış sayfa." },
      ],
    },
    threads: [
      { title: "Sessiz İsyan", description: "Bağırmadan karşı duran işler." },
      { title: "Yarım Kalan", description: "Bitmemişliğin tadı." },
    ],
    contrasts: [
      {
        left: { title: "Tutunamayanlar", subtitle: "içe kapanan zihin", poster: "toz", description: "" },
        right: { title: "BLOK3", subtitle: "dışa patlayan enerji", poster: "ışık", description: "" },
        explanation: { title: "İki uç", text: "Biri susar, öbürü bağırır." },
      },
    ],
    shadow: [
      { type: "Kitap", title: "Aylak Adam", author_or_artist: "Yusuf Atılgan", year: "1959", description: "Sana yakın." },
      { type: "Film", title: "Masumiyet", author_or_artist: "Zeki Demirkubuz", year: "1997", description: "Sana yakın." },
      { type: "Müzik", title: null, author_or_artist: "Adamlar", year: null, description: "Sana yakın." },
    ],
  };
}

/** Veritabanından okunmuş hâliyle rapor (arketip DÜZ STRING). */
export function reportRow(overrides: Partial<Report> = {}): Report {
  const raw = claudeReportJson();
  return {
    id: "11111111-2222-3333-4444-555555555555",
    user_id: "user-1",
    created_at: "2026-10-01T10:00:00Z",
    is_public: true,
    source: "web",
    books: [],
    films: [],
    songs: [],
    hero: {
      archetype: raw.hero.archetype.full,
      archetype_qualifier: raw.hero.archetype.qualifier,
      archetype_core: raw.hero.archetype.core,
      summary: raw.hero.summary,
    },
    texture: raw.texture,
    threads: raw.threads,
    contrasts: raw.contrasts,
    shadow: raw.shadow,
    ...overrides,
  } as unknown as Report;
}

/** N adet yapılı sinyal — `analyze` gövdesi ve taslak testleri için. */
export function signals(count: number, prefix = "Eser") {
  return Array.from({ length: count }, (_, i) => ({
    title: `${prefix} ${i + 1}`,
    creator: `Yaratıcı ${i + 1}`,
    source: "manual",
    work_id: "",
  }));
}
