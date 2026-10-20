import { describe, expect, it, vi } from "vitest";
import { fetchPlatformOptions, isAllPlatforms, WATCH_DATA_CREDIT } from "@/lib/platforms";
import {
  DEFAULT_PREFERENCES,
  fetchPreferences,
  setPlatforms,
  setWeeklyPicksEnabled,
} from "@/lib/preferences";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

function setup(result: QueryResult, user: { id: string } | null = { id: "user-1" }) {
  const fake = fakeSupabase({ user, tables: { user_preferences: result, watch_providers: result } });
  useWebSupabase(fake.client);
  return fake;
}

describe("fetchPreferences", () => {
  it("varsayılanlar DB DEFAULT'u ile aynıdır: seçki açık, platform 'Tümü' (null)", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ weekly_picks_enabled: true, platforms: null });
  });

  it("oturum yoksa varsayılanları döner ve veritabanına gitmez", async () => {
    const fake = setup({ data: null }, null);
    expect(await fetchPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(fake.calls).toHaveLength(0);
  });

  it("satır yoksa varsayılanlar geçerlidir (hata değil, normal durum)", async () => {
    setup({ data: null });
    expect(await fetchPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("satırdaki değerleri okur", async () => {
    setup({ data: { weekly_picks_enabled: false, platforms: ["netflix", "mubi"] } });
    expect(await fetchPreferences()).toEqual({ weekly_picks_enabled: false, platforms: ["netflix", "mubi"] });
  });

  it("boş dizi (elle yazılmış bayat satır) 'Tümü' olarak okunur", async () => {
    setup({ data: { weekly_picks_enabled: true, platforms: [] } });
    expect((await fetchPreferences()).platforms).toBeNull();
  });

  it("okuma hatasında varsayılanlara düşer", async () => {
    setup({ error: { message: "rls" } });
    expect(await fetchPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  // Paket yalnızca entitlements.ts'ten okunur; kolonu okuyan tek bir yer anahtarı deler.
  it("`plan` kolonunu SEÇMEZ", async () => {
    const fake = setup({ data: null });
    await fetchPreferences();
    expect(fake.callsTo("user_preferences")[0].arg("select")).toBe("weekly_picks_enabled, platforms");
  });
});

describe("yazıcılar", () => {
  it("setWeeklyPicksEnabled yalnızca kendi kolonunu upsert eder", async () => {
    const fake = setup({ data: null });
    expect(await setWeeklyPicksEnabled(false)).toBe(true);

    const query = fake.callsTo("user_preferences")[0];
    expect(query.arg("upsert", 0)).toEqual({ user_id: "user-1", weekly_picks_enabled: false });
    expect(query.arg("upsert", 1)).toEqual({ onConflict: "user_id" });
  });

  it("setPlatforms yalnızca kendi kolonunu upsert eder (bayat bir tercih öbürünü ezmesin)", async () => {
    const fake = setup({ data: null });
    expect(await setPlatforms(["netflix", "mubi"])).toBe(true);
    expect(fake.callsTo("user_preferences")[0].arg("upsert", 0)).toEqual({
      user_id: "user-1",
      platforms: ["netflix", "mubi"],
    });
  });

  // DB'de boş dizi CHECK ile yasak: "hiçbir platform kabul değil" demek olurdu.
  it("setPlatforms boş seçimde NULL yazar, ASLA boş dizi yazmaz", async () => {
    const fake = setup({ data: null });
    await setPlatforms([]);
    expect(fake.callsTo("user_preferences")[0].arg<Record<string, unknown>>("upsert", 0)).toEqual({
      user_id: "user-1",
      platforms: null,
    });
  });

  it("hiçbir yazıcı payload'a `plan` koymaz", async () => {
    const fake = setup({ data: null });
    await setWeeklyPicksEnabled(true);
    await setPlatforms(["netflix"]);
    for (const query of fake.callsTo("user_preferences")) {
      expect(Object.keys(query.arg<Record<string, unknown>>("upsert", 0)!)).not.toContain("plan");
    }
  });

  it("oturum yoksa yazmaz ve false döner", async () => {
    const fake = setup({ data: null }, null);
    expect(await setWeeklyPicksEnabled(true)).toBe(false);
    expect(await setPlatforms(["netflix"])).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("yazma hatasında false döner (çağıran optimistic durumu geri alır)", async () => {
    setup({ error: { message: "check violation" } });
    expect(await setWeeklyPicksEnabled(true)).toBe(false);
    expect(await setPlatforms(["netflix"])).toBe(false);
  });
});

describe("platforms", () => {
  it("isAllPlatforms: null ve boş dizi 'Tümü'dür", () => {
    expect(isAllPlatforms(null)).toBe(true);
    expect(isAllPlatforms([])).toBe(true);
    expect(isAllPlatforms(["netflix"])).toBe(false);
  });

  it("fetchPlatformOptions service_id'si NULL olan platformu İSTEMEZ", async () => {
    const fake = setup({
      data: [
        { slug: "netflix", label_tr: "Netflix", service_id: "netflix" },
        { slug: "mubi", label_tr: "MUBI", service_id: "mubi" },
      ],
    });

    expect(await fetchPlatformOptions()).toEqual([
      { slug: "netflix", label: "Netflix" },
      { slug: "mubi", label: "MUBI" },
    ]);

    const query = fake.callsTo("watch_providers")[0];
    expect(query.ops.find((op) => op.method === "not")?.args).toEqual(["service_id", "is", null]);
    expect(query.ops.find((op) => op.method === "order")?.args).toEqual(["sort_order", { ascending: true }]);
  });

  it("okuma hatasında BOŞ dizi döner (yarım liste yanlış sonuç çıkarttırır)", async () => {
    setup({ error: { message: "x" } });
    expect(await fetchPlatformOptions()).toEqual([]);
  });

  it("erişilebilirlik künyesi sağlayıcının API sayfasına bakar", () => {
    expect(WATCH_DATA_CREDIT).toEqual({
      name: "Movie of the Night",
      url: "https://www.movieofthenight.com/about/api",
    });
  });
});
