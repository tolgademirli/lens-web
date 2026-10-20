/**
 * `src/lib/*` testlerinde `@/lib/supabase`'in yerine geçen istemci.
 *
 * Kullanım (her test dosyasının başında, `vi.mock` dosyaya özgü olduğu için):
 *
 *   vi.mock("@/lib/supabase", async () =>
 *     (await import("../helpers/web-supabase")).supabaseModuleMock());
 *
 *   beforeEach(() => { fake = fakeSupabase({...}); useWebSupabase(fake.client); });
 *
 * Durum `globalThis`'te tutulur: `vi.resetModules()` bu yardımcıyı da yeniden
 * yükler ve modül düzeyindeki bir değişken, testin elindeki kopyadan ayrışırdı.
 */
declare global {
  // eslint-disable-next-line no-var
  var __lensWebSupabase: unknown;
}

export function useWebSupabase(client: unknown): void {
  globalThis.__lensWebSupabase = client;
}

/** Her erişimde O ANKİ sahte istemciye bakan vekil. */
export function supabaseProxy(): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const client = globalThis.__lensWebSupabase as Record<string | symbol, unknown> | undefined;
        if (!client) throw new Error("Sahte Supabase verilmedi: önce useWebSupabase(fake.client) çağır.");
        return client[prop];
      },
    },
  );
}

export function supabaseModuleMock() {
  return { supabase: supabaseProxy() };
}
