import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  AnalyzeError,
  analyzeAndCreateReport,
  fetchCurrentWeeklyPick,
  fetchDailyDiscovery,
  fetchReport,
  fetchUserReports,
  getCurrentUser,
  sendMagicLink,
  signInWithGoogle,
  updateReportVisibility,
  verifyEmailCode,
} from "@/lib/supabase";
import { emptyDraft } from "@/lib/tasteDraft";
import { fakeSupabase, type FakeSupabaseConfig } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

// Gerçek modül test edilir; yalnızca istemci fabrikası sahtedir.
vi.mock("@supabase/supabase-js", async () => {
  const { supabaseProxy } = await import("../helpers/web-supabase");
  return { createClient: vi.fn(() => supabaseProxy()) };
});

// İstemci modül yüklenirken kurulur; `clearMocks` her testten önce çağrı
// geçmişini sildiği için argümanlar burada, testler başlamadan alınır.
const clientArgs = vi.mocked(createClient).mock.calls[0];

function setup(config: FakeSupabaseConfig) {
  const fake = fakeSupabase({ user: { id: "user-1" }, ...config });
  useWebSupabase(fake.client);
  return fake;
}

describe("istemci", () => {
  // `.env.local` production'ı gösteriyor; testler onu hiç yüklememeli.
  it("TEST değerleriyle kurulur, production anahtarlarıyla değil", () => {
    expect(clientArgs).toEqual(["http://lens.test", "test-anon-key"]);
  });
});

describe("fetchReport", () => {
  // Tablodan okumak açık raporları LİSTELENEBİLİR yapıyordu (14789e7).
  it("raporu `lens_report_by_id` RPC'siyle ister, `reports` tablosundan DEĞİL", async () => {
    const fake = setup({ rpcs: { lens_report_by_id: { data: { id: "r1", is_public: true } } } });

    expect(await fetchReport("r1")).toEqual({ id: "r1", is_public: true });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ kind: "rpc", name: "lens_report_by_id", args: { p_id: "r1" } });
    expect(fake.calls[0].has("maybeSingle")).toBe(true);
    expect(fake.client.from).not.toHaveBeenCalled();
  });

  it("erişilemeyen rapor (özel / yok) ile hata aynı sonucu verir: null", async () => {
    setup({ rpcs: { lens_report_by_id: { data: null } } });
    expect(await fetchReport("r1")).toBeNull();

    setup({ rpcs: { lens_report_by_id: { error: { message: "x" } } } });
    expect(await fetchReport("r1")).toBeNull();
  });
});

describe("updateReportVisibility", () => {
  it("yalnızca is_public'i, yalnızca o raporda günceller", async () => {
    const fake = setup({ tables: { reports: { data: null } } });

    expect(await updateReportVisibility("r1", true)).toBe(true);

    const query = fake.callsTo("reports")[0];
    expect(query.arg("update")).toEqual({ is_public: true });
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["id", "r1"]);
  });

  it("hata olursa false döner", async () => {
    setup({ tables: { reports: { error: { message: "rls" } } } });
    expect(await updateReportVisibility("r1", true)).toBe(false);
  });
});

describe("analyzeAndCreateReport", () => {
  const draft = {
    ...emptyDraft(),
    books: [{ title: "Tutunamayanlar", creator: "Oğuz Atay", source: "screenshot" as const, workId: "w-1" }],
    music: [{ title: "", creator: "Adamlar", source: "manual" as const, workId: "" }],
  };

  it("sinyalleri YAPILI yollar: source ve work_id her nesnenin içindedir", async () => {
    const fake = setup({ functions: { analyze: { data: { reportId: "report-1" } } } });

    expect(await analyzeAndCreateReport(draft)).toBe("report-1");

    expect(fake.callsTo("analyze")[0].args).toEqual({
      body: {
        books: [{ title: "Tutunamayanlar", creator: "Oğuz Atay", source: "screenshot", work_id: "w-1" }],
        movies: [],
        music: [{ title: "", creator: "Adamlar", source: "manual", work_id: "" }],
      },
    });
  });

  it("edge function'ın mesajını ve durumunu AnalyzeError'a taşır", async () => {
    const context = new Response(JSON.stringify({ error: "Bugün için rapor limitine ulaştın." }), { status: 429 });
    setup({ functions: { analyze: { error: { context } } } });

    const failure = await analyzeAndCreateReport(draft).catch((err) => err);

    expect(failure).toBeInstanceOf(AnalyzeError);
    expect(failure.status).toBe(429);
    expect(failure.message).toBe("Bugün için rapor limitine ulaştın.");
  });

  it("gövdesiz hatada jenerik mesaj ve 500 kullanır", async () => {
    setup({ functions: { analyze: { error: { message: "fetch failed" } } } });
    const failure = await analyzeAndCreateReport(draft).catch((err) => err);
    expect(failure).toBeInstanceOf(AnalyzeError);
    expect(failure.status).toBe(500);
  });

  it("reportId dönmezse fırlatır — kullanıcı boş bir rapora yönlenmez", async () => {
    setup({ functions: { analyze: { data: {} } } });
    await expect(analyzeAndCreateReport(draft)).rejects.toThrow("reportId dönmedi");
  });
});

