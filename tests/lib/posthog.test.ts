import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * Rıza kapısı. Buradaki her test bir KVKK kuralının karşılığı: rıza yokken `init`
 * bile çağrılmaz, karar verilene kadar olaylar bellekte bekler, oturum kaydı kodda
 * kapalıdır. Modül durumunu yüklenirken kurduğu için her test taze kopya yükler.
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

const CONSENT_KEY = "lens_analytics_consent";
const KEY = "phc_test";

async function load(options: { key?: string; consent?: "granted" | "denied" } = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", options.key ?? KEY);
  vi.stubEnv("VITE_POSTHOG_HOST", "https://ph.test");
  if (options.consent) localStorage.setItem(CONSENT_KEY, options.consent);

  const js = (await import("posthog-js")).default as unknown as Record<string, Mock>;
  const mod = await import("@/lib/posthog");
  return { js, ...mod };
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = `ph_${KEY}_posthog=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});

describe("rıza yokken", () => {
  it("`init` ÇAĞRILMAZ — opt-out modunda init bile PostHog'a istek atar", async () => {
    const { js, posthog, getConsentState } = await load();

    posthog.capture("landing_viewed");
    posthog.identify("user-1");

    expect(getConsentState().consent).toBe("unset");
    expect(js.init).not.toHaveBeenCalled();
    expect(js.capture).not.toHaveBeenCalled();
    expect(js.identify).not.toHaveBeenCalled();
  });

  it("karar dışında tarayıcıya hiçbir şey yazmaz", async () => {
    const { posthog } = await load();
    posthog.capture("form_started", { step: 1 });
    expect(localStorage.length).toBe(0);
  });

  it("reddedilince kuyruk ATILIR, sonraki olaylar da gitmez", async () => {
    const { js, posthog, setAnalyticsConsent, getConsentState } = await load();
    posthog.capture("landing_viewed");

    setAnalyticsConsent("denied");
    posthog.capture("form_started");

    expect(getConsentState().consent).toBe("denied");
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(js.init).not.toHaveBeenCalled();
    expect(js.capture).not.toHaveBeenCalled();

    // Sonradan izin verilse bile reddedilen dönemin olayları geri gelmez.
    setAnalyticsConsent("granted");
    expect(js.capture).not.toHaveBeenCalled();
  });

  it("önceki ziyarette reddedilmişse sayfa açılışında da başlamaz", async () => {
    const { js, posthog } = await load({ consent: "denied" });
    posthog.capture("landing_viewed");
    expect(js.init).not.toHaveBeenCalled();
    expect(js.capture).not.toHaveBeenCalled();
  });
});

describe("izin verilince", () => {
  it("başlar, rızayı kaydeder ve bekleyen olayları KENDİ zaman damgalarıyla sırayla yollar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    const { js, posthog, setAnalyticsConsent } = await load();

    posthog.capture("landing_viewed");
    vi.setSystemTime(new Date("2026-10-11T10:00:05Z"));
    posthog.capture("form_started", { category: "books" });
    vi.setSystemTime(new Date("2026-10-11T10:00:09Z"));

    setAnalyticsConsent("granted");

    expect(js.init).toHaveBeenCalledTimes(1);
    expect(js.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect(js.capture.mock.calls).toEqual([
      ["landing_viewed", undefined, { timestamp: new Date("2026-10-11T10:00:00Z") }],
      ["form_started", { category: "books" }, { timestamp: new Date("2026-10-11T10:00:05Z") }],
    ]);
  });

  it("kuyruk bir kez boşalır; sonraki olaylar doğrudan gider", async () => {
    const { js, posthog, setAnalyticsConsent } = await load();
    posthog.capture("landing_viewed");
    setAnalyticsConsent("granted");
    js.capture.mockClear();

    posthog.capture("report_viewed", { id: "r1" });
    expect(js.capture.mock.calls).toEqual([["report_viewed", { id: "r1" }]]);
  });

  it("rıza girişten SONRA verilirse kimlik o an bağlanır", async () => {
    const { js, posthog, setAnalyticsConsent } = await load();
    posthog.identify("user-1");
    expect(js.identify).not.toHaveBeenCalled();

    setAnalyticsConsent("granted");
    expect(js.identify).toHaveBeenCalledWith("user-1");
  });

  it("önceki ziyarette izin verilmişse sayfa açılır açılmaz başlar", async () => {
    const { js, posthog } = await load({ consent: "granted" });
    expect(js.init).toHaveBeenCalledTimes(1);

    posthog.identify("user-1");
    posthog.capture("landing_viewed");
    expect(js.identify).toHaveBeenCalledWith("user-1");
    expect(js.capture).toHaveBeenCalledWith("landing_viewed", undefined);
  });

  // Yetkili kod, PostHog paneli değil: panel anahtarı açılsa da kayıt başlamaz.
  it("OTURUM KAYDI kodda kapalıdır ve otomatik yakalama yoktur", async () => {
    const { js } = await load({ consent: "granted" });
    const [key, config] = js.init.mock.calls[0];

    expect(key).toBe(KEY);
    expect(config).toMatchObject({
      api_host: "https://ph.test",
      disable_session_recording: true,
      autocapture: false,
      opt_out_persistence_by_default: true,
    });
  });

  it("geri alınınca gönderimi durdurur ve kararı kaydeder", async () => {
    const { js, posthog, setAnalyticsConsent } = await load({ consent: "granted" });

    setAnalyticsConsent("denied");
    posthog.capture("report_viewed");

    expect(js.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(js.capture).not.toHaveBeenCalled();
  });

  it("yeniden izin verilince `init` ikinci kez çağrılmaz", async () => {
    const { js, setAnalyticsConsent } = await load({ consent: "granted" });
    setAnalyticsConsent("denied");
    setAnalyticsConsent("granted");
    expect(js.init).toHaveBeenCalledTimes(1);
    expect(js.opt_in_capturing).toHaveBeenCalledTimes(1);
  });
});

describe("kuyruk ve kimlik", () => {
  it("kuyruk 50 olayda kapanır (bellek sınırsız büyümez)", async () => {
    const { js, posthog, setAnalyticsConsent } = await load();
    for (let i = 0; i < 80; i++) posthog.capture(`event_${i}`);

    setAnalyticsConsent("granted");

    expect(js.capture).toHaveBeenCalledTimes(50);
    expect(js.capture.mock.calls[0][0]).toBe("event_0");
    expect(js.capture.mock.calls[49][0]).toBe("event_49");
  });

  it("reset kimliği unutur: sonradan verilen rıza eski kullanıcıya bağlanmaz", async () => {
    const { js, posthog, setAnalyticsConsent } = await load();
    posthog.identify("user-1");
    posthog.reset();

    setAnalyticsConsent("granted");

    expect(js.identify).not.toHaveBeenCalled();
    // Başlamamış kütüphanede reset çağrılmaz.
    expect(js.reset).not.toHaveBeenCalled();
  });

  it("başlamışken reset kütüphaneye de iletilir", async () => {
    const { js, posthog } = await load({ consent: "granted" });
    posthog.reset();
    expect(js.reset).toHaveBeenCalledTimes(1);
  });
});

describe("bant durumu", () => {
  it("openConsentBanner bandı yeniden açar; karar verilince kapanır ve dinleyenler haberdar olur", async () => {
    const { openConsentBanner, setAnalyticsConsent, getConsentState, subscribeConsent } = await load({
      consent: "denied",
    });
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);

    openConsentBanner();
    expect(getConsentState()).toEqual({ consent: "denied", reopened: true });

    // Aynı kararı yeniden vermek de bandı kapatır.
    setAnalyticsConsent("denied");
    expect(getConsentState()).toEqual({ consent: "denied", reopened: false });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    openConsentBanner();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("localStorage okunamıyorsa rıza VARSAYILMAZ", async () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { js, getConsentState } = await load();

    expect(getConsentState().consent).toBe("unset");
    expect(js.init).not.toHaveBeenCalled();
  });

  it("tanınmayan depolanmış değer 'unset' sayılır", async () => {
    localStorage.setItem(CONSENT_KEY, "yes");
    const { getConsentState } = await load();
    expect(getConsentState().consent).toBe("unset");
  });
});

describe("anahtar yokken (lokal geliştirme)", () => {
  it("sorulacak izin yoktur ve hiçbir şey gönderilmez", async () => {
    const { js, posthog, setAnalyticsConsent, analyticsConfigured } = await load({ key: "" });

    expect(analyticsConfigured).toBe(false);
    posthog.capture("landing_viewed");
    setAnalyticsConsent("granted");
    posthog.capture("form_started");

    expect(js.init).not.toHaveBeenCalled();
    expect(js.capture).not.toHaveBeenCalled();
  });

  it("anahtar varken analyticsConfigured true'dur", async () => {
    expect((await load()).analyticsConfigured).toBe(true);
  });
});

describe("rıza kapısından önceki sürümün izleri", () => {
  const stored = `ph_${KEY}_posthog`;

  it("izin yoksa eski PostHog çerezi ve localStorage kaydı silinir (init çağırmadan)", async () => {
    localStorage.setItem(stored, "{}");
    document.cookie = `${stored}=eski; path=/`;

    const { js } = await load();

    expect(localStorage.getItem(stored)).toBeNull();
    expect(document.cookie).not.toContain(stored);
    expect(js.init).not.toHaveBeenCalled();
  });

  it("izin verilmişse kayıtlara dokunulmaz", async () => {
    localStorage.setItem(stored, "{}");
    await load({ consent: "granted" });
    expect(localStorage.getItem(stored)).toBe("{}");
  });
});

describe("captureSourcePath", () => {
  it("aynı yol birden çok eserde tekrarlansa da yol başına TEK event düşer", async () => {
    const { js, captureSourcePath } = await load({ consent: "granted" });

    captureSourcePath("book", ["screenshot", "screenshot", "manual", "screenshot"]);

    expect(js.capture.mock.calls).toEqual([
      ["source_path_selected", { type: "book", source: "screenshot" }],
      ["source_path_selected", { type: "book", source: "manual" }],
    ]);
  });

  it("boş listede event yok", async () => {
    const { js, captureSourcePath } = await load({ consent: "granted" });
    captureSourcePath("film", []);
    expect(js.capture).not.toHaveBeenCalled();
  });
});
