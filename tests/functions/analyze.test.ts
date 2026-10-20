import { beforeEach, describe, expect, it, vi } from "vitest";
import * as analyze from "../../supabase/functions/analyze/index.ts";
import { SENSITIVE_INFERENCE_RULE } from "../../supabase/functions/_shared/sensitive.ts";
import { authedPost, claudeResponse, edgeHandler, internals, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryCall } from "../helpers/fake-supabase";
import { claudeReportJson, signals } from "../helpers/fixtures";

const {
  parseEntry,
  normalizeCategory,
  formatSignal,
  isBare,
  buildPrompt,
  fixConfusables,
  normalizeArchetype,
  InvalidInput,
  SYSTEM_PROMPT,
  MIN_TOTAL,
  MAX_ITEMS,
  MAX_CHARS,
  DAILY_LIMIT,
} = internals(analyze);

const signal = (title: string, creator: string) => ({ title, creator, source: "manual", workId: null });

describe("parseEntry — eski tek-string biçimi", () => {
  it("SON ' - ' ile böler: eser adının kendisi tire içerebilir", () => {
    expect(parseEntry("Sıcak - Soğuk Mevsimler - Camus")).toEqual(["Sıcak - Soğuk Mevsimler", "Camus"]);
  });

  it("ayıraç yoksa tamamını yaratıcıya yazar", () => {
    expect(parseEntry("  Orhan Pamuk ")).toEqual(["", "Orhan Pamuk"]);
  });
});

describe("normalizeCategory", () => {
  it("yapılı sinyali kırpar ve work_id'yi workId'ye çevirir", () => {
    expect(
      normalizeCategory([{ title: " Uzak ", creator: " Nuri Bilge Ceylan ", source: "paste", work_id: "w-1" }]),
    ).toEqual([{ title: "Uzak", creator: "Nuri Bilge Ceylan", source: "paste", workId: "w-1" }]);
  });

  it.each([["import"], [undefined], [42], [""]])("tanınmayan source (%j) 'form'a düşer", (source) => {
    expect(normalizeCategory([{ title: "A", creator: "B", source }])[0].source).toBe("form");
  });

  it.each(["screenshot", "paste", "manual", "form"])("geçerli source '%s' korunur", (source) => {
    expect(normalizeCategory([{ title: "A", creator: "", source }])[0].source).toBe(source);
  });

  it("boş work_id null olur (analyze havuza kendisi yazar)", () => {
    expect(normalizeCategory([{ title: "A", creator: "", work_id: "" }])[0].workId).toBeNull();
    expect(normalizeCategory([{ title: "A", creator: "" }])[0].workId).toBeNull();
  });

  it("eski string[] biçimini paralel sources/work_ids ile birlikte okur", () => {
    expect(
      normalizeCategory(["Uzak - Nuri Bilge Ceylan", "Adamlar"], ["screenshot", "manual"], ["w-1", ""]),
    ).toEqual([
      { title: "Uzak", creator: "Nuri Bilge Ceylan", source: "screenshot", workId: "w-1" },
      { title: "", creator: "Adamlar", source: "manual", workId: null },
    ]);
  });

  it("yalnız eser adı ya da yalnız yaratıcı geçerlidir", () => {
    expect(normalizeCategory([{ title: "Bulantı", creator: "" }])).toHaveLength(1);
    expect(normalizeCategory([{ title: "", creator: "Kafka" }])).toHaveLength(1);
  });

  it("boş dizi geçerlidir — kategori boş kalabilir", () => {
    expect(normalizeCategory([])).toEqual([]);
  });

  it.each([
    ["dizi değil", { not: "array" }],
    ["tanımsız", undefined],
    ["nesne/string olmayan eleman", [42]],
    ["null eleman", [null]],
  ])("geçersiz biçim (%s) InvalidInput fırlatır", (_label, raw) => {
    expect(() => normalizeCategory(raw)).toThrow(InvalidInput);
  });

  it(`kategori başına ${MAX_ITEMS} tavanını aşan girdiyi reddeder`, () => {
    expect(() => normalizeCategory(signals(MAX_ITEMS + 1))).toThrow(/en fazla 8 sinyal/);
    expect(normalizeCategory(signals(MAX_ITEMS))).toHaveLength(MAX_ITEMS);
  });

  it("iki alanı da boş sinyali reddeder", () => {
    expect(() => normalizeCategory([{ title: "  ", creator: "" }])).toThrow(/en az bir ad/);
  });

  it(`${MAX_CHARS} karakteri aşan adı reddeder`, () => {
    const long = "a".repeat(MAX_CHARS + 1);
    expect(() => normalizeCategory([{ title: long, creator: "" }])).toThrow(InvalidInput);
    expect(() => normalizeCategory([{ title: "", creator: long }])).toThrow(InvalidInput);
    expect(normalizeCategory([{ title: "a".repeat(MAX_CHARS), creator: "" }])).toHaveLength(1);
  });
});

