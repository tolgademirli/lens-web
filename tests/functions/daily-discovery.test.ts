import { beforeEach, describe, expect, it, vi } from "vitest";
import * as daily from "../../supabase/functions/daily-discovery/index.ts";
import { checkBook, checkFilm } from "../../supabase/functions/daily-discovery/workCheck.ts";
import { SENSITIVE_INFERENCE_RULE } from "../../supabase/functions/_shared/sensitive.ts";
import { authedPost, claudeResponse, edgeHandler, internals, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryCall } from "../helpers/fake-supabase";

// Katalog kapısının kendi testi var (workCheck.test.ts); burada hükümler elle verilir
// ve sınanan şey handler'ın o hükümlerle NE YAPTIĞIDIR.
vi.mock("../../supabase/functions/daily-discovery/workCheck.ts", () => ({
  checkBook: vi.fn(),
  checkFilm: vi.fn(),
}));

const {
  trimBlocked,
  describeWork,
  describeAxes,
  buildPrompt,
  extractJson,
  normalizeDiscovery,
  originalTitleOf,
  displayName,
  toDiscovery,
  SYSTEM_PROMPT,
  MAX_ATTEMPTS,
  RETRY_BUDGET_MS,
  SLOTS,
} = internals(daily);

const blockedRow = (why: string, i: number, type = "film") => ({
  work_key: `${why}-${i}`,
  work_type: type,
  work_creator: `Yaratıcı ${i}`,
  work_title: `${why} ${i}`,
  why,
});
const many = (why: string, count: number, type = "film") =>
  Array.from({ length: count }, (_, i) => blockedRow(why, i, type));

/** Claude'un tek denemede döndürdüğü ham nesne. */
function suggestion(overrides: Partial<Record<"book" | "film" | "music", Record<string, unknown>>> = {}) {
  return {
    items: [
      { slot: "book", title: "Aylak Adam", original_title: "Aylak Adam", creator: "Yusuf Atılgan", reason: "kitap gerekçesi", genre: "roman", tone: 0.4, popularity: -0.2, era: -0.6, ...overrides.book },
      { slot: "film", title: "Masumiyet", original_title: "Masumiyet", creator: "Zeki Demirkubuz", reason: "film gerekçesi", genre: "dram", tone: 0.7, popularity: -0.3, era: 0.1, ...overrides.film },
      { slot: "music", title: "", creator: "Adamlar", reason: "müzik gerekçesi", genre: "rock", tone: 0, popularity: 0.2, era: 0.8, ...overrides.music },
    ],
  };
}

const report = {
  id: "report-1",
  hero: { archetype: "Kadife Ceketli Sokak Filozofu", summary: "Özet cümlesi." },
  texture: { descriptions: ["Islak asfalt."] },
  books: [{ title: "Tutunamayanlar", author: "Oğuz Atay" }],
  films: [{ title: "", director: "Nuri Bilge Ceylan" }],
  songs: [],
};

/* ------------------------------------------------------------------ */
/* Saf fonksiyonlar                                                    */
/* ------------------------------------------------------------------ */

