import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fakeSupabase, type FakeUser, type QueryCall, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

/**
 * Analitik kararının hesaptaki kaydı. Söz şu: hesabında kararı olan kişiye başka
 * bir cihazda ya da tarayıcıda bir daha sorulmaz, ve iki cihazda iki ayrı karar
 * varsa EN SON verilen geçerlidir (Çerez Politikası, "Kararının hesabında
 * saklanması"). Kapının kendisi `tests/lib/posthog.test.ts`'te.
 *
 * `posthog.ts` ve bu modül durumlarını yüklenirken kurduğu için her test taze kopya yükler.
 */
vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

const CONSENT_KEY = "lens_analytics_consent";
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-01T10:00:00.000Z");

/** Postgres'in döndürdüğü biçim: altı haneli kesir, `+00:00`. */
const pg = (ms: number) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1456+00:00");
const local = (value: "granted" | "denied", at: number, synced: boolean) => JSON.stringify({ value, at, synced });
const storedConsent = () => JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");

interface Options {
  key?: string;
  user?: FakeUser | null;
  /** Hesaptaki en son karar (okuma yanıtı). */
  account?: QueryResult | (() => Promise<QueryResult>);
  write?: QueryResult;
  /** Tarayıcıdaki ham kayıt. */
  stored?: string;
}

async function load(options: Options = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", options.key ?? "phc_test");
  vi.stubEnv("VITE_POSTHOG_HOST", "https://ph.test");
  if (options.stored !== undefined) localStorage.setItem(CONSENT_KEY, options.stored);

  const account = options.account ?? { data: null };
  const fake = fakeSupabase({
    user: options.user === undefined ? { id: "user-1" } : options.user,
    tables: {
      analytics_consents: (q: QueryCall) =>
        q.has("insert") ? (options.write ?? { data: null }) : typeof account === "function" ? account() : account,
    },
  });
  useWebSupabase(fake.client);

  const js = (await import("posthog-js")).default as unknown as Record<string, Mock>;
  const gate = await import("@/lib/posthog");
  const mod = await import("@/lib/analyticsConsent");
  return { fake, js, gate, ...mod };
}

type Loaded = Awaited<ReturnType<typeof load>>;

const reads = (fake: Loaded["fake"]) => fake.callsTo("analytics_consents").filter((q) => !q.has("insert"));
const inserts = (fake: Loaded["fake"]) => fake.callsTo("analytics_consents").filter((q) => q.has("insert"));

/** İzlemeyi başlatır ve ilk uzlaşma bitene kadar bekler. */
async function watch(loaded: Loaded) {
  loaded.watchAnalyticsConsent();
  await vi.waitFor(() => expect(loaded.fake.client.auth.onAuthStateChange).toHaveBeenCalled());
  await vi.waitFor(() => expect(loaded.gate.getConsentState().checking).toBe(false));
  return loaded;
}

/** supabase-js'in sonradan ateşlediği olaylar (giriş, çıkış, sekmeye dönüş). */
const emit = (loaded: Loaded, event: string, userId: string | null) =>
  (loaded.fake.client.auth.onAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void)(
    event,
    userId ? { user: { id: userId } } : null,
  );

beforeEach(() => {
  localStorage.clear();
});

