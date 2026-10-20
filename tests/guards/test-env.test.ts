import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Testlerin KENDİ güvenliği. `.env.local` production Supabase ve PostHog anahtarlarını
 * taşıyor; bir mock unutulduğunda gerçek projeye yazan bir "unit test" en pahalı
 * hata olurdu. Buradaki testler düşerse diğer hiçbir teste güvenme.
 */
describe("test ortamı production'dan yalıtılmıştır", () => {
  it("istemci ortamı sabit test değerlerini taşır", () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBe("http://lens.test");
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBe("test-anon-key");
    expect(import.meta.env.VITE_POSTHOG_KEY).toBeFalsy();
  });

  it("`.env.local` içindeki HİÇBİR değer test sürecine sızmamıştır", () => {
    const file = path.resolve(process.cwd(), ".env.local");
    if (!existsSync(file)) return;

    const leaked: string[] = [];
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (!match) continue;
      const [, name, value] = match;
      // Kısa/jenerik değerler (ör. bir host adı) tesadüfen eşleşebilir; sır niteliğindekilere bak.
      if (value.length < 12) continue;
      const inProcess = Object.values(process.env).includes(value);
      const inVite = Object.values(import.meta.env).includes(value);
      // Değerin kendisi asla yazdırılmaz — yalnızca değişkenin adı.
      if (inProcess || inVite) leaked.push(name);
    }
    expect(leaked).toEqual([]);
  });

  it("gerçek ağ isteği yasaktır: mock'lanmamış fetch hata verir", async () => {
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow("Unit testte gerçek ağ isteği yasak");
    await expect(fetch(new URL("https://api.resend.com/emails"))).rejects.toThrow("api.resend.com");
  });

  it("edge function'lar için Deno köprüsü kurulmuştur ve sunucu açmaz", () => {
    const deno = (globalThis as Record<string, any>).Deno;
    expect(typeof deno.serve).toBe("function");
    expect(deno.env.get("LENS_TANIMSIZ_DEGISKEN")).toBeUndefined();
  });
});