describe("trimBlocked — prompt'a giren yasak liste", () => {
  it("'sevmediğim' kayıtları HİÇ kırpılmaz", () => {
    const out = trimBlocked([...many("disliked", 200), ...many("shown", 10)]);
    expect(out.filter((b: any) => b.why === "disliked")).toHaveLength(200);
  });

  it("katmanlar: disliked (sınırsız) > shown (en çok 55) > diğerleri (80'e tamamlar)", () => {
    const out = trimBlocked([...many("listed", 100), ...many("shown", 70), ...many("disliked", 10)]);

    expect(out.map((b: any) => b.why)).toEqual([
      ...Array(10).fill("disliked"),
      ...Array(55).fill("shown"),
      ...Array(25).fill("listed"),
    ]);
  });

  it("shown azsa kalan pay diğerlerine geçer", () => {
    const out = trimBlocked([...many("shown", 5), ...many("known", 200)]);
    expect(out.filter((b: any) => b.why === "shown")).toHaveLength(5);
    expect(out.filter((b: any) => b.why === "known")).toHaveLength(75);
  });

  // Dizi SQL'den en taze başta gelir; slice en tazeyi tutmalı.
  it("her katmanda GELİŞ SIRASINI korur ve baştan keser", () => {
    const out = trimBlocked(many("shown", 60));
    expect(out[0].work_key).toBe("shown-0");
    expect(out.at(-1).work_key).toBe("shown-54");
  });

  // Haftalık seçkideki kardeşinden farkı: burası üç slotu birden öneriyor.
  it("kitap ve şarkı satırlarını ATMAZ", () => {
    const out = trimBlocked([blockedRow("shown", 1, "book"), blockedRow("shown", 2, "song"), blockedRow("shown", 3, "film")]);
    expect(out).toHaveLength(3);
  });
});