describe("girişte: hesapta karar VARSA", () => {
  it("yeni cihazda bant sorulmadan uygulanır; izin ölçümü başlatır", async () => {
    const { js, gate, fake } = await watch(await load({ account: { data: { decision: "granted", decided_at: pg(T0) } } }));

    expect(gate.getConsentState()).toMatchObject({ consent: "granted", checking: false });
    expect(js.init).toHaveBeenCalledTimes(1);
    expect(storedConsent()).toEqual({ value: "granted", at: T0, synced: true });
    expect(inserts(fake)).toEqual([]);
  });

  it("hesaptaki ret de yeni cihazda geçerlidir: ölçüm başlamaz, bant sorulmaz", async () => {
    const { js, gate } = await watch(await load({ account: { data: { decision: "denied", decided_at: pg(T0) } } }));

    expect(gate.getConsentState().consent).toBe("denied");
    expect(js.init).not.toHaveBeenCalled();
  });

  it("okuma sorgusu kişinin EN SON kararını ister", async () => {
    const { fake } = await watch(await load({ account: { data: { decision: "denied", decided_at: pg(T0) } } }));

    const [read] = reads(fake);
    expect(read.ops).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["user_id", "user-1"] },
        { method: "order", args: ["decided_at", { ascending: false }] },
        { method: "limit", args: [1] },
      ]),
    );
  });

  it("buradaki karar daha YENİYSE ve henüz yazılmamışsa hesaba yazılır; buradaki geçerli kalır", async () => {
    const { js, gate, fake } = await watch(
      await load({
        stored: local("denied", T0 + HOUR, false),
        account: { data: { decision: "granted", decided_at: pg(T0) } },
      }),
    );

    expect(inserts(fake).map((q) => q.arg("insert"))).toEqual([{ user_id: "user-1", decision: "denied" }]);
    expect(gate.getConsentState().consent).toBe("denied");
    expect(js.init).not.toHaveBeenCalled();
    expect(storedConsent()).toMatchObject({ value: "denied", synced: true });
  });

  it("hesaptaki daha yeniyse buraya uygulanır; buradaki eski karar yazılmaz", async () => {
    const { js, gate, fake } = await watch(
      await load({
        stored: local("denied", T0, false),
        account: { data: { decision: "granted", decided_at: pg(T0 + HOUR) } },
      }),
    );

    expect(gate.getConsentState().consent).toBe("granted");
    expect(js.init).toHaveBeenCalledTimes(1);
    expect(inserts(fake)).toEqual([]);
  });

  // Yazılmış bir kayıt bir hesabın kararıdır; bu hesabın en son kararı değilse başkasınındır.
  it("buradaki karar bir hesaptan geldiyse tarihi ne olursa olsun hesaptaki geçerlidir", async () => {
    const { gate, fake } = await watch(
      await load({
        stored: local("denied", T0 + HOUR, true),
        account: { data: { decision: "granted", decided_at: pg(T0) } },
      }),
    );

    expect(gate.getConsentState().consent).toBe("granted");
    expect(inserts(fake)).toEqual([]);
  });

  it("iki taraf aynı kararda: hiçbir şey yazılmaz, ölçüm yeniden açılmaz", async () => {
    const { js, fake } = await watch(
      await load({
        stored: local("granted", T0 + HOUR, false),
        account: { data: { decision: "granted", decided_at: pg(T0) } },
      }),
    );

    expect(inserts(fake)).toEqual([]);
    expect(js.opt_in_capturing).not.toHaveBeenCalled();
    expect(storedConsent()).toEqual({ value: "granted", at: T0, synced: true });
  });

  it("önceki sürümün düz kaydı her karardan eskidir: hesaptaki geçerli olur", async () => {
    const { gate, fake } = await watch(
      await load({ stored: "granted", account: { data: { decision: "denied", decided_at: pg(T0) } } }),
    );

    expect(gate.getConsentState().consent).toBe("denied");
    expect(inserts(fake)).toEqual([]);
  });
});

describe("girişte: hesapta karar YOKSA", () => {
  it("girişten önce bu tarayıcıda verilen karar hesaba yazılır (damgasız)", async () => {
    const { fake } = await watch(await load({ stored: local("granted", T0, false) }));

    const [write] = inserts(fake);
    expect(write.arg("insert")).toEqual({ user_id: "user-1", decision: "granted" });
    // Damga client'a bırakılsaydı geleceğe tarihli bir satır sonraki her kararı ezerdi.
    expect(Object.keys(write.arg<object>("insert")!)).not.toContain("decided_at");
    expect(storedConsent()).toMatchObject({ value: "granted", synced: true });
  });

  it("önceki sürümden kalan karar ilk girişte hesaba taşınır; kişiye yeniden sorulmaz", async () => {
    const { gate, fake } = await watch(await load({ stored: "denied" }));

    expect(inserts(fake).map((q) => q.arg("insert"))).toEqual([{ user_id: "user-1", decision: "denied" }]);
    expect(gate.getConsentState().consent).toBe("denied");
  });

  it("kimse karar vermemişse hiçbir şey yazılmaz; okuma bitince bant sorar", async () => {
    const { gate, fake } = await watch(await load());

    expect(inserts(fake)).toEqual([]);
    expect(gate.getConsentState()).toMatchObject({ consent: "unset", checking: false });
  });

  // Aynı cihazda iki kişi: birinin verdiği izin ötekinin hesabına rıza olarak yazılmamalı.
  it("buradaki karar BAŞKA bir hesaptan geldiyse yazılmaz; unutulur ve kişiye sorulur", async () => {
    const { js, gate, fake } = await watch(await load({ stored: local("granted", T0, true) }));

    expect(inserts(fake)).toEqual([]);
    expect(gate.getConsentState().consent).toBe("unset");
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(js.opt_out_capturing).toHaveBeenCalledTimes(1);
  });

  it("yazım başarısızsa karar 'yazılmadı' kalır ve bir sonraki girişte yeniden denenir", async () => {
    const { gate } = await watch(await load({ stored: local("granted", T0, false), write: { error: { message: "rls" } } }));

    expect(gate.getStoredConsent()).toMatchObject({ value: "granted", synced: false });
    expect(console.error).toHaveBeenCalledWith("[analytics-consent] kaydedilemedi:", { message: "rls" });
  });
});

describe("hesap okunamazsa (fail-open)", () => {
  it("buradaki karar geçerli kalır, hiçbir şey yazılmaz ve bant bekletilmez", async () => {
    const { gate, fake } = await watch(await load({ stored: local("denied", T0, false), account: { error: { message: "down" } } }));

    expect(gate.getConsentState()).toMatchObject({ consent: "denied", checking: false });
    expect(inserts(fake)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith("[analytics-consent] okunamadı:", { message: "down" });
  });

  it("okuma takılırsa bant 5 saniye sonra serbest kalır", async () => {
    vi.useFakeTimers();
    const loaded = await load({ account: () => new Promise<QueryResult>(() => {}) });
    loaded.watchAnalyticsConsent();
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.gate.getConsentState().checking).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);

    expect(loaded.gate.getConsentState()).toMatchObject({ consent: "unset", checking: false });
    expect(inserts(loaded.fake)).toEqual([]);
  });
});

