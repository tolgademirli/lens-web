import { describe, expect, it } from "vitest";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  candidateCount,
  describeAxes,
  extractJson,
  normalizeCandidates,
  trimBlocked,
  type BlockedWork,
  type PromptInput,
} from "../../supabase/functions/generate-weekly-picks/prompt.ts";
import { SENSITIVE_INFERENCE_RULE } from "../../supabase/functions/_shared/sensitive.ts";

const blockedRow = (why: string, i: number, type = "film"): BlockedWork => ({
  work_key: `${why}-${type}-${i}`,
  work_type: type,
  work_creator: `Yaratıcı ${i}`,
  work_title: `${why} ${i}`,
  why,
});
const many = (why: string, count: number, type = "film") =>
  Array.from({ length: count }, (_, i) => blockedRow(why, i, type));

const candidate = (fields: Record<string, unknown> = {}) => ({
  title: "Chungking Express",
  title_en: "Chungking Express",
  year: 1994,
  media_type: "movie",
  creator: "Wong Kar-wai",
  blurb: "Şehirde iki insanın birbirini ıskalaması, tam senin tempon.",
  genre: "Romantik",
  tone: 0.1,
  popularity: -0.3,
  era: -0.4,
  ...fields,
});

const input = (overrides: Partial<PromptInput> = {}): PromptInput => ({
  report: {
    hero: { archetype: "Kadife Ceketli Sokak Filozofu", summary: "Özet." },
    texture: { descriptions: ["Islak asfalt."] },
    books: [{ title: "Tutunamayanlar", creator: "Oğuz Atay" }],
    films: ["Uzak - Nuri Bilge Ceylan"],
    songs: null,
  },
  profile: null,
  blocked: [],
  platformLabels: [],
  wanted: 5,
  ...overrides,
});

describe("trimBlocked — yalnızca film/dizi", () => {
  // Yasak kitap ve şarkıları basmak modele hiçbir şey söylemeden bütçeyi yer.
  it("film dışı satırları ATAR (günlük keşifteki kardeşi atmaz)", () => {
    const out = trimBlocked([blockedRow("shown", 1, "book"), blockedRow("disliked", 2, "song"), blockedRow("shown", 3)]);
    expect(out.map((b) => b.work_type)).toEqual(["film"]);
  });

  it("katmanlar: disliked (sınırsız) > shown (en çok 55) > diğerleri (80'e tamamlar)", () => {
    const out = trimBlocked([...many("listed", 100), ...many("shown", 70), ...many("disliked", 90)]);
    expect(out.filter((b) => b.why === "disliked")).toHaveLength(90);
    expect(out.filter((b) => b.why === "shown")).toHaveLength(55);
    expect(out.filter((b) => b.why === "listed")).toHaveLength(25);
    expect(out[0].why).toBe("disliked");
    expect(out.at(-1)!.why).toBe("listed");
  });

  it("her katmanda geliş sırasını korur (en taze başta)", () => {
    const out = trimBlocked(many("shown", 60));
    expect(out[0].work_title).toBe("shown 0");
    expect(out).toHaveLength(55);
  });
});

