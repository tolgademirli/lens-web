import { afterEach, beforeEach, vi } from "vitest";

/**
 * AĞ YASAĞI. Unit test hiçbir koşulda gerçek istek atmaz: Anthropic kredi yakar,
 * Resend gerçek mail atar, Supabase production'a yazar. İhtiyacı olan test
 * `vi.stubGlobal("fetch", ...)` ile kendi sahtesini verir; test bitince
 * (`unstubGlobals`) yine bu bekçiye dönülür.
 *
 * Doğrudan atama, `vi.stubGlobal` değil: stub'ın "aslı" bu bekçi olsun diye.
 */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Unit testte gerçek ağ isteği yasak: ${url}`);
}) as typeof fetch;

beforeEach(() => {
  // Üretim kodu beklenen hata yollarında bilerek log yazıyor; test çıktısını
  // boğmasın. Susturulan çağrılar hâlâ sayılır — `expect(console.error)` çalışır.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});
