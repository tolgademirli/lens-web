import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { bearerToken, loadReport } from "../../api/_lib/report.ts";
import { fakeSupabase, type FakeSupabase, type QueryResult } from "../helpers/fake-supabase";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const ID = "11111111-2222-3333-4444-555555555555";

let fake: FakeSupabase;

function setup(result: QueryResult) {
  fake = fakeSupabase({ rpcs: { lens_report_by_id: result } });
  vi.mocked(createClient).mockReturnValue(fake.client as never);
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  setup({ data: { id: ID, is_public: true } });
});

describe("bearerToken", () => {
  it.each([
    ["Bearer abc.def", "abc.def"],
    ["bearer abc", "abc"],
    ["  Bearer   abc  ", "abc"],
  ])("%j → %j", (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it("dizi gelirse ilk başlığı okur", () => {
    expect(bearerToken(["Bearer ilk", "Bearer ikinci"])).toBe("ilk");
  });

  it.each([[undefined], [""], ["Basic abc"], ["Bearer"], ["abc"]])("geçersiz başlık (%j) null döner", (header) => {
    expect(bearerToken(header)).toBeNull();
  });
});

describe("loadReport", () => {
  // Açık raporları tablodan veren politika kaldırıldı; anon client tabloda satır görmez.
  it("raporu `lens_report_by_id` ile ister, tablodan OKUMAZ", async () => {
    expect(await loadReport(ID)).toEqual({ id: ID, is_public: true });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ kind: "rpc", name: "lens_report_by_id", args: { p_id: ID } });
    expect(fake.client.from).not.toHaveBeenCalled();
  });

  it("token yoksa ANON anahtarıyla, oturum saklamayan bir istemci kurar", async () => {
    await loadReport(ID);
    expect(vi.mocked(createClient).mock.calls[0]).toEqual([
      "http://supabase.test",
      "anon-key",
      { auth: { persistSession: false, autoRefreshToken: false }, global: {} },
    ]);
  });

  it("token varsa onu Authorization başlığına koyar — kararı veritabanı verir", async () => {
    await loadReport(ID, "user-jwt");
    expect(vi.mocked(createClient).mock.calls[0][2]).toMatchObject({
      global: { headers: { Authorization: "Bearer user-jwt" } },
    });
  });

  // Service role ile okusaydık her endpoint'te gizlilik kontrolünü elle yazmak gerekirdi.
  it("ortamda service role anahtarı OLSA BİLE onu kullanmaz", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    await loadReport(ID, "user-jwt");
    expect(JSON.stringify(vi.mocked(createClient).mock.calls)).not.toContain("service-role-secret");
  });

  it("SUPABASE_* yoksa VITE_* değişkenlerine düşer", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_SUPABASE_URL", "http://vite.test");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "vite-anon");

    await loadReport(ID);

    expect(vi.mocked(createClient).mock.calls[0].slice(0, 2)).toEqual(["http://vite.test", "vite-anon"]);
  });

  it("ortam değişkenleri eksikse null döner ve istemci kurmaz", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(await loadReport(ID)).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["boş", ""],
    ["jenerik OG yolu", "lens"],
    ["kısa", "1111-2222"],
    ["enjeksiyon denemesi", `${ID}' OR '1'='1`],
    ["uuid olmayan 36 karakter", "z".repeat(36)],
  ])("uuid biçiminde olmayan id (%s) veritabanına hiç gitmez", async (_label, id) => {
    expect(await loadReport(id)).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // Çağıran "yok" ile "yetkin yok"u ayıramamalı: varlığı doğrulamak da sızıntıdır.
  it("erişilemeyen rapor ile hata aynı sonucu verir: null", async () => {
    setup({ data: null });
    expect(await loadReport(ID)).toBeNull();

    setup({ error: { message: "permission denied" } });
    expect(await loadReport(ID)).toBeNull();
  });
});