describe("describeAxes", () => {
  it("günlük keşifle AYNI eşikler: 0.15 altı gürültü, 0.5 üstü belirgin", () => {
    expect(describeAxes({ tone: 0.14, popularity: -0.14 })).toEqual([]);
    expect(describeAxes({ tone: 0.15 })).toEqual(["hafifçe karanlık ve ağır"]);
    expect(describeAxes({ tone: 0.5 })).toEqual(["hafifçe karanlık ve ağır"]);
    expect(describeAxes({ tone: -0.6, popularity: 0.9, era: -0.2 })).toEqual([
      "belirgin şekilde aydınlık ve hafif",
      "belirgin şekilde popüler, bilinen",
      "hafifçe klasik, eski",
    ]);
  });

  it("tanınmayan ekseni, sayı olmayan değeri ve boş profili atlar", () => {
    expect(describeAxes({ energy: 0.9, tone: "0.9" as never })).toEqual([]);
    expect(describeAxes(null)).toEqual([]);
    expect(describeAxes(undefined)).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("raporu, eser listelerini (nesne ya da string) ve istenen aday sayısını yazar", () => {
    const prompt = buildPrompt(input({ wanted: 9 }));

    expect(prompt).toContain('Kullanıcının estetik arketipi: "Kadife Ceketli Sokak Filozofu"');
    expect(prompt).toContain('Atmosfer/doku: "Islak asfalt."');
    expect(prompt).toContain("- Kitaplar: Tutunamayanlar - Oğuz Atay");
    expect(prompt).toContain("- Filmler: Uzak - Nuri Bilge Ceylan");
    expect(prompt).toContain("- Müzisyenler/Sanatçılar: (yok)");
    expect(prompt).toContain("çakışmayan 9 film/dizi adayı öner");
  });

  // Ücretsiz yolda platformLabels BOŞ gelir; platform satırı hiç kurulmaz.
  it("platform ipucu YALNIZCA etkin bir filtre varsa yazılır", () => {
    expect(buildPrompt(input())).not.toContain("platformları kullanıyor");
    expect(buildPrompt(input({ platformLabels: ["Netflix", "MUBI"] }))).toContain(
      "Kullanıcı yalnızca şu platformları kullanıyor: Netflix, MUBI.",
    );
  });

  it("yasak listeyi 'başlık - yaratıcı' satırlarıyla, yalnızca filmlerden kurar", () => {
    const prompt = buildPrompt(input({ blocked: [blockedRow("shown", 1), blockedRow("shown", 2, "book")] }));
    expect(prompt).toContain("ÖNERME — bunlar kullanıcının zaten karşısına çıktı");
    expect(prompt).toContain("- shown 1 - Yaratıcı 1");
    expect(prompt).not.toContain("shown 2");
  });

  it("ikinci turda erişilemeyen başlıkları ve yasak ihlalini söyler", () => {
    const prompt = buildPrompt(input({ unavailable: ["Stalker", "Ayna"], violation: "Uzak" }));
    expect(prompt).toContain("erişilebilirlik kontrolünden geçemedi, TEKRAR ÖNERME: Stalker, Ayna.");
    expect(prompt).toContain('Az önce "Uzak" önerdin, bu ÖNERME listesindeydi');

    const first = buildPrompt(input({ unavailable: [] }));
    expect(first).not.toContain("TEKRAR ÖNERME");
    expect(first).not.toContain("ÖNEMLİ:");
  });

  it("profil varsa yönelimi ve |ağırlık| ≥ 1 olan türleri ekler", () => {
    const prompt = buildPrompt(
      input({ profile: { axes: { era: 0.7 }, genre_weights: { polisiye: 3, dram: 0.9, korku: -1 } } }),
    );
    expect(prompt).toContain("belirgin şekilde çağdaş, yeni");
    expect(prompt).toContain("Yakınlık duyduğu türler: polisiye.");
    expect(prompt).toContain("Uzak durduğu türler: korku.");
    expect(prompt).not.toContain("dram");
  });

  it("boş raporla patlamaz", () => {
    const prompt = buildPrompt(input({ report: { hero: null, texture: null, books: "bozuk", films: null, songs: undefined } }));
    expect(prompt).toContain("- Kitaplar: (yok)");
    expect(prompt).not.toContain("estetik arketipi");
  });
});

describe("extractJson", () => {
  const body = { items: [candidate()] };

  it("çıplak JSON, ```json çiti ve önünde cümle olan yanıtı ayrıştırır", () => {
    expect(extractJson(JSON.stringify(body))).toEqual(body);
    expect(extractJson("```json\n" + JSON.stringify(body) + "\n```")).toEqual(body);
    expect(extractJson("İşte adaylar: " + JSON.stringify(body) + " — iyi seyirler")).toEqual(body);
  });

  // Günlük keşiftekinden farklı: burada fırlatmaz, çağıran 'claude_bad_json' der.
  it("JSON yoksa null döner, fırlatmaz", () => {
    expect(extractJson("aday yok")).toBeNull();
    expect(extractJson("{ yarım kalmış")).toBeNull();
    expect(extractJson("}{")).toBeNull();
  });
});

describe("normalizeCandidates", () => {
  it("düz gelen etiketleri `tags` altına indirir ve türü küçük harfe çevirir", () => {
    expect(normalizeCandidates({ items: [candidate()] })).toEqual([
      {
        title: "Chungking Express",
        title_en: "Chungking Express",
        year: 1994,
        media_type: "movie",
        creator: "Wong Kar-wai",
        blurb: "Şehirde iki insanın birbirini ıskalaması, tam senin tempon.",
        tags: { tone: 0.1, popularity: -0.3, era: -0.4, genre: "romantik" },
      },
    ]);
  });

  // 9 adaydan 7'si sağlamsa seçki yine kurulabilir.
  it("eksik/bozuk adayı DÜŞÜRÜR, yanıtın tamamını çöpe atmaz", () => {
    const out = normalizeCandidates({
      items: [
        candidate({ title: "Sağlam" }),
        candidate({ title: "" }),
        candidate({ title: "Blurb yok", blurb: "  " }),
        candidate({ title: "Yıl yok", year: null }),
        candidate({ title: "Yıl metin", year: "bilinmiyor" }),
        candidate({ title: "Yıl saçma", year: 1700 }),
        candidate({ title: "Yıl gelecek", year: 2100 }),
        candidate({ title: "Yıl kesirli", year: 1994.5 }),
        null,
        "metin",
      ],
    });
    expect(out.map((c) => c.title)).toEqual(["Sağlam"]);
  });

  it("string gelen yılı sayıya çevirir", () => {
    expect(normalizeCandidates({ items: [candidate({ year: "2019" })] })[0].year).toBe(2019);
  });

  it("media_type yalnızca 'tv' ise dizidir; gerisi film", () => {
    const out = normalizeCandidates({
      items: [
        candidate({ title: "A", title_en: "A", media_type: "tv" }),
        candidate({ title: "B", title_en: "B", media_type: "series" }),
        candidate({ title: "C", title_en: "C", media_type: undefined }),
      ],
    });
    expect(out.map((c) => c.media_type)).toEqual(["tv", "movie", "movie"]);
  });

  it("title_en yoksa görünen ada düşer", () => {
    expect(normalizeCandidates({ items: [candidate({ title: "Yeşil Işın", title_en: " " })] })[0].title_en).toBe("Yeşil Işın");
  });

  // Claude bazen aynı eseri iki yazımla verir.
  it("aynı yanıttaki tekrarı atar (tip + özgün ad + yıl)", () => {
    const out = normalizeCandidates({
      items: [
        candidate({ title: "Yeşil Işın", title_en: "The Green Ray", year: 1986 }),
        candidate({ title: "Yeşil Işık", title_en: "THE GREEN RAY", year: 1986 }),
        candidate({ title: "Aynı ad, başka yıl", title_en: "The Green Ray", year: 2001 }),
        candidate({ title: "Aynı ad, dizi", title_en: "The Green Ray", year: 1986, media_type: "tv" }),
      ],
    });
    expect(out.map((c) => c.title)).toEqual(["Yeşil Işın", "Aynı ad, başka yıl", "Aynı ad, dizi"]);
  });

  it("eksenleri [-1, 1]'e kırpar; sayı olmayan 0 olur", () => {
    const [c] = normalizeCandidates({ items: [candidate({ tone: 4, popularity: "-7", era: "eski" })] });
    expect(c.tags).toMatchObject({ tone: 1, popularity: -1, era: 0 });
  });

  it.each([[null], [{}], [{ items: "liste" }], ["metin"]])("items dizi değilse (%j) boş döner", (raw) => {
    expect(normalizeCandidates(raw)).toEqual([]);
  });
});

describe("candidateCount", () => {
  it.each([
    [0, 5], // filtre yok: doğrulama da yok, 5 aday 3 öğeyi doldurur
    [1, 9],
    [2, 9], // dar filtre: hayatta kalma oranı düşük
    [3, 7],
    [8, 7],
  ])("%i platform → %i aday", (platforms, expected) => {
    expect(candidateCount(platforms)).toBe(expected);
  });
});

describe("sistem prompt'u", () => {
  it("hassas çıkarım kuralını ve açık Türkçe karakter kuralını BİRLİKTE içerir", () => {
    expect(SYSTEM_PROMPT).toContain(SENSITIVE_INFERENCE_RULE);
    expect(SYSTEM_PROMPT).toContain("Türkçe karakterleri (ı, ş, ğ, ü, ö, ç, İ)");
  });

  it("erişilebilirlik doğrulamasının girdilerini zorunlu tutar", () => {
    for (const field of ["title_en", "year", "media_type", "blurb"]) expect(SYSTEM_PROMPT).toContain(`- ${field}:`);
  });
});
