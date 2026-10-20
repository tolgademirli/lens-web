import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { button, click, hasButton, mount, pageText, query, unmountAll } from "../helpers/render";

/**
 * Analitik izni bandı — rızanın GEÇERLİLİK şartları. Kapının kendisi
 * (`src/lib/posthog.ts`) `tests/lib/posthog.test.ts`'te sınanır; burada bandın o
 * kapıyı doğru çalıştırdığı ve rızayı sakatlayacak biçimde çizilmediği sınanır.
 *
 * `posthog.ts` durumunu yüklenirken kurduğu için her test taze kopya yükler.
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
const banner = () => document.querySelector('[aria-label="Analitik izni"]');
const heightVar = () => document.documentElement.style.getPropertyValue("--consent-banner-h");

async function load(options: { key?: string; consent?: "granted" | "denied" } = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", options.key ?? "phc_test");
  vi.stubEnv("VITE_POSTHOG_HOST", "https://ph.test");
  if (options.consent) localStorage.setItem(CONSENT_KEY, options.consent);

  const js = (await import("posthog-js")).default as unknown as Record<string, Mock>;
  const { AnalyticsConsentBanner, AnalyticsPreferenceLink } = await import("@/app/components/AnalyticsConsent");
  await mount(
    <>
      <AnalyticsPreferenceLink />
      <AnalyticsConsentBanner />
    </>,
  );
  return { js };
}

// İlk (soğuk) yükleme testin süresinden yenmesin; bkz. account.test.tsx.
beforeAll(async () => {
  await import("@/app/components/AnalyticsConsent");
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await unmountAll();
  document.documentElement.style.removeProperty("--consent-banner-h");
});

describe("karar verilmemişken", () => {
  it("bant görünür ve ölçüm BAŞLAMAMIŞTIR", async () => {
    const { js } = await load();
    expect(banner()).not.toBeNull();
    expect(js.init).not.toHaveBeenCalled();
  });

  // Reddetmek kabul etmek kadar kolay olmalı; "İzin ver"i öne çıkarmak rızayı sakatlar.
  it("İKİ DÜĞME AYNI GÖRÜNÜR", async () => {
    await load();
    const accept = button("İzin ver");
    const refuse = button("İzin verme");

    expect(accept.className).toBe(refuse.className);
    expect(accept.className).not.toBe("");
    expect(accept.tagName).toBe(refuse.tagName);
    expect(accept.parentElement).toBe(refuse.parentElement);
    expect(accept.disabled || refuse.disabled).toBe(false);
  });

  // Cevabı zorlanan rıza, rıza değildir: yanıtlamadan da Lens kullanılabilir.
  it("modal DEĞİLDİR: sayfayı kilitlemez", async () => {
    await load();
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')).toBeNull();
    expect(banner()!.parentElement!.className).toContain("pointer-events-none");
  });

  it("ilk katman neyin ölçüldüğünü, çerezi, yurt dışını ve gönüllülüğü söyler", async () => {
    await load();
    const text = pageText();
    for (const phrase of [
      "uğradığın ekranları ve dokunduğun yerleri",
      "bir çerez yazılır",
      "yurt dışındaki PostHog sunucularına gider",
      "vermesen de Lens aynı çalışır",
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it("'Ayrıntılar' ikinci katmanı açar; orada Çerez Politikası'na bağlantı vardır", async () => {
    await load();
    expect(document.querySelector('a[href="/cookies"]')).toBeNull();

    await click(button("Ayrıntılar"));

    expect(query<HTMLAnchorElement>('a[href="/cookies"]').textContent).toBe("Çerez Politikası");
    expect(button("Ayrıntıları gizle").getAttribute("aria-expanded")).toBe("true");
    expect(pageText()).toContain("istediğin an değiştirebilirsin");
  });

  // Bant altındaki birincil aksiyonlar bu değişkenle kendilerini bandın üstüne taşır;
  // ilk sürüm ana sayfanın CTA'sını kapatıyordu.
  it("yüksekliğini `--consent-banner-h` olarak yayınlar; kapanınca sıfırlar", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(132);
    await load();
    expect(heightVar()).toBe("132px");

    await click(button("İzin verme"));
    expect(heightVar()).toBe("0px");
  });
});

describe("karar", () => {
  it("'İzin ver' ölçümü başlatır, kararı saklar ve bandı kapatır", async () => {
    const { js } = await load();

    await click(button("İzin ver"));

    expect(js.init).toHaveBeenCalledTimes(1);
    expect(js.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect(banner()).toBeNull();
  });

  it("'İzin verme' ölçümü BAŞLATMAZ, kararı saklar ve bandı kapatır", async () => {
    const { js } = await load();

    await click(button("İzin verme"));

    expect(js.init).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(banner()).toBeNull();
  });

  it.each(["granted", "denied"] as const)("önceki ziyarette karar verilmişse (%s) bant yeniden sorulmaz", async (consent) => {
    await load({ consent });
    expect(banner()).toBeNull();
    expect(heightVar()).toBe("0px");
  });
});

describe("kararı değiştirme — rıza, verildiği kadar kolay geri alınabilmeli", () => {
  it("'Analitik tercihi' bandı yeniden açar ve o anki kararı söyler", async () => {
    await load({ consent: "granted" });

    await click(button("Analitik tercihi"));

    expect(banner()).not.toBeNull();
    expect(pageText()).toContain("Şu an izin vermiş durumdasın.");
  });

  it("izin geri alınınca gönderim durur", async () => {
    const { js } = await load({ consent: "granted" });
    await click(button("Analitik tercihi"));

    await click(button("İzin verme"));

    expect(js.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(banner()).toBeNull();
  });

  it("reddetmiş kişi sonradan izin verebilir", async () => {
    const { js } = await load({ consent: "denied" });
    await click(button("Analitik tercihi"));
    expect(pageText()).toContain("Şu an izin vermemiş durumdasın.");

    await click(button("İzin ver"));

    expect(js.init).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
  });

  it("aynı kararı yeniden vermek de bandı kapatır", async () => {
    await load({ consent: "denied" });
    await click(button("Analitik tercihi"));
    await click(button("İzin verme"));
    expect(banner()).toBeNull();
  });
});

describe("analitik anahtarı yokken (lokal geliştirme)", () => {
  it("sorulacak bir izin yoktur: bant da tercih bağlantısı da çizilmez", async () => {
    const { js } = await load({ key: "" });
    expect(banner()).toBeNull();
    expect(hasButton("Analitik tercihi")).toBe(false);
    expect(js.init).not.toHaveBeenCalled();
  });
});