describe("formatSignal — 'yön.' öneki", () => {
  it("başlık ve yaratıcı birlikteyse öneki yazar", () => {
    expect(formatSignal(signal("Uzak", "Nuri Bilge Ceylan"), 0, "yön. ")).toBe(
      "  1. *Uzak* — yön. Nuri Bilge Ceylan",
    );
  });

  // Regresyon: önek koşulsuzken prompt'a "yön. Asmalı Konak" düşüyor ve modele
  // olmayan bir yönetmen olgu diye dayatılıyordu.
  it("tek ad gelen satırda öneki YAZMAZ — eser mi kişi mi bilmiyoruz", () => {
    expect(formatSignal(signal("", "Asmalı Konak"), 2, "yön. ")).toBe("  3. Asmalı Konak");
  });

  it("yalnız başlık yıldızla, öneksiz yazılır", () => {
    expect(formatSignal(signal("Leyla ile Mecnun", ""), 0, "yön. ")).toBe("  1. *Leyla ile Mecnun*");
  });

  it("isBare yalnızca başlıksız + yaratıcılı satırı işaretler", () => {
    expect(isBare(signal("", "Kafka"))).toBe(true);
    expect(isBare(signal("Dava", "Kafka"))).toBe(false);
    expect(isBare(signal("Dava", ""))).toBe(false);
  });
});

describe("buildPrompt", () => {
  const books = [signal("Tutunamayanlar", "Oğuz Atay")];
  const movies = [signal("Uzak", "Nuri Bilge Ceylan")];
  const music = [signal("", "Adamlar")];

  it("boş kategori için BAŞLIK yazmaz ve eksikliği bir kez söyler", () => {
    const prompt = buildPrompt(books, [], []);
    expect(prompt).toContain("### Kitaplar");
    expect(prompt).not.toContain("### Filmler ve Diziler");
    expect(prompt).not.toContain("### Müzik");
    expect(prompt).toContain("Kullanıcı film/dizi ve müzik listesi paylaşmadı");
    expect(prompt).toContain("shadow yine tam 3 öneri içerir");
  });

  it("üç kategori de doluysa eksiklik notu yoktur", () => {
    const prompt = buildPrompt(books, movies, [signal("Kule", "Adamlar")]);
    expect(prompt).not.toContain("paylaşmadı");
    expect(prompt).toContain("*Uzak* — yön. Nuri Bilge Ceylan");
  });

  it("biçim notu yalnızca belirsiz (tek adlı) satır varsa yazılır", () => {
    expect(buildPrompt(books, movies, music)).toContain("Biçim notu");
    expect(buildPrompt(books, movies, [])).not.toContain("Biçim notu");
  });
});

describe("fixConfusables — Kiril/Yunan homoglifleri", () => {
  it("gerçek çıktılardaki iki örneği düzeltir", () => {
    expect(fixConfusables("Zihinден gelen isyan")).toBe("Zihinden gelen isyan");
    expect(fixConfusables("Hareketin kaosу")).toBe("Hareketin kaosu");
  });

  it("iç içe nesne ve dizileri gezer, string olmayanı bırakır", () => {
    const fixed = fixConfusables({ a: ["kaosу", 3, null], b: { c: "Ρenk", d: true } });
    expect(fixed).toEqual({ a: ["kaosu", 3, null], b: { c: "Penk", d: true } });
  });

  it("Türkçe harflere dokunmaz", () => {
    const text = "Kış Uykusu — ışık, çığlık, gözyaşı, İstanbul, ğ ü ö ş ç";
    expect(fixConfusables(text)).toBe(text);
  });
});