describe("oturum isteyen okuyucular", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  });

  it("oturum yoksa hiçbiri veritabanına ya da fonksiyona gitmez", async () => {
    const fake = setup({ user: null });

    expect(await fetchDailyDiscovery()).toBeNull();
    expect(await fetchCurrentWeeklyPick()).toBeNull();
    expect(await fetchUserReports()).toEqual([]);
    expect(await getCurrentUser()).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("fetchDailyDiscovery oturum token'ını yollar; hata olursa null döner", async () => {
    const fake = setup({ functions: { "daily-discovery": { data: { book: "x" } } } });
    expect(await fetchDailyDiscovery()).toEqual({ book: "x" });
    expect(fake.callsTo("daily-discovery")[0].args).toEqual({
      headers: { Authorization: "Bearer test-access-token" },
    });

    setup({ functions: { "daily-discovery": { error: { message: "502" } } } });
    expect(await fetchDailyDiscovery()).toBeNull();
  });

  it("fetchCurrentWeeklyPick haftası 7 günden fazla geçmiş seçkiyi istemez", async () => {
    const fake = setup({ tables: { weekly_picks: { data: { id: "pick-1" } } } });

    expect(await fetchCurrentWeeklyPick()).toEqual({ id: "pick-1" });

    const query = fake.callsTo("weekly_picks")[0];
    expect(query.ops.find((op) => op.method === "gte")?.args).toEqual(["week", "2026-10-04"]);
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["user_id", "user-1"]);
    // Statüye bakılmaz: mail gitmemiş (draft) seçki de panelde görünür.
    expect(query.ops.filter((op) => op.method === "eq")).toHaveLength(1);
  });

  it("fetchCurrentWeeklyPick satır yoksa ya da hata olursa null döner", async () => {
    setup({ tables: { weekly_picks: { data: null } } });
    expect(await fetchCurrentWeeklyPick()).toBeNull();
    setup({ tables: { weekly_picks: { error: { message: "x" } } } });
    expect(await fetchCurrentWeeklyPick()).toBeNull();
  });

  it("fetchUserReports yalnızca oturumdaki kullanıcının raporlarını ister", async () => {
    const fake = setup({ tables: { reports: { data: [{ id: "r1" }] } } });
    expect(await fetchUserReports()).toEqual([{ id: "r1" }]);
    expect(fake.callsTo("reports")[0].ops.find((op) => op.method === "eq")?.args).toEqual(["user_id", "user-1"]);

    setup({ tables: { reports: { error: { message: "x" } } } });
    expect(await fetchUserReports()).toEqual([]);
  });

  it("getCurrentUser oturumdaki kullanıcıyı döner", async () => {
    setup({});
    expect(await getCurrentUser()).toEqual({ id: "user-1" });
  });
});

describe("giriş", () => {
  it("magic link ve Google girişi dönüş adresini taşır", async () => {
    const fake = setup({});

    await sendMagicLink("biri@example.com", "http://lens.test/auth/callback");
    await signInWithGoogle("http://lens.test/auth/callback");

    expect(fake.client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "biri@example.com",
      options: { emailRedirectTo: "http://lens.test/auth/callback" },
    });
    expect(fake.client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://lens.test/auth/callback" },
    });
  });
});

// Bağlantı başka tarayıcıda açılınca taslak ilk tarayıcıda kalıyordu (11 Ekim 2026);
// kod, oturumu yazıldığı tarayıcıda açar.
describe("verifyEmailCode — e-postadaki kodla giriş", () => {
  // `magiclink` türü yalnızca dönen kullanıcıda, `signup` yalnızca ilk girişte geçer.
  it("kodu `email` türüyle doğrular: ilk giriş de dönen kullanıcı da aynı çağrıdan geçer", async () => {
    const fake = setup({});

    expect(await verifyEmailCode("biri@example.com", "730257")).toBe("ok");

    expect(fake.client.auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "biri@example.com",
      token: "730257",
      type: "email",
    });
  });

  it.each([
    ["yanlış / kullanılmış / süresi dolmuş kod", { status: 403, code: "otp_expired" }, "rejected"],
    ["kodsuz 403", { status: 403 }, "rejected"],
    ["durumsuz otp_expired", { code: "otp_expired" }, "rejected"],
    ["istek sınırı", { status: 429, code: "over_request_rate_limit" }, "failed"],
    ["ağ hatası", { status: 0, name: "AuthRetryableFetchError" }, "failed"],
    ["sunucu hatası", { status: 500 }, "failed"],
  ])("%s → %j → %s", async (_name, error, expected) => {
    const fake = setup({});
    fake.client.auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });

    expect(await verifyEmailCode("biri@example.com", "000000")).toBe(expected);
  });

  // "ok" yönlendirme demek; oturum yokken yönlendirmek kullanıcıyı sonsuz beklemeye sokar.
  it("hata yok ama oturum da yoksa 'ok' DEMEZ", async () => {
    const fake = setup({});
    fake.client.auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });

    expect(await verifyEmailCode("biri@example.com", "730257")).toBe("failed");
  });

  it("istemci fırlatırsa hata yukarı sızmaz: 'failed'", async () => {
    const fake = setup({});
    fake.client.auth.verifyOtp.mockRejectedValue(new TypeError("fetch failed"));

    expect(await verifyEmailCode("biri@example.com", "730257")).toBe("failed");
  });
});
