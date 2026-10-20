import { beforeEach, describe, expect, it, vi } from "vitest";
import * as send from "../../supabase/functions/send-weekly-picks/index.ts";
import { verifyUnsubscribeToken } from "../../supabase/functions/_shared/unsubscribe.ts";
import { edgeHandler, internals, jsonResponse, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryCall } from "../helpers/fake-supabase";

const { minusDays, displayName, normalizeFilms, OVERPAST_AFTER_DAYS, SEND_DELAY_MS } = internals(send);

const SECRET = "weekly-secret";
const UNSUB_SECRET = "unsub-secret";
const WEEK = "2026-10-16";

/* ------------------------------------------------------------------ */
/* Saf fonksiyonlar                                                    */
/* ------------------------------------------------------------------ */

describe("minusDays", () => {
  it.each([
    ["2026-10-16", 7, "2026-10-09"],
    ["2026-03-03", 7, "2026-02-24"],
    ["2026-01-02", 7, "2025-12-26"],
    ["2028-03-01", 1, "2028-02-29"],
    ["2026-10-16", 0, "2026-10-16"],
  ])("%s − %i gün = %s", (date, days, expected) => {
    expect(minusDays(date, days)).toBe(expected);
  });

  it("seçki 7 gün sonra bayatlar; gönderimler arası nefes payı 600 ms", () => {
    expect(OVERPAST_AFTER_DAYS).toBe(7);
    expect(SEND_DELAY_MS).toBe(600);
  });
});

describe("displayName — selamlamadaki ad", () => {
  it("sıra: given_name → full_name → name; yalnızca ilk ad alınır", () => {
    expect(displayName({ user_metadata: { given_name: "Beyza", full_name: "Başka Biri" } })).toBe("Beyza");
    expect(displayName({ user_metadata: { full_name: "  Ayşe Nur Yılmaz " } })).toBe("Ayşe");
    expect(displayName({ user_metadata: { name: "Deniz K." } })).toBe("Deniz");
  });

  it("metadata yoksa e-posta yerel kısmının ilk parçasına düşer (Türkçe büyük harfle)", () => {
    expect(displayName({ email: "ornek.kisi@example.com" })).toBe("Ornek");
    expect(displayName({ email: "ismail_92@example.com" })).toBe("İsmail");
    expect(displayName({ email: "deniz+lens@example.com", user_metadata: { name: "" } })).toBe("Deniz");
  });

  it("hiçbir şey yoksa boş döner (selamlama isimsiz kurulur)", () => {
    expect(displayName({})).toBe("");
    expect(displayName({ email: "123@example.com" })).toBe("");
    expect(displayName({ user_metadata: { given_name: 42 } })).toBe("");
  });
});