describe("normalizeArchetype — nesne → düz string", () => {
  it("geçerli bölünmeyi düzleştirir ve iki katmanı yanına yazar", () => {
    const hero: Record<string, unknown> = { archetype: claudeReportJson().hero.archetype };
    normalizeArchetype(hero);
    expect(hero).toMatchObject({
      archetype: "Kadife Ceketli Sokak Filozofu",
      archetype_qualifier: "Kadife ceketli",
      archetype_core: "Sokak Filozofu",
    });
  });

  it("qualifier + core full'ü vermiyorsa tek katmana düşer", () => {
    const hero: Record<string, unknown> = {
      archetype: { full: "Kırık Camdan Bakan Nostaljik Mimar", qualifier: "Nostaljik", core: "Mimar" },
    };
    normalizeArchetype(hero);
    expect(hero).toMatchObject({
      archetype: "Kırık Camdan Bakan Nostaljik Mimar",
      archetype_qualifier: "",
      archetype_core: "",
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it("karşılaştırma Türkçe küçük harfle yapılır (İ/I tuzağı)", () => {
    const hero: Record<string, unknown> = {
      archetype: { full: "İnce Işık Avcısı", qualifier: "ince", core: "Işık Avcısı" },
    };
    normalizeArchetype(hero);
    expect(hero.archetype_core).toBe("Işık Avcısı");
    expect(hero.archetype_qualifier).toBe("ince");
  });

  it("qualifier boşken core full'e eşitse tek anlam birimi olarak korunur", () => {
    const hero: Record<string, unknown> = {
      archetype: { full: "Gece Vardiyası Varoluşçusu", qualifier: "", core: "Gece Vardiyası Varoluşçusu" },
    };
    normalizeArchetype(hero);
    expect(hero.archetype_core).toBe("Gece Vardiyası Varoluşçusu");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("zaten string gelen arketibi olduğu gibi bırakır", () => {
    const hero: Record<string, unknown> = { archetype: "  Nostaljik Mimar " };
    normalizeArchetype(hero);
    expect(hero).toMatchObject({ archetype: "Nostaljik Mimar", archetype_qualifier: "", archetype_core: "" });
  });

  it("hero yoksa ya da arketip eksikse patlamaz", () => {
    expect(() => normalizeArchetype(undefined)).not.toThrow();
    const hero: Record<string, unknown> = {};
    normalizeArchetype(hero);
    expect(hero.archetype).toBe("");
  });
});

describe("sabitler ve sistem prompt'u", () => {
  it("eşik toplamda 6, tavan kategori başına 8, günlük kota 3", () => {
    expect({ MIN_TOTAL, MAX_ITEMS, DAILY_LIMIT }).toEqual({ MIN_TOTAL: 6, MAX_ITEMS: 8, DAILY_LIMIT: 3 });
  });

  it("hassas çıkarım kuralını ve açık Türkçe karakter kuralını (4c) BİRLİKTE içerir", () => {
    expect(SYSTEM_PROMPT).toContain(SENSITIVE_INFERENCE_RULE);
    expect(SYSTEM_PROMPT).toMatch(/4c\. Türkçe karakterleri \(ı, ş, ğ, ü, ö, ç, İ\)/);
  });

  it("shadow için 'tam olarak 3 öneri' kuralını söyler", () => {
    expect(SYSTEM_PROMPT).toContain("Tam olarak 3 öneri: 1 Kitap, 1 Film, 1 Müzik");
  });
});

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

describe("handler", () => {
  const handler = edgeHandler();
  const user = { id: "user-1", email: "biri@example.com" };

  /** Sonnet çağrısı raporu, Haiku çağrısı ad çözümlemesini döner. */
  function stubClaude(options: { report?: unknown; reportText?: string; haiku?: unknown; status?: number } = {}) {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (String(body.model).includes("haiku")) {
        return claudeResponse(JSON.stringify(options.haiku ?? []));
      }
      if (options.status && options.status !== 200) return new Response("boom", { status: options.status });
      return claudeResponse(options.reportText ?? JSON.stringify(options.report ?? claudeReportJson()));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function db(overrides: { count?: number; worksError?: unknown } = {}) {
    return fakeSupabase({
      user,
      tables: {
        reports: (q: QueryCall) => (q.has("insert") ? { data: { id: "report-1" } } : { count: overrides.count ?? 0 }),
        user_works: (q: QueryCall) =>
          q.has("insert")
            ? overrides.worksError
              ? { error: overrides.worksError }
              : { data: (q.arg<unknown[]>("insert") ?? []).map((_, i) => ({ id: `work-${i}` })) }
            : { data: [] },
        report_works: { data: null },
      },
    });
  }

  const sixBooks = { books: signals(6), movies: [], music: [] };

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv();
  });

  it("OPTIONS'a CORS ile 'ok' döner", async () => {
    const res = await handler(request("OPTIONS"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("Authorization yoksa 401 döner ve veritabanına hiç gitmez", async () => {
    const res = await handler(request("POST", { body: sixBooks }));
    expect(res.status).toBe(401);
    expect(createClientCalls).toHaveLength(0);
  });

  it("geçersiz oturumda 401 döner", async () => {
    useEdgeSupabase(fakeSupabase({ user: null }).client);
    const fetchMock = stubClaude();
    const res = await handler(authedPost(sixBooks));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toplam 6'nın altında 400 döner ve Claude'u çağırmaz", async () => {
    useEdgeSupabase(db().client);
    const fetchMock = stubClaude();
    const res = await handler(authedPost({ books: signals(3), movies: signals(2), music: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("toplam en az 6 sinyal");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kategori tavanını aşan gövdede 400 döner", async () => {
    useEdgeSupabase(db().client);
    stubClaude();
    const res = await handler(authedPost({ books: signals(9), movies: [], music: [] }));
    expect(res.status).toBe(400);
  });

  it("günlük kota dolduysa 429 döner ve Claude'u çağırmaz", async () => {
    useEdgeSupabase(db({ count: 3 }).client);
    const fetchMock = stubClaude();
    const res = await handler(authedPost(sixBooks));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("6+0+0 dağılımı geçerlidir: rapor üretilir ve reportId döner", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    const fetchMock = stubClaude();

    const res = await handler(authedPost(sixBooks));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reportId: "report-1" });
    // Belirsiz (tek adlı) satır yok → ad çözümleme çağrısı da yok.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raporu JWT'deki kullanıcıya, ÖZEL olarak ve arketibi DÜZ STRING yazar", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    stubClaude();

    await handler(authedPost({ books: signals(2), movies: signals(2), music: signals(2), user_id: "baskasi" }));

    const insert = fake.callsTo("reports").find((q) => q.has("insert"))!;
    const row = insert.arg<Record<string, any>>("insert")!;
    expect(row.user_id).toBe("user-1");
    expect(row.is_public).toBe(false);
    expect(row.hero.archetype).toBe("Kadife Ceketli Sokak Filozofu");
    expect(row.hero.archetype_core).toBe("Sokak Filozofu");
    expect(row.books[0]).toEqual({ title: "Eser 1", author: "Yaratıcı 1" });
    expect(row.films[0]).toEqual({ title: "Eser 1", director: "Yaratıcı 1" });
    expect(row.songs[0]).toEqual({ title: "Eser 1", artist: "Yaratıcı 1" });
    expect(row.shadow).toHaveLength(3);
  });

  it("```json çitine sarılı yanıtı ayrıştırır ve homoglifleri düzeltir", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    const report = claudeReportJson();
    report.threads[0].title = "Zihinден gelen isyan";
    stubClaude({ reportText: "```json\n" + JSON.stringify(report) + "\n```" });

    const res = await handler(authedPost(sixBooks));

    expect(res.status).toBe(200);
    const row = fake.callsTo("reports").find((q) => q.has("insert"))!.arg<Record<string, any>>("insert")!;
    expect(row.threads[0].title).toBe("Zihinden gelen isyan");
  });

  it.each([
    ["2 öneri", (r: any) => r.shadow.pop()],
    ["dizi değil", (r: any) => (r.shadow = null)],
  ])("shadow tam 3 öneri değilse (%s) 500 döner ve rapor YAZMAZ", async (_label, mutate) => {
    const fake = db();
    useEdgeSupabase(fake.client);
    const report = claudeReportJson();
    mutate(report);
    stubClaude({ report });

    const res = await handler(authedPost(sixBooks));

    expect(res.status).toBe(500);
    expect(fake.callsTo("reports").some((q) => q.has("insert"))).toBe(false);
  });

  it("arketip boş dönerse 500 döner ve rapor yazmaz", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    const report = claudeReportJson();
    report.hero.archetype = { full: "", qualifier: "", core: "" };
    stubClaude({ report });

    const res = await handler(authedPost(sixBooks));

    expect(res.status).toBe(500);
    expect(fake.callsTo("reports").some((q) => q.has("insert"))).toBe(false);
  });

  it("Claude hata verirse 500 döner", async () => {
    useEdgeSupabase(db().client);
    stubClaude({ status: 529 });
    const res = await handler(authedPost(sixBooks));
    expect(res.status).toBe(500);
  });

  it("havuz yazımı başarısız olsa da raporu döner (best-effort)", async () => {
    useEdgeSupabase(db({ worksError: { message: "unique violation" } }).client);
    stubClaude();
    const res = await handler(authedPost(sixBooks));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reportId: "report-1" });
  });

  it("id'si gelen eseri havuza yeniden YAZMAZ, yalnızca rapora bağlar", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    stubClaude();
    const books = signals(6).map((s, i) => ({ ...s, source: "screenshot", work_id: `pool-${i}` }));

    await handler(authedPost({ books, movies: [], music: [] }));

    expect(fake.callsTo("user_works")).toHaveLength(0);
    const links = fake.callsTo("report_works")[0].arg<{ report_id: string; work_id: string }[]>("insert")!;
    expect(links.map((l) => l.work_id)).toEqual(books.map((b) => b.work_id));
    expect(links.every((l) => l.report_id === "report-1")).toBe(true);
  });

  it("elle girilen eseri sinyalin kendi source'uyla havuza yazar", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    stubClaude();
    const books = signals(6).map((s, i) => ({ ...s, source: i === 0 ? "paste" : "manual" }));

    await handler(authedPost({ books, movies: [], music: [] }));

    const inserted = fake.callsTo("user_works").find((q) => q.has("insert"))!.arg<Record<string, any>[]>("insert")!;
    expect(inserted).toHaveLength(6);
    expect(inserted[0]).toMatchObject({ user_id: "user-1", type: "book", source: "paste", title: "Eser 1" });
    expect(inserted[1].source).toBe("manual");
  });

  it("tek adlı satırı 'eser' diye çözülürse başlığa taşır (prompt ve depolama düzelir)", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    const fetchMock = stubClaude({ haiku: [{ i: 0, kind: "work" }, { i: 1, kind: "person" }] });
    const movies = [
      { title: "", creator: "Asmalı Konak", source: "manual", work_id: "" },
      { title: "", creator: "Nuri Bilge Ceylan", source: "manual", work_id: "" },
      ...signals(4),
    ];

    await handler(authedPost({ books: [], movies, music: [] }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reportCall = fetchMock.mock.calls.find(([, init]) => !String(init?.body).includes("haiku"))!;
    const prompt = JSON.parse(String(reportCall[1]!.body)).messages[0].content as string;
    expect(prompt).toContain("1. *Asmalı Konak*");
    expect(prompt).not.toContain("yön. Asmalı Konak");
    expect(prompt).toContain("2. Nuri Bilge Ceylan");

    const row = fake.callsTo("reports").find((q) => q.has("insert"))!.arg<Record<string, any>>("insert")!;
    expect(row.films[0]).toEqual({ title: "Asmalı Konak", director: "" });
    expect(row.films[1]).toEqual({ title: "", director: "Nuri Bilge Ceylan" });
  });

  // Aydınlatma Metni: "Anthropic — … Adın ve e-posta adresin gönderilmez."
  it("Claude'a kullanıcının e-postası ya da kimliği GİTMEZ (ne rapor ne ad çözümleme çağrısında)", async () => {
    useEdgeSupabase(db().client);
    const fetchMock = stubClaude({ haiku: [{ i: 0, kind: "person" }] });
    const books = [{ title: "", creator: "Kafka", source: "manual", work_id: "" }, ...signals(5)];

    await handler(authedPost({ books, movies: [], music: [] }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = fetchMock.mock.calls.map(([, init]) => String(init?.body)).join(" ");
    expect(sent).not.toContain(user.email);
    expect(sent).not.toContain(user.id);
  });

  it("ad çözümleme başarısız olursa sinyaller olduğu gibi kalır ve rapor yine üretilir", async () => {
    const fake = db();
    useEdgeSupabase(fake.client);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (String(init?.body).includes("haiku")) throw new Error("timeout");
        return claudeResponse(JSON.stringify(claudeReportJson()));
      }),
    );
    const music = [{ title: "", creator: "Adamlar", source: "manual", work_id: "" }, ...signals(5)];

    const res = await handler(authedPost({ books: [], movies: [], music }));

    expect(res.status).toBe(200);
    const row = fake.callsTo("reports").find((q) => q.has("insert"))!.arg<Record<string, any>>("insert")!;
    expect(row.songs[0]).toEqual({ title: "", artist: "Adamlar" });
  });
});
