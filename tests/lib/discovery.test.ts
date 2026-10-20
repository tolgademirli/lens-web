import { describe, expect, it } from "vitest";
import { dailyDiscoveryCards, feedbackForCard, weeklyPickCards } from "@/lib/discovery";
import type { DailyDiscovery, DiscoveryFeedback, WeeklyPick } from "@/lib/types";

const daily = (fields: Record<string, unknown>) => fields as unknown as DailyDiscovery;
const weekly = (films: unknown) => ({ id: "pick-1", films }) as unknown as WeeklyPick;

describe("dailyDiscoveryCards", () => {
  it("`items` varsa onu kullanır; müzik slotu motorda 'song' tipidir", () => {
    const cards = dailyDiscoveryCards(
      daily({
        book: "eski - alan",
        items: [
          { slot: "book", title: "Aylak Adam", creator: "Yusuf Atılgan", reason: "r1" },
          { slot: "film", title: "Masumiyet", creator: "Zeki Demirkubuz", reason: "r2" },
          { slot: "music", title: "", creator: "Adamlar", reason: "r3" },
        ],
      }),
    );

    expect(cards.map((c) => [c.key, c.workType, c.slot])).toEqual([
      ["daily-book", "book", "book"],
      ["daily-film", "film", "film"],
      ["daily-music", "song", "music"],
    ]);
    expect(cards[0]).toMatchObject({ title: "Aylak Adam", creator: "Yusuf Atılgan", reason: "r1" });
    expect(cards[2]).toMatchObject({ title: "", creator: "Adamlar" });
  });

  describe("eski satırlar (items yok)", () => {
    const cards = dailyDiscoveryCards(
      daily({
        book: "Yabancı - Albert Camus",
        film: "Blade Runner - 2049 - Denis Villeneuve",
        music: "Adamlar",
        reasons: { book: "kitap gerekçesi", film: "film gerekçesi" },
      }),
    );

    it("SON ayıraçtan böler: ayıraç başlıkta geçebilir", () => {
      expect(cards[1]).toMatchObject({ title: "Blade Runner - 2049", creator: "Denis Villeneuve" });
      expect(cards[0]).toMatchObject({ title: "Yabancı", creator: "Albert Camus" });
    });

    it("müzik önerisi yalnızca sanatçı adıdır", () => {
      expect(cards[2]).toMatchObject({ title: "", creator: "Adamlar", workType: "song" });
    });

    it("eksik gerekçe boş string olur", () => {
      expect(cards.map((c) => c.reason)).toEqual(["kitap gerekçesi", "film gerekçesi", ""]);
    });

    it("ayıraçsız satırı tahmin yürütmeden BAŞLIK sayar", () => {
      const [book] = dailyDiscoveryCards(daily({ book: "Tutunamayanlar", film: "", music: "" }));
      expect(book).toMatchObject({ title: "Tutunamayanlar", creator: "" });
    });

    it("boş alanlarda patlamaz", () => {
      const out = dailyDiscoveryCards(daily({ book: null, film: undefined, music: "" }));
      expect(out).toHaveLength(3);
      expect(out.every((c) => c.title === "" && c.creator === "")).toBe(true);
    });
  });
});

describe("weeklyPickCards", () => {
  const films = [
    { title: "Chungking Express", year: 1994, blurb: "b1", director: "Wong Kar-wai", watch_url: "https://v2", justwatch_url: "https://v1", media_type: "movie" },
    { title: "Chernobyl", year: 2019, blurb: "b2", justwatch_url: "https://v1-only", media_type: "tv" },
    { title: "Yılsız", year: Number.NaN, blurb: "b3" },
  ];
  const cards = weeklyPickCards(weekly(films));

  // lens_active_signals'ın `(ord - 1)::TEXT = f.slot` eşlemesi buna dayanıyor.
  it("slot DİZİ İNDEKSİDİR (string) — değişirse geçmiş sinyaller yanlış esere bağlanır", () => {
    expect(cards.map((c) => c.slot)).toEqual(["0", "1", "2"]);
    expect(cards.map((c) => c.key)).toEqual(["weekly-0", "weekly-1", "weekly-2"]);
  });

  it("dizi de film de motorda 'film' tipidir; mediaType yalnızca gösterim içindir", () => {
    expect(cards.map((c) => c.workType)).toEqual(["film", "film", "film"]);
    expect(cards.map((c) => c.mediaType)).toEqual(["movie", "tv", undefined]);
  });

  it("izleme linkinde v2 alanı önce, v1 yedek; ikisi de yoksa undefined", () => {
    expect(cards.map((c) => c.watchUrl)).toEqual(["https://v2", "https://v1-only", undefined]);
  });

  it("blurb gerekçe, director yaratıcı olur; eksikse boş string", () => {
    expect(cards[0]).toMatchObject({ reason: "b1", creator: "Wong Kar-wai", year: 1994 });
    expect(cards[1].creator).toBe("");
  });

  it("sayı olmayan yıl gösterilmez", () => {
    expect(cards[2].year).toBeUndefined();
  });

  it("films null ise boş liste döner", () => {
    expect(weeklyPickCards(weekly(null))).toEqual([]);
  });
});

describe("feedbackForCard", () => {
  const feedback = [
    { id: "f1", daily_discovery_id: "d1", weekly_pick_id: null, slot: "book" },
    { id: "f2", daily_discovery_id: null, weekly_pick_id: "w1", slot: "0" },
  ] as unknown as DiscoveryFeedback[];

  it("kartı kimliğiyle (kaynak id'si + slot) eşler", () => {
    expect(feedbackForCard(feedback, "d1", "book")?.id).toBe("f1");
    expect(feedbackForCard(feedback, "w1", "0")?.id).toBe("f2");
  });

  it("slot ya da kaynak tutmuyorsa null döner", () => {
    expect(feedbackForCard(feedback, "d1", "film")).toBeNull();
    expect(feedbackForCard(feedback, "baska", "book")).toBeNull();
  });

  it.each([[null], [undefined], [""]])("kaynak id'si yoksa (%j) null döner", (sourceId) => {
    expect(feedbackForCard(feedback, sourceId, "book")).toBeNull();
  });
});
