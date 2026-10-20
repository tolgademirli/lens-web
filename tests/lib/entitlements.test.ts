import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

/** Modül kullanıcı başına önbellek tutuyor; her test taze kopyayla başlar. */
async function load(row: unknown, options: { error?: unknown; userId?: string | null } = {}) {
  vi.resetModules();
  const fake: FakeSupabase = fakeSupabase({
    user: options.userId === null ? null : { id: options.userId ?? "user-1" },
    rpcs: { lens_entitlements: options.error ? { error: options.error } : { data: row } },
  });
  useWebSupabase(fake.client);
  const mod = await import("@/lib/entitlements");
  return { fake, ...mod };
}

describe("fetchEntitlements — premium anahtarı", () => {
  it("anahtar KAPALIYKEN kolon 'premium' dese bile etkin paket 'free'dir", async () => {
    const { fetchEntitlements } = await load({ premium_enabled: false, plan: "premium" });
    expect(await fetchEntitlements()).toEqual({ premiumEnabled: false, plan: "free" });
  });

  it("anahtar açık ve paket premium ise premium döner", async () => {
    const { fetchEntitlements, fetchPlan } = await load({ premium_enabled: true, plan: "premium" });
    expect(await fetchEntitlements()).toEqual({ premiumEnabled: true, plan: "premium" });
    expect(await fetchPlan()).toBe("premium");
  });

  it("anahtar açık ama paket free ise free döner", async () => {
    const { fetchEntitlements } = await load({ premium_enabled: true, plan: "free" });
    expect(await fetchEntitlements()).toEqual({ premiumEnabled: true, plan: "free" });
  });

  it.each([
    ["boş yanıt", null],
    ["truthy ama true olmayan anahtar", { premium_enabled: "true", plan: "premium" }],
    ["tanınmayan paket", { premium_enabled: true, plan: "gold" }],
  ])("%s güvenli tarafa (free) düşer", async (_label, row) => {
    const { fetchPlan } = await load(row);
    expect(await fetchPlan()).toBe("free");
  });

  it("okunamazsa KAPALI döner — emin olmadığımız premium'u ekrana yazmayız", async () => {
    const { fetchEntitlements } = await load(null, { error: { message: "network" } });
    expect(await fetchEntitlements()).toEqual({ premiumEnabled: false, plan: "free" });
  });

  it("paketi `lens_entitlements` RPC'sinden okur, user_preferences tablosundan DEĞİL", async () => {
    const { fake, fetchEntitlements } = await load({ premium_enabled: true, plan: "premium" });
    await fetchEntitlements();
    expect(fake.calls.map((c) => [c.kind, c.name])).toEqual([["rpc", "lens_entitlements"]]);
    expect(fake.client.from).not.toHaveBeenCalled();
  });
});

describe("önbellek", () => {
  it("aynı kullanıcı için tek RPC yapar", async () => {
    const { fake, fetchEntitlements, fetchPlan } = await load({ premium_enabled: true, plan: "premium" });
    await fetchEntitlements();
    await fetchEntitlements();
    await fetchPlan();
    expect(fake.callsTo("lens_entitlements")).toHaveLength(1);
  });

  it("hata önbelleğe ALINMAZ: geçici bir ağ hatası oturum boyunca premium'u gizlemesin", async () => {
    const { fake, fetchEntitlements } = await load(null, { error: { message: "network" } });
    await fetchEntitlements();
    await fetchEntitlements();
    expect(fake.callsTo("lens_entitlements")).toHaveLength(2);
  });

  it("kullanıcı değişince yeniden okur — önceki hesabın paketi devralınmaz", async () => {
    const { fake, fetchEntitlements } = await load({ premium_enabled: true, plan: "premium" });
    await fetchEntitlements();

    fake.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" }, access_token: "t" } },
      error: null,
    } as never);
    await fetchEntitlements();

    expect(fake.callsTo("lens_entitlements")).toHaveLength(2);
  });

  it("oturumsuz ziyaretçi de (userId null) önbelleğe alınır", async () => {
    const { fake, fetchEntitlements } = await load({ premium_enabled: false, plan: "free" }, { userId: null });
    await fetchEntitlements();
    await fetchEntitlements();
    expect(fake.callsTo("lens_entitlements")).toHaveLength(1);
  });
});

describe("PLAN_TEMPO", () => {
  beforeEach(() => vi.resetModules());

  it("ücretsiz: haftalık ayar + 30 gün hafıza; premium: anında + sınırsız", async () => {
    const { PLAN_TEMPO } = await load(null);
    expect(PLAN_TEMPO).toEqual({
      free: { axisTuning: "weekly", memoryWindowDays: 30 },
      premium: { axisTuning: "immediate", memoryWindowDays: null },
    });
  });
});
