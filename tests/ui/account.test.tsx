import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../helpers/fake-supabase";
import { click, currentPath, hasButton, mount, pageText, query, unmountAll } from "../helpers/render";
import { useWebSupabase } from "../helpers/web-supabase";

/**
 * /account — "Verilerim" bölümünün HİÇBİR anahtara bağlı olmadığı.
 *
 * Analitik izni ile hesap silme, kullanıcının verisi üzerindeki söz hakkıdır;
 * premium kapalı ya da mail duraklatılmış diye erişilmez olamaz. Sayfa bir dönem
 * tam da bu koşulda gizleniyordu. Aynı sayfa premium anahtarının öbür kuralını da
 * taşır: anahtar kapalıyken arayüz "paket / premium / ücretsiz" kelimelerini kurmaz.
 *
 * Sayfa durum kuran modüllere (posthog.ts) dayandığı için her test taze kopya yükler.
 */
vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() },
}));
vi.mock("@/lib/supabase", async () => ({
  ...(await import("../helpers/web-supabase")).supabaseModuleMock(),
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlements")>()),
  fetchEntitlements: vi.fn(),
}));
vi.mock("@/lib/preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/preferences")>()),
  fetchPreferences: vi.fn(),
  setWeeklyPicksEnabled: vi.fn(async () => true),
  setPlatforms: vi.fn(async () => true),
}));
vi.mock("@/lib/platforms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platforms")>()),
  fetchPlatformOptions: vi.fn(),
}));
vi.mock("@/lib/account", () => ({ deleteAccount: vi.fn(async () => true) }));

const PLAN_WORDS = /\S*(premium|ücret|paket)\S*/giu;
const headings = () => [...document.querySelectorAll("h3")].map((h) => h.textContent);

interface Options {
  premiumEnabled?: boolean;
  plan?: "free" | "premium";
  platformOptions?: { slug: string; label: string }[];
  analyticsKey?: string;
  signedIn?: boolean;
}

async function load(options: Options = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", options.analyticsKey ?? "");
  useWebSupabase(fakeSupabase({ user: { id: "user-1" } }).client);

  const supabase = await import("@/lib/supabase");
  vi.mocked(supabase.getCurrentUser).mockResolvedValue(
    (options.signedIn === false ? null : { id: "user-1", email: "biri@example.com" }) as never,
  );
  const entitlements = await import("@/lib/entitlements");
  vi.mocked(entitlements.fetchEntitlements).mockResolvedValue({
    premiumEnabled: options.premiumEnabled ?? false,
    plan: options.plan ?? "free",
  });
  const preferences = await import("@/lib/preferences");
  vi.mocked(preferences.fetchPreferences).mockResolvedValue({ weekly_picks_enabled: true, platforms: null });
  const platforms = await import("@/lib/platforms");
  vi.mocked(platforms.fetchPlatformOptions).mockResolvedValue(options.platformOptions ?? []);

  const { Account } = await import("@/pages/Account");
  await mount(<Account />, { route: "/account" });
  return { emailPaused: preferences.WEEKLY_PICKS_EMAIL_PAUSED, fetchPlatformOptions: platforms.fetchPlatformOptions };
}

// Sayfanın import ağacı büyük; ilk (soğuk) yükleme testin süresinden yenmesin.
// Sonraki `load()` çağrıları aynı dönüşümleri önbellekten alır.
beforeAll(async () => {
  await import("@/pages/Account");
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await unmountAll();
});

