import { beforeEach, describe, expect, it, vi } from "vitest";
import * as generate from "../../supabase/functions/generate-weekly-picks/index.ts";
import { justwatchSearchUrl } from "../../supabase/functions/_shared/watch.ts";
import { claudeResponse, edgeHandler, internals, jsonResponse, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryCall } from "../helpers/fake-supabase";

const { classify, rungOf, RUNG, OFFER_PREFERENCE, TARGET, MAX_CLAUDE_CALLS_PER_USER, MAX_USERS_PER_RUN } =
  internals(generate);

const SECRET = "weekly-secret";
const WEEK = "2026-10-16";

const option = (service_id: string, type: string, link = `https://${service_id}.test/${type}`) => ({
  service_id,
  service_name: service_id,
  type,
  link,
});

/* ------------------------------------------------------------------ */
/* classify — gevşetme merdiveninin basamakları                        */
/* ------------------------------------------------------------------ */

describe("classify", () => {
  const selected = new Set(["netflix", "mubi"]);
  const serviceToSlug = new Map([
    ["netflix", "netflix"],
    ["mubi", "mubi"],
    ["prime", "prime-video"],
  ]);

  it("basamak sırası: abonelik < ücretsiz < ücretli < platform dışı", () => {
    expect(RUNG).toEqual({ onPlatformFlat: 0, onPlatformFree: 1, onPlatformPaid: 3, offPlatform: 4 });
    expect(OFFER_PREFERENCE).toEqual(["subscription", "free", "rent", "buy", "addon"]);
  });

  it("seçili platformda abonelik en iyi basamaktır; link SEÇİLEN teklifin linkidir", () => {
    const cls = classify(
      [option("prime", "subscription"), option("netflix", "rent"), option("netflix", "subscription", "https://netflix.test/title/7")],
      selected,
      serviceToSlug,
    );
    expect(cls).toEqual({ offer_type: "subscription", providers: ["netflix"], rung: 0, link: "https://netflix.test/title/7" });
  });

  it("aynı tipte birden çok seçili platform varsa hepsini listeler", () => {
    const cls = classify([option("mubi", "subscription"), option("netflix", "subscription")], selected, serviceToSlug);
    expect(cls.providers).toEqual(["mubi", "netflix"]);
    expect(cls.link).toBe("https://mubi.test/subscription");
  });

  it.each([
    ["free", 1],
    ["rent", 3],
    ["buy", 3],
    // Ek kanal: platforma abone olmak onu izleyebildiğin anlamına GELMEZ.
    ["addon", 3],
  ])("seçili platformda yalnızca '%s' varsa basamak %i", (type, rung) => {
    expect(classify([option("netflix", type)], selected, serviceToSlug)).toMatchObject({ offer_type: type, rung });
  });

  it("ucuz teklif pahalıya tercih edilir: ücretsiz > kiralık", () => {
    expect(classify([option("netflix", "rent"), option("mubi", "free")], selected, serviceToSlug)).toMatchObject({
      offer_type: "free",
      providers: ["mubi"],
    });
  });

  it("yalnızca seçilmemiş platformda varsa 'off_platform' ve en kötü basamak", () => {
    const cls = classify([option("prime", "subscription")], selected, serviceToSlug);
    expect(cls).toEqual({ offer_type: "off_platform", providers: ["prime-video"], rung: 4, link: "https://prime.test/subscription" });
  });

  // Mailde yanlış bir platform adı yazmaktansa hiçbir şey yazmamak yeğdir.
  it("sözlükte olmayan servis `providers`a girmez", () => {
    expect(classify([option("bilinmeyen", "subscription")], selected, serviceToSlug).providers).toEqual([]);
  });

  it("platform dışı listede en çok 3 platform adı taşır", () => {
    const map = new Map(["a", "b", "c", "d", "e"].map((s) => [s, s]));
    const cls = classify(["a", "b", "c", "d", "e"].map((s) => option(s, "subscription")), new Set(), map);
    expect(cls.providers).toEqual(["a", "b", "c"]);
  });

  it("seçenek yoksa savunmacı dönüş: platform dışı, linksiz", () => {
    expect(classify([], selected, serviceToSlug)).toEqual({ offer_type: "off_platform", providers: [], rung: 4, link: "" });
  });

  it("ücretsiz yolda (sınıflama yok) her aday en iyi basamaktadır", () => {
    expect(rungOf({ cls: null })).toBe(0);
    expect(rungOf({ cls: { rung: 4 } })).toBe(4);
  });

  it("tavanlar: hedef 3 öğe, kullanıcı başına 2 Claude çağrısı, tik başına 3 kullanıcı", () => {
    expect({ TARGET, MAX_CLAUDE_CALLS_PER_USER, MAX_USERS_PER_RUN }).toEqual({
      TARGET: 3,
      MAX_CLAUDE_CALLS_PER_USER: 2,
      MAX_USERS_PER_RUN: 3,
    });
  });
});

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