describe("normalizeFilms — JSONB'ye güvenme", () => {
  const full = {
    title: " Uzak ",
    year: 2002,
    blurb: " Sessizliğin filmi. ",
    watch_url: "https://netflix.test/1",
    justwatch_url: "https://justwatch.test/1",
    media_type: "movie",
    providers: ["netflix", "", 7],
    offer_type: "subscription",
    tags: { tone: 0.5 },
    show_id: "show-1",
    title_en: "Distant",
    director: "Nuri Bilge Ceylan",
  };

  // Mailin görmesi gerekmeyen şey mailin eline geçmez.
  it("bilinmeyen alanları (tags, show_id, title_en, director) DÜŞÜRÜR", () => {
    expect(normalizeFilms([full])).toEqual([
      {
        title: "Uzak",
        year: 2002,
        blurb: "Sessizliğin filmi.",
        watch_url: "https://netflix.test/1",
        justwatch_url: "https://justwatch.test/1",
        media_type: "movie",
        providers: ["netflix"],
        offer_type: "subscription",
      },
    ]);
  });

  it("v2 alanları yoksa satır v1 biçiminde kalır", () => {
    expect(normalizeFilms([{ title: "Uzak", year: 2002, blurb: "b", justwatch_url: "https://jw.test" }])).toEqual([
      { title: "Uzak", year: 2002, blurb: "b", justwatch_url: "https://jw.test" },
    ]);
  });

  it("başlığı ya da gerekçesi olmayan satırı atar; bozuk satır diğerlerini düşürmez", () => {
    const out = normalizeFilms([{ title: "", blurb: "b" }, { title: "A" }, null, "metin", 3, { title: "B", blurb: "b", year: "2001" }]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("B");
    expect(Number.isNaN(out[0].year)).toBe(true);
  });

  it("tanınmayan media_type ve offer_type yok sayılır", () => {
    const [film] = normalizeFilms([{ title: "A", blurb: "b", year: 2000, media_type: "series", offer_type: "premium", providers: [] }]);
    expect(film).toEqual({ title: "A", year: 2000, blurb: "b" });
  });

  it.each([[null], [undefined], ["[]"], [{ films: [] }]])("dizi olmayan girdi (%j) boş döner", (raw) => {
    expect(normalizeFilms(raw)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

describe("handler", () => {
  const handler = edgeHandler();

  const film = (title: string) => ({ title, year: 2002, blurb: `${title} gerekçesi.`, watch_url: `https://jw.test/${title}` });
  const pick = (id: string, userId: string, films: unknown = [film("Uzak"), film("Kader"), film("Masumiyet")]) => ({
    id,
    user_id: userId,
    week: WEEK,
    films,
    intro_variant: null,
  });

  interface World {
    picks?: ReturnType<typeof pick>[];
    prefs?: { user_id: string; weekly_picks_enabled: boolean }[];
    prefsError?: unknown;
    swept?: unknown[];
    statusError?: unknown;
    emails?: Record<string, string | null>;
  }

  function db(world: World = {}) {
    const fake = fakeSupabase({
      tables: {
        weekly_picks: (q: QueryCall) => {
          if (!q.has("update")) return { data: world.picks ?? [pick("pick-1", "user-1")] };
          // Süpürme ve bayat hafta kapatma `.select("id")` ister; durum yazımı istemez.
          if (q.has("select")) return { data: world.swept ?? [] };
          return world.statusError ? { error: world.statusError } : { data: null };
        },
        user_preferences: world.prefsError ? { error: world.prefsError } : { data: world.prefs ?? [] },
        watch_providers: { data: [{ slug: "netflix", label_tr: "Netflix" }] },
      },
    });
    fake.client.auth.admin.getUserById.mockImplementation(async (id: string) => {
      const emails = world.emails ?? {};
      const email = id in emails ? emails[id] : `${id}@example.com`;
      return { data: { user: { id, email: email ?? undefined, user_metadata: { given_name: "beyza" } } as never }, error: null };
    });
    useEdgeSupabase(fake.client);
    return fake;
  }

  function stubResend(respond: (to: string) => Response = () => jsonResponse({ id: "email-1" })) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.resend.com/emails") return respond(JSON.parse(String(init!.body)).to[0]);
      if (url.endsWith("/capture/")) return jsonResponse({ status: 1 });
      throw new Error(`Beklenmeyen istek: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const mails = (fetchMock: ReturnType<typeof stubResend>) =>
    fetchMock.mock.calls
      .filter(([input]) => String(input) === "https://api.resend.com/emails")
      .map(([, init]) => ({ headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) }));

  const statusWrites = (fake: ReturnType<typeof db>) =>
    fake
      .callsTo("weekly_picks")
      .filter((q) => q.has("update") && !q.has("select"))
      .map((q) => [q.arg<{ status: string }>("update")!.status, q.arg("eq", 1)]);

  /** Handler alıcılar arasında 600 ms bekliyor; sahte saatle ilerletilir. */
  async function call(body: unknown = { week: WEEK }, headers: Record<string, string> = { "x-weekly-picks-secret": SECRET }) {
    const pending = handler(request("POST", { body, headers }));
    let settled = false;
    pending.finally(() => (settled = true)).catch(() => {});
    while (!settled) await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    return pending;
  }

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv({
      WEEKLY_PICKS_SECRET: SECRET,
      RESEND_API_KEY: "resend-key",
      WEEKLY_PICKS_REPLY_TO: "tolga@example.com",
      UNSUBSCRIBE_SECRET: UNSUB_SECRET,
      ANTHROPIC_API_KEY: "",
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Cuma 17:00 İstanbul.
    vi.setSystemTime(new Date("2026-10-16T14:00:00Z"));
  });

  describe("çağrı koruması", () => {
    // Oturumu olan herhangi bir kullanıcı tüm haftanın mailini attırabilirdi.
    it.each([
      ["sır başlığı yok", {}],
      ["yanlış sır", { "x-weekly-picks-secret": "tahmin" }],
      ["yalnızca oturum token'ı", { Authorization: "Bearer user-jwt" }],
    ])("%s → 403; veritabanına gidilmez, mail atılmaz", async (_label, headers) => {
      const fetchMock = stubResend();
      const res = await call({ week: WEEK }, headers);

      expect(res.status).toBe(403);
      expect(createClientCalls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("POST dışındaki yöntem 405 alır", async () => {
      expect((await handler(request("GET", { headers: { "x-weekly-picks-secret": SECRET } }))).status).toBe(405);
    });

    it.each(["RESEND_API_KEY", "WEEKLY_PICKS_SECRET", "WEEKLY_PICKS_REPLY_TO", "UNSUBSCRIBE_SECRET"])(
      "%s eksikse 500 + missing_env; mail atılmaz",
      async (name) => {
        vi.stubEnv(name, "");
        const fetchMock = stubResend();
        const res = await call();
        expect(res.status).toBe(500);
        expect((await res.json()).code).toBe("missing_env");
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("bozuk gövde ve bozuk hafta 400 döner", async () => {
      db();
      stubResend();
      expect((await (await call("{bozuk")).json()).code).toBe("bad_body");
      expect((await (await call({ week: "bu hafta" })).json()).code).toBe("bad_week");
      expect((await (await call({})).json()).code).toBe("bad_week");
    });
  });

  describe("gönderim", () => {
    it("draft seçkiyi yollar ve satırı 'sent' yapar", async () => {
      const fake = db();
      const fetchMock = stubResend();

      const body = await (await call()).json();

      expect(body).toMatchObject({ week: WEEK, total: 1, sent: 1, skipped: 0, failed: 0 });
      expect(body.results).toEqual([{ pick_id: "pick-1", user_id: "user-1", status: "sent" }]);

      const [mail] = mails(fetchMock);
      expect(mail.headers.Authorization).toBe("Bearer resend-key");
      expect(mail.body).toMatchObject({
        from: "Tolga <tolga@lensestetik.com>",
        to: ["user-1@example.com"],
        subject: "Bu hafta için üç film",
        reply_to: "tolga@example.com",
      });
      expect(mail.body.text).toContain("Selam Beyza, Tolga ben.");
      expect(mail.body.html).toContain("Uzak");
      expect(statusWrites(fake)).toEqual([["sent", "pick-1"]]);
    });

    it("yalnızca istenen haftanın 'draft' satırlarını çeker", async () => {
      const fake = db();
      stubResend();
      await call();

      const select = fake.callsTo("weekly_picks").find((q) => !q.has("update"))!;
      expect(select.ops.filter((op) => op.method === "eq").map((op) => op.args)).toEqual([
        ["week", WEEK],
        ["status", "draft"],
      ]);
      expect(select.has("limit")).toBe(false);
    });

    it("limit verilirse SORGUYA uygulanır (kalan satırlar draft kalır, sonraki tik alır)", async () => {
      const fake = db();
      stubResend();
      await call({ week: WEEK, limit: 40 });
      expect(fake.callsTo("weekly_picks").find((q) => !q.has("update"))!.arg("limit")).toBe(40);
    });

    // Kapatma linki KULLANICIYA ÖZEL imzalanır.
    it("List-Unsubscribe başlıkları imzalı, alıcıya özel endpoint'e bakar (RFC 8058)", async () => {
      db({ picks: [pick("pick-1", "user-1"), pick("pick-2", "user-2")] });
      const fetchMock = stubResend();
      await call();

      const [first, second] = mails(fetchMock);
      const header = first.body.headers["List-Unsubscribe"] as string;
      const url = new URL(header.match(/<(http[^>]+)>/)![1]);

      expect(url.origin + url.pathname).toBe("http://supabase.test/functions/v1/unsubscribe");
      expect(url.searchParams.get("u")).toBe("user-1");
      expect(await verifyUnsubscribeToken("user-1", url.searchParams.get("t")!, UNSUB_SECRET)).toBe(true);
      expect(header).toContain("<mailto:tolga@example.com?subject=");
      expect(first.body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(first.body.html).toContain(`unsubscribe?u=user-1&amp;t=${url.searchParams.get("t")}`);

      expect(second.body.headers["List-Unsubscribe"]).toContain("u=user-2");
      expect(second.body.headers["List-Unsubscribe"]).not.toContain(url.searchParams.get("t"));
    });

    it("art arda gönderimde alıcılar arasında nefes payı bırakır", async () => {
      db({ picks: [pick("pick-1", "user-1"), pick("pick-2", "user-2")] });
      const fetchMock = stubResend();

      // HMAC imzası gerçek bir asenkron iş (sahte saat onu ilerletmez); gerçek
      // döngü turlarıyla beklenir. `setImmediate` bilerek sahtelenmedi.
      const turn = () => new Promise((resolve) => setImmediate(resolve));
      const until = async (done: () => boolean) => {
        for (let i = 0; i < 500 && !done(); i++) await turn();
      };

      const pending = handler(request("POST", { body: { week: WEEK }, headers: { "x-weekly-picks-secret": SECRET } }));
      let settled = false;
      pending.finally(() => (settled = true));

      await until(() => mails(fetchMock).length === 1);
      expect(mails(fetchMock)).toHaveLength(1);

      // Bekleme dolmadan ikinci mail çıkmaz.
      await vi.advanceTimersByTimeAsync(SEND_DELAY_MS - 1);
      await until(() => mails(fetchMock).length === 2);
      expect(mails(fetchMock)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await until(() => mails(fetchMock).length === 2);
      expect(mails(fetchMock)).toHaveLength(2);

      while (!settled) await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
      expect((await (await pending).json()).sent).toBe(2);
    });

    // Bu fonksiyon film SEÇMEZ; ANTHROPIC_API_KEY ortamında bile yok.
    it("Claude'u ve erişilebilirlik API'sini ASLA çağırmaz", async () => {
      db();
      const fetchMock = stubResend();
      await call();
      for (const [input] of fetchMock.mock.calls) {
        expect(String(input)).not.toMatch(/anthropic|movieofthenight/);
      }
    });

    it("POSTHOG_KEY yoksa analitik isteği atmaz; varsa kullanıcı id'siyle olay yollar", async () => {
      db();
      const quiet = stubResend();
      await call();
      expect(quiet.mock.calls.every(([input]) => !String(input).includes("/capture/"))).toBe(true);

      vi.stubEnv("POSTHOG_KEY", "phc_server");
      db();
      const loud = stubResend();
      await call();
      const capture = loud.mock.calls.find(([input]) => String(input).endsWith("/capture/"))!;
      expect(JSON.parse(String(capture[1]!.body))).toMatchObject({
        event: "weekly_pick_sent",
        distinct_id: "user-1",
        properties: { week: WEEK, pick_id: "pick-1", film_count: 3 },
      });
    });
  });

  describe("opt-out", () => {
    it("tercihi kapalı kullanıcıya mail ATMAZ; satır draft kalır", async () => {
      const fake = db({
        picks: [pick("pick-1", "user-1"), pick("pick-2", "user-2")],
        prefs: [{ user_id: "user-1", weekly_picks_enabled: false }],
      });
      const fetchMock = stubResend();

      const body = await (await call()).json();

      expect(body).toMatchObject({ total: 2, sent: 1, skipped: 1, failed: 0 });
      expect(body.results[0]).toEqual({ pick_id: "pick-1", user_id: "user-1", status: "skipped", reason: "opted_out" });
      expect(mails(fetchMock).map((m) => m.body.to[0])).toEqual(["user-2@example.com"]);
      expect(statusWrites(fake)).toEqual([["sent", "pick-2"]]);
    });

    // Satır yoksa varsayılan AÇIK.
    it("tercih satırı olmayan ve tercihi açık kullanıcıya gönderir", async () => {
      db({
        picks: [pick("pick-1", "user-1"), pick("pick-2", "user-2")],
        prefs: [{ user_id: "user-2", weekly_picks_enabled: true }],
      });
      const fetchMock = stubResend();
      expect((await (await call()).json()).sent).toBe(2);
      expect(mails(fetchMock)).toHaveLength(2);
    });

    // Varsayılana düşüp göndermek, opt-out yapmış kullanıcıya mail atmak demek.
    it("tercihler okunamazsa DURUR: 500 ve tek mail bile atılmaz", async () => {
      const fake = db({ prefsError: { message: "timeout" } });
      const fetchMock = stubResend();

      const res = await call();

      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("preferences_query_failed");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(statusWrites(fake)).toEqual([]);
    });
  });

  describe("hata izolasyonu — bir alıcının hatası döngüyü durdurmaz", () => {
    it("Resend bir alıcıda hata verirse o satır 'failed' olur, sıradaki gönderilir", async () => {
      const fake = db({ picks: [pick("pick-1", "user-1"), pick("pick-2", "user-2")] });
      stubResend((to) => (to.startsWith("user-1") ? new Response("rate limited", { status: 429 }) : jsonResponse({ id: "ok" })));

      const body = await (await call()).json();

      expect(body).toMatchObject({ sent: 1, failed: 1 });
      expect(body.results[0]).toMatchObject({ status: "failed", reason: "Resend 429: rate limited" });
      expect(statusWrites(fake)).toEqual([
        ["failed", "pick-1"],
        ["sent", "pick-2"],
      ]);
    });

    it.each([
      ["films boş dizi", []],
      ["films null", null],
      ["films içinde geçerli öğe yok", [{ title: "", blurb: "" }]],
    ])("%s → 'failed', mail atılmaz", async (_label, films) => {
      const fake = db({ picks: [pick("pick-1", "user-1", films)] });
      const fetchMock = stubResend();

      const body = await (await call()).json();

      expect(body.results[0]).toMatchObject({ status: "failed", reason: "films boş ya da geçersiz" });
      expect(mails(fetchMock)).toHaveLength(0);
      expect(statusWrites(fake)).toEqual([["failed", "pick-1"]]);
    });

    it("e-postası olmayan kullanıcı 'failed' olur", async () => {
      db({ emails: { "user-1": null } });
      const fetchMock = stubResend();
      const body = await (await call()).json();
      expect(body.results[0].reason).toContain("kullanıcı e-postası bulunamadı");
      expect(mails(fetchMock)).toHaveLength(0);
    });

    // 'failed' saymak yeniden gönderime yol açardı: çift mail, kayıp durumdan beter.
    it("mail gitti ama durum yazılamadıysa yine 'sent' sayılır", async () => {
      db({ statusError: { message: "db down" } });
      stubResend();
      const body = await (await call()).json();
      expect(body).toMatchObject({ sent: 1, failed: 0 });
    });
  });

  describe("bayat hafta (overpast)", () => {
    it("her çağrıda 7 günden eski draft'ları süpürür; istenen haftaya dokunmaz", async () => {
      const fake = db({ swept: [{ id: "old-1" }, { id: "old-2" }] });
      stubResend();

      const body = await (await call()).json();

      const sweep = fake.callsTo("weekly_picks")[0];
      expect(sweep.arg("update")).toEqual({ status: "overpast" });
      expect(sweep.ops.find((op) => op.method === "lt")?.args).toEqual(["week", "2026-10-09"]);
      expect(sweep.ops.find((op) => op.method === "neq")?.args).toEqual(["week", WEEK]);
      expect(sweep.ops.find((op) => op.method === "eq")?.args).toEqual(["status", "draft"]);
      expect(body.overpast).toBe(2);
    });

    it("haftası geçmiş seçki GÖNDERİLMEZ; satırlar 'overpast' ile kapanır", async () => {
      const fake = db({ swept: [{ id: "old-1" }] });
      const fetchMock = stubResend();

      const body = await (await call({ week: "2026-10-02" })).json();

      expect(mails(fetchMock)).toHaveLength(0);
      expect(body).toMatchObject({ week: "2026-10-02", sent: 0, results: [] });
      expect(body.note).toContain("allow_overpast: true");
      const close = fake.callsTo("weekly_picks")[1];
      expect(close.arg("update")).toEqual({ status: "overpast" });
      expect(close.ops.filter((op) => op.method === "eq").map((op) => op.args)).toEqual([
        ["status", "draft"],
        ["week", "2026-10-02"],
      ]);
    });

    it("tam 7 gün önceki hafta hâlâ gönderilebilir", async () => {
      db();
      const fetchMock = stubResend();
      await call({ week: "2026-10-09" });
      expect(mails(fetchMock)).toHaveLength(1);
    });

    it("geri-doldurma yalnızca açık `allow_overpast: true` ile mümkündür", async () => {
      db();
      const fetchMock = stubResend();

      await call({ week: "2026-09-04", allow_overpast: "true" });
      expect(mails(fetchMock)).toHaveLength(0);

      await call({ week: "2026-09-04", allow_overpast: true });
      expect(mails(fetchMock)).toHaveLength(1);
    });

    // Cuma gecesi 23:30 İstanbul = Cuma 20:30 UTC; gün sınırı UTC'ye göre kaymaz.
    it("'bugün' İstanbul gününe göredir", async () => {
      vi.setSystemTime(new Date("2026-10-16T21:30:00Z")); // İstanbul: 17 Ekim 00:30
      const fake = db();
      stubResend();
      await call();
      expect(fake.callsTo("weekly_picks")[0].ops.find((op) => op.method === "lt")?.args).toEqual(["week", "2026-10-10"]);
    });
  });

  it("gönderilecek satır yoksa sıfırlarla döner", async () => {
    db({ picks: [] });
    const fetchMock = stubResend();
    const body = await (await call()).json();
    expect(body).toMatchObject({ total: 0, sent: 0, skipped: 0, failed: 0, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