describe("oturum açıkken verilen karar", () => {
  it("bantta ya da Hesabım'da verilen karar o an hesaba yazılır ve 'yazıldı' işaretlenir", async () => {
    const loaded = await watch(await load());

    loaded.gate.setAnalyticsConsent("granted");

    await vi.waitFor(() => expect(loaded.gate.getStoredConsent()).toMatchObject({ value: "granted", synced: true }));
    expect(inserts(loaded.fake).map((q) => q.arg("insert"))).toEqual([{ user_id: "user-1", decision: "granted" }]);
  });

  it("kararı değiştirmek yeni bir satırdır: iki karar, iki yazım", async () => {
    const loaded = await watch(await load());

    loaded.gate.setAnalyticsConsent("granted");
    loaded.gate.setAnalyticsConsent("denied");

    await vi.waitFor(() => expect(inserts(loaded.fake)).toHaveLength(2));
    expect(inserts(loaded.fake).map((q) => q.arg<{ decision: string }>("insert")!.decision)).toEqual(["granted", "denied"]);
  });

  it("oturumsuz ziyaretçinin kararı hiçbir hesaba yazılmaz", async () => {
    const loaded = await watch(await load({ user: null }));

    loaded.gate.setAnalyticsConsent("granted");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loaded.fake.callsTo("analytics_consents")).toEqual([]);
    expect(loaded.gate.getStoredConsent()).toMatchObject({ value: "granted", synced: false });
  });

  it("çıkıştan sonra verilen karar yazılmaz", async () => {
    const loaded = await watch(await load());

    emit(loaded, "SIGNED_OUT", null);
    loaded.gate.setAnalyticsConsent("denied");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserts(loaded.fake)).toEqual([]);
  });
});

describe("oturum olayları ve bant bekletme", () => {
  it("oturum bilgisi gelene kadar bant bekler; oturumsuz ziyaretçide bekleme hemen biter", async () => {
    const loaded = await load({ user: null });

    loaded.watchAnalyticsConsent();
    expect(loaded.gate.getConsentState().checking).toBe(true);

    await watch(loaded);
    expect(reads(loaded.fake)).toEqual([]);
  });

  it("supabase-js'in yinelediği SIGNED_IN aynı kişinin hesabını yeniden okumaz", async () => {
    const loaded = await watch(await load({ account: { data: { decision: "granted", decided_at: pg(T0) } } }));

    emit(loaded, "SIGNED_IN", "user-1");
    emit(loaded, "TOKEN_REFRESHED", "user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reads(loaded.fake)).toHaveLength(1);
    expect(loaded.gate.getConsentState().checking).toBe(false);
  });

  it("başka bir kişi girerse onun hesabı okunur ve onun kararı geçerli olur", async () => {
    let decision = "granted";
    const loaded = await watch(
      await load({ account: async () => ({ data: { decision, decided_at: pg(T0) } }) }),
    );
    expect(loaded.gate.getConsentState().consent).toBe("granted");

    decision = "denied";
    emit(loaded, "SIGNED_IN", "user-2");
    expect(loaded.gate.getConsentState().checking).toBe(true);
    await vi.waitFor(() => expect(loaded.gate.getConsentState().checking).toBe(false));

    expect(reads(loaded.fake).at(-1)!.ops).toContainEqual({ method: "eq", args: ["user_id", "user-2"] });
    expect(loaded.gate.getConsentState().consent).toBe("denied");
  });

  // Okuma sürerken çıkış yapılırsa gelen yanıt artık kimseye ait değildir.
  it("okuma sürerken çıkış yapılırsa yanıt uygulanmaz", async () => {
    let answer: (value: QueryResult) => void = () => {};
    const loaded = await load({ account: () => new Promise<QueryResult>((resolve) => (answer = resolve)) });
    loaded.watchAnalyticsConsent();
    await vi.waitFor(() => expect(reads(loaded.fake)).toHaveLength(1));

    emit(loaded, "SIGNED_OUT", null);
    answer({ data: { decision: "granted", decided_at: pg(T0) } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loaded.gate.getConsentState()).toMatchObject({ consent: "unset", checking: false });
  });
});

describe("analitik anahtarı yokken (lokal geliştirme)", () => {
  it("sorulacak karar yoktur: veritabanına gidilmez, bant bekletilmez", async () => {
    const loaded = await load({ key: "" });

    loaded.watchAnalyticsConsent();
    loaded.gate.setAnalyticsConsent("granted");

    expect(loaded.fake.client.auth.onAuthStateChange).not.toHaveBeenCalled();
    expect(loaded.fake.callsTo("analytics_consents")).toEqual([]);
    expect(loaded.gate.getConsentState().checking).toBe(false);
  });
});