describe("handler", () => {
  const handler = edgeHandler();

  const providers = [
    { slug: "netflix", label_tr: "Netflix", service_id: "netflix" },
    { slug: "mubi", label_tr: "MUBI", service_id: "mubi" },
    { slug: "exxen", label_tr: "Exxen", service_id: null },
  ];

  const candidate = (i: number, fields: Record<string, unknown> = {}) => ({
    title: `Film ${i}`,
    title_en: `Movie ${i}`,
    year: 1990 + i,
    media_type: "movie",
    creator: `Yönetmen ${i}`,
    blurb: `Gerekçe ${i}.`,
    genre: "dram",
    tone: 0.2,
    popularity: -0.1,
    era: 0,
    ...fields,
  });
  const candidates = (count: number, from = 1) => ({ items: Array.from({ length: count }, (_, i) => candidate(from + i)) });

  interface World {
    users?: { user_id: string; report_id: string; platforms: string[] | null }[];
    report?: unknown;
    blockedKeys?: string[];
    inserted?: unknown[];
  }

  function db(world: World = {}) {
    const fake = fakeSupabase({
      tables: {
        watch_providers: { data: providers },
        reports: {
          data: world.report === undefined ? { id: "report-1", hero: { archetype: "Arketip" }, texture: null, books: [], films: [], songs: [] } : world.report,
        },
        taste_profile: { data: null },
        weekly_picks: (q: QueryCall) => (q.has("upsert") ? { data: world.inserted ?? [{ id: "pick-1" }] } : { data: [] }),
      },
      rpcs: {
        lens_weekly_pick_candidates: { data: world.users ?? [{ user_id: "user-1", report_id: "report-1", platforms: null }] },
        lens_refresh_profile_if_due: { data: null },
        lens_blocked_works: { data: (world.blockedKeys ?? []).map((work_key) => ({ work_key, work_type: "film", work_creator: null, work_title: "x", why: "shown" })) },
        lens_work_keys: (call: QueryCall) => ({ data: (call.args as { p_items: any[] }).p_items.map((item) => `key:${item.title}`) }),
      },
    });
    useEdgeSupabase(fake.client);
    return fake;
  }

  /** Anthropic → sırayla `claude` yanıtları; movieofthenight → `watch(title)`. */
  function stubNetwork(options: { claude?: (unknown | Response)[]; watch?: (title: string, showType: string) => unknown[] } = {}) {
    const queue = [...(options.claude ?? [])];
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "api.anthropic.com") {
        const next = queue.shift();
        if (next === undefined) throw new Error("Beklenmeyen Claude çağrısı");
        return next instanceof Response ? next : claudeResponse(JSON.stringify(next));
      }
      if (url.hostname === "api.movieofthenight.com") {
        return jsonResponse(options.watch?.(url.searchParams.get("title")!, url.searchParams.get("show_type")!) ?? []);
      }
      throw new Error(`Beklenmeyen istek: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const hostsOf = (fetchMock: ReturnType<typeof stubNetwork>) =>
    fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
  const promptOf = (fetchMock: ReturnType<typeof stubNetwork>, call = 0) =>
    JSON.parse(String(fetchMock.mock.calls[call][1]!.body)).messages[0].content as string;

  const call = (body: unknown = { week: WEEK }, headers: Record<string, string> = { "x-weekly-picks-secret": SECRET }) =>
    handler(request("POST", { body, headers }));

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET });
  });

  describe("çağrı koruması", () => {
    // verify_jwt tek başına yetmez: oturumu olan herhangi biri invoke edebilirdi.
    it.each([
      ["sır başlığı yok", {}],
      ["yanlış sır", { "x-weekly-picks-secret": "tahmin" }],
      ["yalnızca oturum token'ı", { Authorization: "Bearer user-jwt" }],
    ])("%s → 403; veritabanına ve Claude'a gidilmez", async (_label, headers) => {
      const fetchMock = stubNetwork();
      const res = await call({ week: WEEK }, headers);

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
      expect(createClientCalls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("POST dışındaki yöntem 405 alır", async () => {
      expect((await handler(request("GET", { headers: { "x-weekly-picks-secret": SECRET } }))).status).toBe(405);
    });

    it.each(["WEEKLY_PICKS_SECRET", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"])(
      "%s eksikse 500 + missing_env",
      async (name) => {
        stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, [name]: "" });
        const res = await call();
        expect(res.status).toBe(500);
        expect((await res.json()).code).toBe("missing_env");
      },
    );

    it("bozuk gövde 400 + bad_body; bozuk hafta 400 + bad_week", async () => {
      db();
      stubNetwork();
      expect((await (await call("{bozuk")).json()).code).toBe("bad_body");
      expect((await (await call({ week: "16.10.2026" })).json()).code).toBe("bad_week");
    });
  });

  describe("ücretsiz yol (filtre yok)", () => {
    it("erişilebilirlik API'sini HİÇ çağırmaz; link JustWatch ARAMA linkidir", async () => {
      const fake = db();
      const fetchMock = stubNetwork({ claude: [candidates(5)] });

      const body = await (await call()).json();

      expect(hostsOf(fetchMock)).toEqual(["api.anthropic.com"]);
      expect(body).toMatchObject({ week: WEEK, considered: 1, inserted: 1, failed: 0, watch_key_present: false });
      expect(body.results[0]).toMatchObject({ status: "inserted", filtered: false, claude_calls: 1, watch_calls: 0, relaxations: [] });

      const films = fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!.arg<any>("upsert", 0).films;
      expect(films).toHaveLength(3);
      expect(films[0]).toEqual({
        title: "Film 1",
        year: 1991,
        blurb: "Gerekçe 1.",
        watch_url: justwatchSearchUrl("Film 1"),
        director: "Yönetmen 1",
        media_type: "movie",
        tags: { tone: 0.2, popularity: -0.1, era: 0, genre: "dram" },
      });
    });

    // O bilgiye sahip değiliz; mailde platform ya da "Ücretsiz" iddia etmeye kapı açardı.
    it("providers / offer_type / show_id YAZMAZ", async () => {
      const fake = db();
      stubNetwork({ claude: [candidates(5)] });
      await call();

      for (const film of fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!.arg<any>("upsert", 0).films) {
        expect(film).not.toHaveProperty("providers");
        expect(film).not.toHaveProperty("offer_type");
        expect(film).not.toHaveProperty("show_id");
        expect(film.watch_url).toMatch(/^https:\/\/www\.justwatch\.com\/tr\/arama\?q=/);
      }
    });

    it("5 aday ister ve prompt'a platform satırı koymaz", async () => {
      db();
      const fetchMock = stubNetwork({ claude: [candidates(5)] });
      await call();

      expect(promptOf(fetchMock)).toContain("çakışmayan 5 film/dizi adayı öner");
      expect(promptOf(fetchMock)).not.toContain("platformları kullanıyor");
    });

    // Aydınlatma Metni: "Anthropic — … Adın ve e-posta adresin gönderilmez."
    it("Claude'a kullanıcı kimliği GİTMEZ", async () => {
      db({ users: [{ user_id: "8d1f6c1e-aaaa-4bbb-8ccc-000000000042", report_id: "report-1", platforms: null }] });
      const fetchMock = stubNetwork({ claude: [candidates(5)] });

      await call();

      expect(String(fetchMock.mock.calls[0][1]!.body)).not.toContain("8d1f6c1e-aaaa-4bbb-8ccc-000000000042");
    });

    it("satırı 'draft' varsayılanıyla, yarışa dayanıklı upsert ile yazar", async () => {
      const fake = db();
      stubNetwork({ claude: [candidates(5)] });
      await call();

      const upsert = fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!;
      expect(Object.keys(upsert.arg<object>("upsert", 0)!).sort()).toEqual(["films", "user_id", "week"]);
      expect(upsert.arg("upsert", 0)).toMatchObject({ user_id: "user-1", week: WEEK });
      expect(upsert.arg("upsert", 1)).toEqual({ onConflict: "user_id,week", ignoreDuplicates: true });
    });

    it("WATCH_API_KEY tanımlı OLSA BİLE filtresiz kullanıcı için çağrılmaz", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db();
      const fetchMock = stubNetwork({ claude: [candidates(5)] });

      const body = await (await call()).json();

      expect(hostsOf(fetchMock)).toEqual(["api.anthropic.com"]);
      expect(body.watch_key_present).toBe(true);
      expect(body.results[0].filtered).toBe(false);
    });

    it("servise bağlanmamış platformu seçen kullanıcı filtresiz yola düşer ve bu GÖRÜNÜR olur", async () => {
      db({ users: [{ user_id: "user-1", report_id: "report-1", platforms: ["exxen"] }] });
      const fetchMock = stubNetwork({ claude: [candidates(5)] });

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "inserted", filtered: false });
      expect(body.results[0].relaxations).toContain("unresolved_platform:exxen");
      expect(hostsOf(fetchMock)).toEqual(["api.anthropic.com"]);
    });
  });

  describe("yasak küme", () => {
    it("yasaklı adayı DÜŞÜRÜR (yeniden sormaz) ve bunu raporlar", async () => {
      const fake = db({ blockedKeys: ["key:Film 2"] });
      const fetchMock = stubNetwork({ claude: [candidates(5)] });

      const body = await (await call()).json();

      const titles = fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!.arg<any>("upsert", 0).films.map((f: any) => f.title);
      expect(titles).toEqual(["Film 1", "Film 3", "Film 4"]);
      expect(body.results[0].relaxations).toEqual(["blocked_dropped:1"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Dizi de film de motorda 'film' tipinde yaşıyor.
      expect((fake.callsTo("lens_work_keys")[0].args as any).p_items[0]).toEqual({ type: "film", creator: "Yönetmen 1", title: "Film 1" });
    });

    it("3'ün altına düşerse ikinci Claude çağrısını harcar, üçüncüsü YOK", async () => {
      db({ blockedKeys: ["key:Film 1", "key:Film 2", "key:Film 3", "key:Film 4"] });
      const fetchMock = stubNetwork({ claude: [candidates(5), { items: [candidate(1), candidate(9)] }] });

      const body = await (await call()).json();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(body.results[0]).toMatchObject({ status: "inserted", claude_calls: 2 });
      expect(body.results[0].films.map((f: any) => f.title)).toEqual(["Film 5", "Film 9"]);
      expect(body.results[0].relaxations).toEqual(["blocked_dropped:4", "second_claude_call", "blocked_dropped:1", "short:2"]);
    });
  });

  describe("sonuç durumları", () => {
    it("dry_run satır YAZMAZ ama seçkiyi döner", async () => {
      const fake = db();
      stubNetwork({ claude: [candidates(5)] });

      const body = await (await call({ week: WEEK, dry_run: true })).json();

      expect(body).toMatchObject({ dry_run: true, inserted: 0, dry_run_count: 1 });
      expect(body.results[0].films).toHaveLength(3);
      expect(fake.callsTo("weekly_picks").some((q) => q.has("upsert"))).toBe(false);
    });

    // films: [] yazılsaydı gönderen onu 'failed' işaretlerdi.
    it("hiç aday kalmazsa satır YAZMAZ: 'empty'", async () => {
      const fake = db({ blockedKeys: ["key:Film 1", "key:Film 2"] });
      stubNetwork({ claude: [candidates(2), candidates(2)] });

      const body = await (await call()).json();

      expect(body).toMatchObject({ inserted: 0, empty: 1 });
      expect(body.results[0]).toMatchObject({ status: "empty", reason: "aday yok" });
      expect(fake.callsTo("weekly_picks").some((q) => q.has("upsert"))).toBe(false);
    });

    it("yarışan tik insert'i kaybederse 'raced' olarak görünür", async () => {
      db({ inserted: [] });
      stubNetwork({ claude: [candidates(5)] });
      const body = await (await call()).json();
      expect(body).toMatchObject({ inserted: 0, raced: 1 });
    });

    it("raporu olmayan kullanıcı 'failed' olur; Claude çağrılmaz", async () => {
      db({ report: null });
      const fetchMock = stubNetwork();
      const body = await (await call()).json();
      expect(body.results[0]).toMatchObject({ status: "failed", reason: "rapor yok" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Satır yazılmadığı için sonraki tik tekrar dener.
    it("bir kullanıcının Claude hatası döngüyü DURDURMAZ", async () => {
      const fake = db({
        users: [
          { user_id: "user-1", report_id: "r1", platforms: null },
          { user_id: "user-2", report_id: "r2", platforms: null },
        ],
      });
      stubNetwork({ claude: [new Response("overloaded", { status: 529 }), candidates(5)] });

      const body = await (await call()).json();

      expect(body).toMatchObject({ considered: 2, inserted: 1, failed: 1 });
      expect(body.results[0]).toMatchObject({ user_id: "user-1", status: "failed", reason: "claude: claude_http_529" });
      expect(body.results[1]).toMatchObject({ user_id: "user-2", status: "inserted" });
      expect(fake.callsTo("weekly_picks").filter((q) => q.has("upsert"))).toHaveLength(1);
    });
  });

  describe("aday sorgusu", () => {
    it("varsayılan parti 3 kullanıcıdır; limit 25'te kapanır; only_user_id iletilir", async () => {
      const fake = db({ users: [] });
      stubNetwork();

      await call();
      await call({ week: WEEK, limit: 400, only_user_id: "user-9" });
      await call({ week: WEEK, limit: -2 });

      expect(fake.callsTo("lens_weekly_pick_candidates").map((c) => c.args)).toEqual([
        { p_week: WEEK, p_limit: 3, p_only_user_id: null },
        { p_week: WEEK, p_limit: 25, p_only_user_id: "user-9" },
        { p_week: WEEK, p_limit: 3, p_only_user_id: null },
      ]);
    });

    it("aday sorgusu başarısızsa 500 + candidates_query_failed", async () => {
      const fake = fakeSupabase({
        tables: { watch_providers: { data: providers } },
        rpcs: { lens_weekly_pick_candidates: { error: { message: "x" } } },
      });
      useEdgeSupabase(fake.client);
      const res = await call();
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("candidates_query_failed");
    });
  });

  describe("filtreli yol (premium + platform seçili)", () => {
    const filtered = { users: [{ user_id: "user-1", report_id: "report-1", platforms: ["netflix"] }] };

    const shown = (title: string, options: unknown[]) => ({
      id: `show-${title}`,
      showType: "movie",
      title,
      originalTitle: title,
      releaseYear: 1990 + Number(title.split(" ")[1]),
      streamingOptions: { tr: options },
    });
    const offer = (service: string, type: string) => ({
      service: { id: service, name: service },
      type,
      link: `https://${service}.test/${type}`,
    });

    // Ödediği filtreyi uygulayamıyorsak satır yazmamak doğrusu.
    it("WATCH_API_KEY yoksa kullanıcı ATLANIR — sessizce filtresiz seçki üretilmez", async () => {
      const fake = db(filtered);
      const fetchMock = stubNetwork();

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "failed" });
      expect(body.results[0].reason).toContain("WATCH_API_KEY yok");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.callsTo("weekly_picks").some((q) => q.has("upsert"))).toBe(false);
    });

    it("her adayı doğrular; link sağlayıcının verdiği servis linkidir", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      const fake = db(filtered);
      const fetchMock = stubNetwork({
        claude: [candidates(9)],
        watch: (title) => [shown(title.replace("Movie", "Film"), [offer("netflix", "subscription")])],
      });

      const body = await (await call()).json();

      expect(promptOf(fetchMock)).toContain("Kullanıcı yalnızca şu platformları kullanıyor: Netflix.");
      expect(promptOf(fetchMock)).toContain("çakışmayan 9 film/dizi adayı öner");
      expect(body.results[0]).toMatchObject({ status: "inserted", filtered: true, relaxations: [] });

      const films = fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!.arg<any>("upsert", 0).films;
      expect(films).toHaveLength(3);
      expect(films[0]).toMatchObject({
        // Görünen ad HER ZAMAN Claude'un yazımı (kullanıcı Türkçe adı tanır).
        title: "Film 1",
        watch_url: "https://netflix.test/subscription",
        show_id: "show-Film 1",
        providers: ["netflix"],
        offer_type: "subscription",
      });
    });

    it("sağlayıcıda bulunamayan ya da TR'de izlenemeyen aday DÜŞER, gevşetilmez", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db(filtered);
      stubNetwork({
        claude: [{ items: [candidate(1), candidate(2), candidate(3)] }, { items: [candidate(1)] }],
        watch: (title) => {
          if (title === "Movie 1") return [shown("Film 1", [offer("netflix", "subscription")])];
          if (title === "Movie 2") return [shown("Film 2", [])]; // TR'de yok
          return []; // bulunamadı
        },
      });

      const body = await (await call()).json();

      expect(body.results[0].films.map((f: any) => f.title)).toEqual(["Film 1"]);
      expect(body.results[0].relaxations).toEqual(["second_claude_call", "short:1"]);
    });

    it("merdiven: abonelik dolmazsa ikinci çağrı → kiralık → platform dışı", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db(filtered);
      const fetchMock = stubNetwork({
        claude: [{ items: [candidate(1), candidate(2), candidate(3)] }, { items: [candidate(1), candidate(2), candidate(3)] }],
        watch: (title) => {
          if (title === "Movie 1") return [shown("Film 1", [offer("netflix", "subscription")])];
          if (title === "Movie 2") return [shown("Film 2", [offer("netflix", "rent")])];
          return [shown("Film 3", [offer("mubi", "subscription")])];
        },
      });

      const body = await (await call()).json();
      const films = body.results[0].films;

      expect(films.map((f: any) => [f.title, f.offer_type])).toEqual([
        ["Film 1", "subscription"],
        ["Film 2", "rent"],
        ["Film 3", "off_platform"],
      ]);
      expect(films[2].providers).toEqual(["mubi"]);
      expect(body.results[0].relaxations).toEqual(["second_claude_call", "rent_or_buy", "off_platform"]);
      expect(hostsOf(fetchMock).filter((h) => h === "api.anthropic.com")).toHaveLength(2);
    });

    it("medya tipi doğrulanmış yolda SAĞLAYICIDAN gelir (Claude mini diziyi film etiketleyebiliyor)", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db(filtered);
      stubNetwork({
        claude: [{ items: [candidate(1), candidate(2), candidate(3)] }],
        watch: (title, showType) =>
          showType === "series"
            ? [{ ...shown(title.replace("Movie", "Film"), [offer("netflix", "subscription")]), showType: "series", releaseYear: undefined, firstAirYear: 1990 + Number(title.split(" ")[1]) }]
            : [],
      });

      const body = await (await call()).json();
      expect(body.results[0].films.map((f: any) => f.media_type)).toEqual(["tv", "tv", "tv"]);
    });
  });

  describe("hafta ve süre", () => {
    it("`week` verilmezse İSTANBUL'un bugünü kullanılır", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-15T22:30:00Z")); // İstanbul: 16 Ekim 01:30
      const fake = db();
      stubNetwork({ claude: [candidates(5)] });

      const body = await (await call({})).json();

      expect(body.week).toBe("2026-10-16");
      expect(fake.callsTo("weekly_picks").find((q) => q.has("upsert"))!.arg<any>("upsert", 0).week).toBe("2026-10-16");
    });

    // Duvar saatine dayanmadan kendisi durur; satır almayan kullanıcıyı sonraki tik yine aday görür.
    it("öz-deadline dolunca kalan kullanıcılara BAŞLAMAZ ve bunu `partial` ile söyler", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T06:00:00Z"));
      const fake = db({
        users: [
          { user_id: "user-1", report_id: "r1", platforms: null },
          { user_id: "user-2", report_id: "r2", platforms: null },
        ],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          // İlk kullanıcının Claude çağrısı iki dakika sürmüş gibi.
          vi.setSystemTime(new Date("2026-10-16T06:02:00Z"));
          return claudeResponse(JSON.stringify(candidates(5)));
        }),
      );

      const body = await (await call()).json();

      expect(body).toMatchObject({ considered: 2, inserted: 1, partial: true });
      expect(body.results.map((r: any) => r.user_id)).toEqual(["user-1"]);
      expect(fake.callsTo("weekly_picks").filter((q) => q.has("upsert"))).toHaveLength(1);
    });
  });

  describe("dayanıklılık", () => {
    it("Claude'a ulaşılamazsa kullanıcı 'failed' olur, fonksiyon çökmez", async () => {
      db();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));

      const res = await call();

      expect(res.status).toBe(200);
      expect((await res.json()).results[0]).toMatchObject({ status: "failed", reason: "claude: claude_unreachable" });
    });

    it("platform sözlüğü okunamazsa 500 + providers_query_failed; kimse için üretim yapılmaz", async () => {
      const fake = fakeSupabase({ tables: { watch_providers: { error: { message: "x" } } } });
      useEdgeSupabase(fake.client);
      const fetchMock = stubNetwork();

      const res = await call();

      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("providers_query_failed");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // daily-discovery ile aynı politika: doğrulama yapılamadıysa öneri engellenmez.
    it("anahtar RPC'si patlarsa yasak küme doğrulaması atlanır, seçki yine üretilir", async () => {
      const fake = fakeSupabase({
        tables: {
          watch_providers: { data: providers },
          reports: { data: { id: "r", hero: null, texture: null, books: [], films: [], songs: [] } },
          taste_profile: { data: null },
          weekly_picks: { data: [{ id: "pick-1" }] },
        },
        rpcs: {
          lens_weekly_pick_candidates: { data: [{ user_id: "user-1", report_id: "r", platforms: null }] },
          lens_refresh_profile_if_due: { error: { message: "tempo" } },
          lens_blocked_works: { data: [{ work_key: "key:Film 1", work_type: "film", work_creator: null, work_title: "Film 1", why: "shown" }] },
          lens_work_keys: { error: { message: "boom" } },
        },
      });
      useEdgeSupabase(fake.client);
      stubNetwork({ claude: [candidates(5)] });

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "inserted", relaxations: [] });
      expect(body.results[0].films).toHaveLength(3);
    });

    it("ikinci Claude çağrısı başarısız olursa eldekiyle devam eder", async () => {
      db({ blockedKeys: ["key:Film 1", "key:Film 2", "key:Film 3"] });
      stubNetwork({ claude: [candidates(5), new Response("overloaded", { status: 529 })] });

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "inserted", claude_calls: 2 });
      expect(body.results[0].films.map((f: any) => f.title)).toEqual(["Film 4", "Film 5"]);
      expect(body.results[0].relaxations).toContain("short:2");
    });

    it.each([
      ["kırpılmış yanıt", claudeResponse("{", { stop_reason: "max_tokens" }), "claude: claude_truncated"],
      ["bozuk JSON", claudeResponse("aday yok"), "claude: claude_bad_json"],
      ["geçerli aday yok", claudeResponse(JSON.stringify({ items: [{ title: "Yılsız" }] })), "claude: claude_incomplete"],
      ["beklenmeyen biçim", jsonResponse({ content: [] }), "claude: claude_bad_shape"],
    ])("ilk çağrıda %s → kullanıcı 'failed', satır yazılmaz", async (_label, response, reason) => {
      const fake = db();
      stubNetwork({ claude: [response.clone()] });

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "failed", reason });
      expect(fake.callsTo("weekly_picks").some((q) => q.has("upsert"))).toBe(false);
    });

    // Eksik seçkinin sebebi aday kalitesi değil kota koruması; görünür olmalı.
    //
    // TAVAN ADAY BAŞINA denetleniyor, istek başına değil: sorgusu başlamış aday
    // 3 sorgusunu da (özgün ad → yerel ad → öteki tip) tamamlar. 3 eşzamanlı adayla
    // gerçek üst sınır 12 değil 12 − 1 + 3×3 = 20'dir (bu senaryoda 18). Kodun
    // yorumu "SERT tavan" diyor; bu test gerçek davranışı sabitler. Tavan gerçekten
    // sertleştirilirse aşağıdaki sayı küçülür — o zaman test de güncellenir.
    it("erişilebilirlik çağrı tavanı dolunca kalan adaylar sorulmaz ve bu raporlanır", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db({ users: [{ user_id: "user-1", report_id: "report-1", platforms: ["netflix"] }] });
      // Hiçbir aday bulunamıyor: tavansız hâlde 18 aday × 3 sorgu = 54 istek giderdi.
      const fetchMock = stubNetwork({ claude: [candidates(9), candidates(9, 20)], watch: () => [] });

      const body = await (await call()).json();
      const watchRequests = hostsOf(fetchMock).filter((h) => h === "api.movieofthenight.com").length;

      expect(body.results[0].relaxations).toContain("watch_call_cap");
      expect(body.results[0].status).toBe("empty");
      expect(body.results[0].watch_calls).toBe(watchRequests);
      expect(watchRequests).toBeGreaterThanOrEqual(12);
      expect(watchRequests).toBeLessThanOrEqual(20);
      // İkinci tur tek bir istek bile atmaz: sayaç kullanıcı başına, tur başına değil.
      expect(body.results[0].claude_calls).toBe(2);
    });
  });

  describe("teşhis modları", () => {
    it("services: seed'deki servis kimliklerini sağlayıcının TR listesiyle karşılaştırır", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ tr: { services: [{ id: "netflix", name: "Netflix" }, { id: "prime", name: "Prime Video" }] } })),
      );

      const body = await (await call({ mode: "services" })).json();

      expect(body).toMatchObject({
        mode: "services",
        tr_services: [{ id: "netflix", name: "Netflix" }, { id: "prime", name: "Prime Video" }],
        // Seed'imiz sağlayıcıda YOK: o slug filtreye giremez.
        unknown_service_ids: [{ slug: "mubi", service_id: "mubi" }],
        // Henüz bağlanmamış: Ayarlar bunları göstermiyor.
        unmapped_slugs: ["exxen"],
      });
    });

    it("probe: Claude'suz erişilebilirlik denemesi yapar, en çok 10 başlık", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db();
      const fetchMock = stubNetwork({
        watch: (title) =>
          title === "Solaris"
            ? [{ id: "show-1", showType: "movie", title: "Solaris", originalTitle: "Solyaris", releaseYear: 1972, streamingOptions: { tr: [{ service: { id: "mubi", name: "MUBI" }, type: "subscription", link: "https://mubi.test/1" }] } }]
            : [],
      });

      const titles = [{ title: "Solaris", year: 1972 }, { title: "Olmayan Film", year: 2001, media_type: "tv" }, ...Array.from({ length: 12 }, (_, i) => ({ title: `Dolgu ${i}` }))];
      const body = await (await call({ mode: "probe", titles })).json();

      expect(body.results).toHaveLength(10);
      expect(body.results[0]).toMatchObject({
        found: true,
        watchable_in_tr: true,
        matched: { show_id: "show-1", media_type: "movie", year: 1972 },
        free_path_url: "https://www.justwatch.com/tr/arama?q=Solaris",
        options: [{ type: "subscription", service_id: "mubi", slug: "mubi", link: "https://mubi.test/1" }],
      });
      expect(body.results[1]).toMatchObject({ found: false, asked: { media_type: "tv" } });
      expect(hostsOf(fetchMock).every((h) => h === "api.movieofthenight.com")).toBe(true);
    });

    it("probe başlıksız çağrılırsa 400 + no_titles", async () => {
      stubEdgeEnv({ WEEKLY_PICKS_SECRET: SECRET, WATCH_API_KEY: "watch-key" });
      db();
      stubNetwork();
      const res = await call({ mode: "probe" });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("no_titles");
    });

    it("services ve probe WATCH_API_KEY olmadan 400 döner", async () => {
      db();
      stubNetwork();
      for (const mode of ["services", "probe"]) {
        const res = await call({ mode, titles: [{ title: "Solaris" }] });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("missing_watch_key");
      }
    });

    it("digest: satırı OLMAYAN uygun kullanıcıları da adlandırır", async () => {
      const fake = fakeSupabase({
        tables: {
          watch_providers: { data: providers },
          weekly_picks: {
            data: [
              { user_id: "u1", status: "draft", films: [{ title: "Uzak", year: 2002 }] },
              { user_id: "u2", status: "sent", films: [{ title: "Kader", year: 2006 }] },
            ],
          },
        },
        rpcs: { lens_weekly_pick_candidates: { data: [{ user_id: "u3" }] } },
      });
      useEdgeSupabase(fake.client);
      stubNetwork();

      const body = await (await call({ week: WEEK, mode: "digest" })).json();

      expect(body).toMatchObject({
        mode: "digest",
        week: WEEK,
        draft_count: 1,
        total_rows: 2,
        by_status: { draft: 1, sent: 1 },
        eligible_without_row: ["u3"],
        titles: ["Uzak (2002)"],
      });
    });
  });
});