describe("'Verilerim' hiçbir anahtara bağlı değildir", () => {
  const netflix = [{ slug: "netflix", label: "Netflix" }];

  it.each<[string, Options]>([
    ["premium anahtarı KAPALI", { premiumEnabled: false }],
    ["premium açık, paket free", { premiumEnabled: true, plan: "free", platformOptions: netflix }],
    ["premium açık, paket premium", { premiumEnabled: true, plan: "premium", platformOptions: netflix }],
    ["premium açık ama platform sözlüğü okunamadı", { premiumEnabled: true, plan: "premium", platformOptions: [] }],
    ["analitik anahtarı yok (lokal)", { analyticsKey: "" }],
    ["analitik anahtarı var", { analyticsKey: "phc_test" }],
  ])("%s → bölüm, hesap silme ve metin bağlantıları çizilir", async (_label, options) => {
    await load(options);

    expect(headings()).toContain("Verilerim");
    expect(hasButton("Hesabımı sil")).toBe(true);
    for (const route of ["/privacy", "/cookies", "/terms"]) {
      expect(document.querySelector(`a[href="${route}"]`), route).not.toBeNull();
    }
    expect(pageText()).toContain("Bu işlem geri alınamaz");
  });

  it("neyin tutulduğunu AÇIKLAR; yalnızca düğme koymaz", async () => {
    await load();
    const text = pageText();
    expect(text).toContain("LENS'TE SANA AİT OLANLAR");
    expect(text).toContain("Ekran görüntüsünün kendisi saklanmaz.");
  });

  it("'Hesabımı sil' onay penceresini açar; açılması hiçbir şey silmez", async () => {
    await load();
    const { deleteAccount } = await import("@/lib/account");

    await click(query('button[class*="border-red-400"]'));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

describe("premium anahtarı KAPALIYKEN", () => {
  // "Ücretsiz paket" demek bile ücretli bir paketin var olduğunu söyler.
  it("ekranda 'paket / premium / ücret' kelimeleri HİÇ geçmez", async () => {
    await load({ premiumEnabled: false });
    expect(pageText().match(PLAN_WORDS) ?? []).toEqual([]);
  });

  it("kolon 'premium' dese bile (etkin paket free) paket bölümü çizilmez", async () => {
    await load({ premiumEnabled: false, plan: "free" });
    expect(pageText()).not.toMatch(/Paketin/);
  });

  // Anahtar kapalıyken platform kartı çizilmiyor; sözlüğü de çekmiyoruz.
  it("platform sözlüğü hiç istenmez", async () => {
    const { fetchPlatformOptions } = await load({ premiumEnabled: false });
    expect(fetchPlatformOptions).not.toHaveBeenCalled();
  });

  // Çizilecek kart yoksa bölüm BAŞLIĞIYLA BİRLİKTE düşer: boş bir başlık söz verir.
  it("'Tercihlerim' başlığı yalnızca altında bir kart varsa çizilir", async () => {
    const { emailPaused } = await load({ premiumEnabled: false });
    expect(headings().includes("Tercihlerim")).toBe(!emailPaused);
    if (emailPaused) expect(pageText()).toContain("Lens'teki verilerin ve onlarla ilgili kararların burada.");
  });
});

describe("premium anahtarı AÇIKKEN", () => {
  it("paket bölümü çizilir ve 'Verilerim' yerinde durur", async () => {
    await load({ premiumEnabled: true, plan: "premium", platformOptions: [{ slug: "netflix", label: "Netflix" }] });
    expect(pageText().match(PLAN_WORDS) ?? []).not.toEqual([]);
    expect(headings()).toEqual(expect.arrayContaining(["Tercihlerim", "Verilerim"]));
  });
});

describe("kullanım ölçümü kartı", () => {
  const consentSwitch = () => document.querySelector<HTMLButtonElement>("#analytics-consent");

  it("analitik anahtarı yokken çizilmez (ölçülecek bir şey yok); hesap silme yine durur", async () => {
    await load({ analyticsKey: "" });
    expect(consentSwitch()).toBeNull();
    expect(hasButton("Hesabımı sil")).toBe(true);
  });

  it("bantla AYNI kararı gösterir ve değiştirir", async () => {
    await load({ analyticsKey: "phc_test" });
    expect(consentSwitch()!.getAttribute("aria-checked")).toBe("false");

    await click(consentSwitch()!);

    expect(localStorage.getItem("lens_analytics_consent")).toBe("granted");
    expect(consentSwitch()!.getAttribute("aria-checked")).toBe("true");

    await click(consentSwitch()!);
    expect(localStorage.getItem("lens_analytics_consent")).toBe("denied");
  });

  it("önceki ziyarette verilen izni açık gösterir", async () => {
    localStorage.setItem("lens_analytics_consent", "granted");
    await load({ analyticsKey: "phc_test" });
    expect(consentSwitch()!.getAttribute("aria-checked")).toBe("true");
  });

  // Toplanan veriyi anlatır; oturum kaydı kodda kapalı olduğu için ondan söz etmez.
  it("neyin kaydedildiğini söyler, ekran kaydından söz etmez", async () => {
    await load({ analyticsKey: "phc_test" });
    const text = pageText();
    expect(text).toContain("Hangi ekranlara uğradığın ve neye dokunduğun kaydedilir.");
    expect(text).toContain("PostHog'un yurt dışındaki sunucularında tutulur.");
    expect(text).not.toMatch(/ekran kayd/i);
  });
});

describe("oturum", () => {
  it("oturumu olmayan ziyaretçi /login'e yönlenir", async () => {
    await load({ signedIn: false });
    expect(currentPath()).toBe("/login");
  });
});