describe("describeWork / describeAxes", () => {
  it("eseri 'başlık - yaratıcı' ya da eldeki tek alanla yazar", () => {
    expect(describeWork({ work_title: " Uzak ", work_creator: " Nuri Bilge Ceylan " })).toBe("Uzak - Nuri Bilge Ceylan");
    expect(describeWork({ work_title: null, work_creator: "Adamlar" })).toBe("Adamlar");
    expect(describeWork({ work_title: "Uzak", work_creator: null })).toBe("Uzak");
    expect(describeWork({ work_title: null, work_creator: null })).toBe("");
  });

  it("|değer| < 0.15 gürültüdür; 0.5'in üstü 'belirgin', altı 'hafifçe'", () => {
    expect(describeAxes({ tone: 0.14, popularity: -0.1, era: 0 })).toEqual([]);
    expect(describeAxes({ tone: 0.15 })).toEqual(["hafifçe daha karanlık/ağır işler"]);
    expect(describeAxes({ tone: 0.5 })).toEqual(["hafifçe daha karanlık/ağır işler"]);
    expect(describeAxes({ tone: 0.51 })).toEqual(["belirgin şekilde daha karanlık/ağır işler"]);
  });

  it("eksi değer eksenin öbür ucunu söyler", () => {
    expect(describeAxes({ tone: -0.8, popularity: -0.3, era: 0.9 })).toEqual([
      "belirgin şekilde daha aydınlık/hafif işler",
      "hafifçe daha niş, az bilinen işler",
      "belirgin şekilde daha çağdaş/yeni işler",
    ]);
  });

  it("profil yoksa ya da değer sayı değilse satır üretmez", () => {
    expect(describeAxes(null)).toEqual([]);
    expect(describeAxes({ tone: "0.9" })).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("arketibi, kullanıcının eserlerini ve boş kategoriyi '(yok)' diye yazar", () => {
    const prompt = buildPrompt(report, [], null);

    expect(prompt).toContain('Kullanıcının estetik arketipi: "Kadife Ceketli Sokak Filozofu"');
    expect(prompt).toContain("- Kitaplar: Tutunamayanlar - Oğuz Atay");
    // Başlığı boş sinyalde yalnızca yaratıcı yazılır.
    expect(prompt).toContain("- Filmler: Nuri Bilge Ceylan");
    expect(prompt).toContain("- Müzisyenler/Sanatçılar: (yok)");
    expect(prompt).not.toContain("ÖNERME —");
    expect(prompt).not.toContain("ÖNEMLİ:");
  });

  it("yasak listeyi, eksen yönelimini ve belirgin tür ağırlıklarını ekler", () => {
    const prompt = buildPrompt(report, [blockedRow("shown", 1)], {
      axes: { tone: 0.8 },
      genre_weights: { polisiye: 2.5, caz: 1, korku: -3, dram: 0.4 },
      signal_weight_total: 12,
      computed_at: "2026-10-01",
    });

    expect(prompt).toContain("ÖNERME — bunlar kullanıcının zaten karşısına çıktı");
    expect(prompt).toContain("- shown 1 - Yaratıcı 1");
    expect(prompt).toContain("belirgin şekilde daha karanlık/ağır işler");
    expect(prompt).toContain("Yakınlık duyduğu türler: polisiye, caz.");
    expect(prompt).toContain("Uzak durduğu türler: korku.");
    expect(prompt).not.toContain("dram");
  });

  it("tekrar denemesinde reddedilen eserleri NEDENİYLE birlikte söyler", () => {
    const prompt = buildPrompt(report, [], null, {
      blocked: ["Masumiyet - Zeki Demirkubuz"],
      unverified: ["Gecenin Öteki Yüzü - Ahmet Oktay", "Otomatik Portakal - Theo Angelopoulos"],
    });

    expect(prompt).toContain('Az önce "Masumiyet - Zeki Demirkubuz" önerdin, bu ÖNERME listesindeydi');
    expect(prompt).toContain(
      '"Gecenin Öteki Yüzü - Ahmet Oktay" ve "Otomatik Portakal - Theo Angelopoulos" önerdin; kataloglarda bu adla ve bu yaratıcıyla bulunamadı',
    );
  });

  // Eski raporlarda hero/texture null olabiliyor; tek bir null keşfi 500'e düşürmemeli.
  it("null JSONB kolonlarıyla patlamaz", () => {
    const bare = { id: "r", hero: null, texture: null, books: null, films: null, songs: null };
    const prompt = buildPrompt(bare, [], null);
    expect(prompt).toContain("- Kitaplar: (yok)");
    expect(prompt).not.toContain("estetik arketipi");
  });
});

describe("extractJson", () => {
  const json = JSON.stringify(suggestion());

  it("çıplak JSON'u, ```json çitini ve önündeki cümleyi kaldırır", () => {
    expect(extractJson(json)).toEqual(suggestion());
    expect(extractJson("```json\n" + json + "\n```")).toEqual(suggestion());
    expect(extractJson("İşte önerilerim:\n" + json + "\nUmarım beğenirsin.")).toEqual(suggestion());
  });

  // Model kendini düzeltip ikinci bir blok yazıyor; ilkini almak, modelin kendi
  // yakaladığı hatayı kullanıcıya sunmak demekti.
  it("birden çok blok varsa SONUNCUSUNU alır", () => {
    const first = JSON.stringify(suggestion({ music: { creator: "Markus Zusak" } }));
    const text = "```json\n" + first + "\n```\nDur — müzik önerimde hata var. Düzeltiyorum:\n```json\n" + json + "\n```";
    expect((extractJson(text) as any).items[2].creator).toBe("Adamlar");
  });

  it("JSON yoksa fırlatır", () => {
    expect(() => extractJson("Üzgünüm, öneremiyorum.")).toThrow("JSON bulunamadı");
    expect(() => extractJson("{ yarım")).toThrow();
  });
});

describe("normalizeDiscovery", () => {
  it("üç slotu sabit sırayla (kitap, film, müzik) kurar; eski kolonlar items'tan TÜRER", () => {
    const shuffled = { items: [...suggestion().items].reverse() };
    const discovery = normalizeDiscovery(shuffled);

    expect(discovery.items.map((i: any) => i.slot)).toEqual(["book", "film", "music"]);
    expect(discovery.book).toBe("Aylak Adam - Yusuf Atılgan");
    expect(discovery.film).toBe("Masumiyet - Zeki Demirkubuz");
    expect(discovery.music).toBe("Adamlar");
    expect(discovery.reasons).toEqual({ book: "kitap gerekçesi", film: "film gerekçesi", music: "müzik gerekçesi" });
  });

  // `original_title` yalnızca katalog aramasının girdisi; istemciye dönmez.
  it("items'a yalnızca bilinen alanları yazar", () => {
    const [book] = normalizeDiscovery(suggestion()).items;
    expect(Object.keys(book).sort()).toEqual(["creator", "era", "genre", "popularity", "reason", "slot", "title", "tone"]);
  });

  it("eksenleri [-1, 1]'e kırpar; sayı olmayan 0 olur", () => {
    const discovery = normalizeDiscovery(suggestion({ book: { tone: 5, popularity: "-0.4", era: "çok eski" } }));
    expect(discovery.items[0]).toMatchObject({ tone: 1, popularity: -0.4, era: 0 });
  });

  it("alanları kırpar", () => {
    const discovery = normalizeDiscovery(suggestion({ film: { title: "  Uzak  ", creator: " NBC ", reason: " r " } }));
    expect(discovery.items[1]).toMatchObject({ title: "Uzak", creator: "NBC", reason: "r" });
    expect(discovery.film).toBe("Uzak - NBC");
  });

  it.each([
    ["nesne değil", "metin"],
    ["null", null],
    ["items yok", {}],
    ["bir slot eksik", { items: suggestion().items.slice(0, 2) }],
    ["bir slotun adı da yaratıcısı da boş", suggestion({ music: { creator: "  " } })],
  ])("eksik öneri (%s) null döner — NOT NULL kolonlara eksik insert denenmez", (_label, raw) => {
    expect(normalizeDiscovery(raw)).toBeNull();
  });
});

describe("yardımcılar ve sabitler", () => {
  it("originalTitleOf slotun özgün adını okur, yoksa boş döner", () => {
    const raw = suggestion({ film: { original_title: "  Im Lauf der Zeit " } });
    expect(originalTitleOf(raw, "film")).toBe("Im Lauf der Zeit");
    expect(originalTitleOf(raw, "music")).toBe("");
    expect(originalTitleOf(null, "book")).toBe("");
    expect(originalTitleOf({ items: "bozuk" }, "book")).toBe("");
  });

  it("displayName ve toDiscovery aynı adı üretir", () => {
    const items = normalizeDiscovery(suggestion()).items;
    expect(displayName(items[2])).toBe("Adamlar");
    expect(toDiscovery(items).film).toBe(displayName(items[1]));
  });

  // 3 denendi; maliyet ve ~25 sn bekleme yüzünden geri alındı.
  it("bir keşif için en çok 2 Claude çağrısı yapılır", () => {
    expect(MAX_ATTEMPTS).toBe(2);
    expect(RETRY_BUDGET_MS).toBe(60_000);
    expect(SLOTS).toEqual(["book", "film", "music"]);
  });

  it("sistem prompt'u: hassas çıkarım kuralı + Türkçe karakter kuralı + gerçek eser kuralı", () => {
    expect(SYSTEM_PROMPT).toContain(SENSITIVE_INFERENCE_RULE);
    expect(SYSTEM_PROMPT).toContain("Türkçe karakterleri (ı, ş, ğ, ü, ö, ç, İ)");
    expect(SYSTEM_PROMPT).toContain("## YALNIZCA GERÇEK ESERLER");
    expect(SYSTEM_PROMPT).toContain('"original_title"');
  });
});

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

describe("handler", () => {
  const handler = edgeHandler();
  const user = { id: "user-1", email: "biri@example.com", user_metadata: { full_name: "Beyza Yılmaz" } };

  interface World {
    cached?: unknown;
    report?: unknown;
    blocked?: ReturnType<typeof blockedRow>[];
    /** lens_work_keys'in döndürdüğü anahtarlar: öğe adı → anahtar. */
    keyOf?: (item: { title: string; creator: string; type: string }) => string;
    insertError?: unknown;
    profile?: unknown;
  }

  function db(world: World = {}) {
    const fake = fakeSupabase({
      user,
      tables: {
        daily_discoveries: (q: QueryCall) =>
          q.has("insert")
            ? world.insertError
              ? { error: world.insertError }
              : { data: { id: "discovery-1" } }
            : { data: world.cached ?? null },
        reports: { data: world.report === undefined ? report : world.report },
        taste_profile: { data: world.profile ?? null },
      },
      rpcs: {
        lens_refresh_profile_if_due: { data: { profile_refreshed: true, signals_until_profile: 2 } },
        lens_blocked_works: { data: world.blocked ?? [] },
        lens_work_keys: (call: QueryCall) => ({
          data: (call.args as { p_items: any[] }).p_items.map((item) => world.keyOf?.(item) ?? `key:${item.title}`),
        }),
      },
    });
    useEdgeSupabase(fake.client);
    return fake;
  }

  /** Sırayla verilen yanıtları dönen sahte Claude. */
  function stubClaude(...responses: (unknown | Response)[]) {
    const queue = [...responses];
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      const next = queue.shift();
      if (next === undefined) throw new Error("Beklenmeyen Claude çağrısı");
      return next instanceof Response ? next : claudeResponse(JSON.stringify(next));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const promptOf = (fetchMock: ReturnType<typeof stubClaude>, call: number) =>
    JSON.parse(String(fetchMock.mock.calls[call][1]!.body)).messages[0].content as string;

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv();
    vi.mocked(checkBook).mockResolvedValue("title");
    vi.mocked(checkFilm).mockResolvedValue("title");
  });

  describe("kapılar", () => {
    it("Authorization yoksa 401 + no_auth_header; istemci kurulmaz", async () => {
      const res = await handler(request("POST"));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("no_auth_header");
      expect(createClientCalls).toHaveLength(0);
    });

    it("eksik ortam değişkeninde 500 + missing_env", async () => {
      stubEdgeEnv({ ANTHROPIC_API_KEY: "" });
      const res = await handler(authedPost({}));
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("missing_env");
    });

    it("geçersiz oturumda 401 + invalid_session", async () => {
      useEdgeSupabase(fakeSupabase({ user: null }).client);
      const fetchMock = stubClaude();
      const res = await handler(authedPost({}));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("invalid_session");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("raporu olmayan kullanıcıda 404 + no_report; Claude çağrılmaz", async () => {
      db({ report: null });
      const fetchMock = stubClaude();
      const res = await handler(authedPost({}));
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("no_report");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("OPTIONS'a CORS ile yanıt verir", async () => {
      expect((await handler(request("OPTIONS"))).status).toBe(200);
    });
  });

  describe("önbellek ve gün", () => {
    it("bugünün keşfi varsa onu döner; Claude ÇAĞRILMAZ", async () => {
      const cached = { id: "discovery-0", book: "A", film: "B", music: "C", date: "2026-10-11" };
      const fake = db({ cached });
      const fetchMock = stubClaude();

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...cached, profile_refreshed: true, signals_until_profile: 2 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.callsTo("reports")).toHaveLength(0);
    });

    // UTC 22:30 İstanbul'da ertesi günün 01:30'u.
    it("'bugün' İSTANBUL gününe göredir", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-10T22:30:00Z"));
      const fake = db();
      stubClaude(suggestion());

      const res = await handler(authedPost({}));

      const lookup = fake.callsTo("daily_discoveries")[0];
      expect(lookup.ops.filter((op) => op.method === "eq").map((op) => op.args)).toEqual([
        ["user_id", "user-1"],
        ["date", "2026-10-11"],
      ]);
      expect((await res.json()).date).toBe("2026-10-11");
    });
  });

  describe("temiz ilk deneme", () => {
    it("tek Claude çağrısıyla keşfi üretir, önbelleğe yazar ve döner", async () => {
      const fake = db();
      const fetchMock = stubClaude(suggestion());

      const res = await handler(authedPost({}));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body).toMatchObject({
        id: "discovery-1",
        book: "Aylak Adam - Yusuf Atılgan",
        film: "Masumiyet - Zeki Demirkubuz",
        music: "Adamlar",
        profile_refreshed: true,
        signals_until_profile: 2,
      });
      expect(body.items).toHaveLength(3);

      const row = fake.callsTo("daily_discoveries").find((q) => q.has("insert"))!.arg<Record<string, any>>("insert")!;
      expect(row).toMatchObject({ user_id: "user-1", report_id: "report-1", book: body.book, film: body.film, music: body.music });
      expect(row.items).toEqual(body.items);
    });

    it("kitap ve film kataloğa sorulur, MÜZİK sorulmaz", async () => {
      db();
      stubClaude(suggestion({ film: { original_title: "Innocence" } }));

      await handler(authedPost({}));

      expect(checkBook).toHaveBeenCalledExactlyOnceWith({
        title: "Aylak Adam",
        creator: "Yusuf Atılgan",
        originalTitle: "Aylak Adam",
      });
      expect(checkFilm).toHaveBeenCalledExactlyOnceWith({
        title: "Masumiyet",
        creator: "Zeki Demirkubuz",
        originalTitle: "Innocence",
      });
    });

    it("yasak küme boşsa anahtar RPC'si hiç çağrılmaz", async () => {
      const fake = db({ blocked: [] });
      stubClaude(suggestion());
      await handler(authedPost({}));
      expect(fake.callsTo("lens_work_keys")).toHaveLength(0);
    });

    it("önbelleğe yazılamasa da kullanıcı keşfini alır", async () => {
      db({ insertError: { message: "unique violation" } });
      stubClaude(suggestion());

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect((await res.json()).id).toBeNull();
    });
  });

  describe("katalog doğrulaması", () => {
    it("kitap bulunamazsa BİR kez daha dener ve nedenini modele söyler", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValueOnce("not_found").mockResolvedValue("title");
      const fetchMock = stubClaude(
        suggestion({ book: { title: "Şeytan ve İyi Yürekli İnsan", creator: "Ahmet Hamdi Tanpınar" } }),
        suggestion({ book: { title: "Huzur", creator: "Ahmet Hamdi Tanpınar" } }),
      );

      const body = await (await handler(authedPost({}))).json();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(promptOf(fetchMock, 0)).not.toContain("ÖNEMLİ:");
      expect(promptOf(fetchMock, 1)).toContain(
        '"Şeytan ve İyi Yürekli İnsan - Ahmet Hamdi Tanpınar" önerdin; kataloglarda bu adla ve bu yaratıcıyla bulunamadı',
      );
      expect(body.book).toBe("Huzur - Ahmet Hamdi Tanpınar");
    });

    // Tekrar denemesi tam bir Claude çağrısı; ilk denemenin sağlam öğesini atmak onu boşa harcardı.
    it("SLOTLAR BAĞIMSIZ: ilk denemede temiz çıkan film ve müzik elde tutulur", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValueOnce("not_found").mockResolvedValue("title");
      stubClaude(
        suggestion({ book: { title: "Uydurma Kitap" } }),
        suggestion({
          book: { title: "Huzur", creator: "Ahmet Hamdi Tanpınar" },
          film: { title: "İkinci Denemenin Filmi", creator: "Başka Yönetmen" },
          music: { creator: "İkinci Denemenin Sanatçısı" },
        }),
      );

      const body = await (await handler(authedPost({}))).json();

      expect(body.book).toBe("Huzur - Ahmet Hamdi Tanpınar");
      expect(body.film).toBe("Masumiyet - Zeki Demirkubuz");
      expect(body.music).toBe("Adamlar");
      expect(body.reasons.film).toBe("film gerekçesi");
    });

    // İkinci deneme, ilkinde sorunsuz olan slotu bozabiliyor (ölçümde 12'de 2-3).
    it("ikinci denemenin BOZUK filmi, ilkinin sağlam filminin yerini almaz", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValueOnce("not_found").mockResolvedValue("title");
      vi.mocked(checkFilm).mockResolvedValueOnce("title").mockResolvedValue("not_found");
      stubClaude(suggestion({ book: { title: "Uydurma Kitap" } }), suggestion({ film: { title: "Uydurma Film" } }));

      const body = await (await handler(authedPost({}))).json();

      expect(body.film).toBe("Masumiyet - Zeki Demirkubuz");
      expect(body.book).toBe("Aylak Adam - Yusuf Atılgan");
    });

    it("iki denemede de bulunamayan eser LOGLANIR ve yine de sunulur — üçüncü çağrı yok", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValue("not_found");
      const fetchMock = stubClaude(
        suggestion({ book: { title: "Uydurma Bir" } }),
        suggestion({ book: { title: "Uydurma İki" } }),
      );

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      // Eşit kusurda İLK denemenin öğesi kalır.
      expect((await res.json()).book).toBe("Uydurma Bir - Yusuf Atılgan");
      expect(console.error).toHaveBeenCalledWith(
        "[daily-discovery] DOĞRULANAMAYAN eser sunuluyor:",
        "Uydurma Bir - Yusuf Atılgan",
      );
    });

    it("ad doğrulanamaz ama özgün ad doğrulanırsa kartta ÖZGÜN ad gösterilir (tekrar deneme yok)", async () => {
      const fake = db();
      vi.mocked(checkFilm).mockResolvedValue("original");
      const fetchMock = stubClaude(
        suggestion({ film: { title: "Avrupa'nın Ortasında", creator: "Wim Wenders", original_title: "Im Lauf der Zeit" } }),
      );

      const body = await (await handler(authedPost({}))).json();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body.film).toBe("Im Lauf der Zeit - Wim Wenders");
      expect(body.items[1].title).toBe("Im Lauf der Zeit");
      const row = fake.callsTo("daily_discoveries").find((q) => q.has("insert"))!.arg<Record<string, any>>("insert")!;
      expect(row.film).toBe("Im Lauf der Zeit - Wim Wenders");
    });

    it("katalog sorulamadıysa ('unknown') öneri olduğu gibi geçer", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValue("unknown");
      vi.mocked(checkFilm).mockResolvedValue("unknown");
      const fetchMock = stubClaude(suggestion());

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // Aydınlatma Metni: "Anthropic — … Adın ve e-posta adresin gönderilmez."
  it("Claude'a kullanıcının e-postası, adı ya da kimliği GİTMEZ — tekrar denemesinde de", async () => {
    db();
    vi.mocked(checkBook).mockResolvedValueOnce("not_found").mockResolvedValue("title");
    const fetchMock = stubClaude(suggestion(), suggestion());

    await handler(authedPost({}));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = fetchMock.mock.calls.map(([, init]) => String(init?.body)).join(" ");
    for (const secret of [user.email, user.id, "Beyza"]) expect(sent).not.toContain(secret);
  });

  describe("yasak küme", () => {
    const blocked = [{ ...blockedRow("shown", 1), work_key: "key:Masumiyet" }];

    it("yasaklı eser önerilirse yeniden sorar ve hangisi olduğunu söyler", async () => {
      const fake = db({ blocked });
      const fetchMock = stubClaude(suggestion(), suggestion({ film: { title: "Kader", creator: "Zeki Demirkubuz" } }));

      const body = await (await handler(authedPost({}))).json();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(promptOf(fetchMock, 1)).toContain('"Masumiyet - Zeki Demirkubuz" önerdin, bu ÖNERME listesindeydi');
      expect(body.film).toBe("Kader - Zeki Demirkubuz");
      // Anahtarları veritabanı üretir; müzik motorda 'song' tipidir.
      expect((fake.callsTo("lens_work_keys")[0].args as any).p_items).toEqual([
        { type: "book", creator: "Yusuf Atılgan", title: "Aylak Adam" },
        { type: "film", creator: "Zeki Demirkubuz", title: "Masumiyet" },
        { type: "song", creator: "Adamlar", title: "" },
      ]);
    });

    it("ikinci denemede de yasaklıysa yine de sunar (boş kart daha kötü)", async () => {
      db({ blocked });
      const fetchMock = stubClaude(suggestion(), suggestion());

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await res.json()).film).toBe("Masumiyet - Zeki Demirkubuz");
    });

    // Olmayan eser (yanlış bilgi), tekrar eden eserden (sıkıcılık) KÖTÜDÜR.
    it("tekrar eden eser, katalogda olmayan eserle DEĞİŞTİRİLMEZ", async () => {
      db({ blocked });
      vi.mocked(checkFilm).mockResolvedValueOnce("title").mockResolvedValue("not_found");
      stubClaude(suggestion(), suggestion({ film: { title: "Uydurma Film" } }));

      const body = await (await handler(authedPost({}))).json();

      expect(body.film).toBe("Masumiyet - Zeki Demirkubuz");
    });

    it("anahtar üretilemezse doğrulama atlanır, öneri engellenmez", async () => {
      const fake = fakeSupabase({
        user,
        tables: {
          daily_discoveries: (q: QueryCall) => (q.has("insert") ? { data: { id: "d" } } : { data: null }),
          reports: { data: report },
          taste_profile: { data: null },
        },
        rpcs: {
          lens_refresh_profile_if_due: { data: null },
          lens_blocked_works: { data: blocked },
          lens_work_keys: { error: { message: "boom" } },
        },
      });
      useEdgeSupabase(fake.client);
      const fetchMock = stubClaude(suggestion());

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Claude hataları", () => {
    it.each([
      ["HTTP hatası", new Response("overloaded", { status: 529 }), "claude_http_529"],
      ["kırpılmış yanıt", claudeResponse("{", { stop_reason: "max_tokens" }), "claude_truncated"],
      ["bozuk JSON", claudeResponse("öneri yok"), "claude_bad_json"],
      ["eksik slot", claudeResponse(JSON.stringify({ items: suggestion().items.slice(0, 2) })), "claude_incomplete"],
    ])("ilk denemede %s → 502 + %s kodu, önbelleğe yazılmaz", async (_label, response, code) => {
      const fake = db();
      // Response gövdesi tek kez okunabilir; her test taze kopya alır.
      stubClaude(response.clone());

      const res = await handler(authedPost({}));

      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe(code);
      expect(fake.callsTo("daily_discoveries").some((q) => q.has("insert"))).toBe(false);
    });

    it("Claude'a ulaşılamazsa 502 + claude_unreachable", async () => {
      db();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
      const res = await handler(authedPost({}));
      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe("claude_unreachable");
    });

    // İçinde bir tekrar barındıran keşif, boş karttan iyidir.
    it("TEKRAR denemesi başarısız olursa ilk denemenin önerisi sunulur", async () => {
      db();
      vi.mocked(checkBook).mockResolvedValue("not_found");
      stubClaude(suggestion(), new Response("overloaded", { status: 529 }));

      const res = await handler(authedPost({}));

      expect(res.status).toBe(200);
      expect((await res.json()).book).toBe("Aylak Adam - Yusuf Atılgan");
    });
  });

  it("yasak küme ve profil okunamasa da keşif üretilir (daha kör, ama boş değil)", async () => {
    const fake = fakeSupabase({
      user,
      tables: {
        daily_discoveries: (q: QueryCall) => (q.has("insert") ? { data: { id: "d" } } : { error: { message: "cache" } }),
        reports: { data: report },
        taste_profile: { error: { message: "profile" } },
      },
      rpcs: {
        lens_refresh_profile_if_due: { error: { message: "tempo" } },
        lens_blocked_works: { error: { message: "blocked" } },
      },
    });
    useEdgeSupabase(fake.client);
    stubClaude(suggestion());

    const res = await handler(authedPost({}));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ profile_refreshed: false, signals_until_profile: 0, music: "Adamlar" });
  });
});
