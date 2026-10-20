import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderGeneric, renderPoster } from "../../api/_lib/render.ts";
import { loadReport } from "../../api/_lib/report.ts";
import ogHandler from "../../api/og/[reportId].ts";
import posterHandler from "../../api/poster/[reportId].ts";
import previewHandler from "../../api/report-preview.ts";
import { reportRow } from "../helpers/fixtures";
import { fakeReq, fakeRes } from "../helpers/http";

// Gizlilik kararı (loadReport) ve çizim (render) ayrı test ediliyor; burada
// handler'ların o ikisinin sonucuyla NE YAPTIĞI sınanır.
vi.mock("../../api/_lib/report.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/_lib/report.ts")>()),
  loadReport: vi.fn(),
}));
vi.mock("../../api/_lib/render.ts", () => ({ renderPoster: vi.fn(), renderGeneric: vi.fn() }));

const ID = "11111111-2222-3333-4444-555555555555";
const PNG = Buffer.from("poster-png");
const GENERIC = Buffer.from("generic-png");

beforeEach(() => {
  vi.mocked(renderPoster).mockResolvedValue(PNG);
  vi.mocked(renderGeneric).mockResolvedValue(GENERIC);
  vi.mocked(loadReport).mockResolvedValue(reportRow({ is_public: true }));
});

describe("GET /api/poster/:reportId", () => {
  it("erişilemeyen raporda BOŞ gövdeli 404 döner — varlığı bile sızmaz", async () => {
    vi.mocked(loadReport).mockResolvedValue(null);
    const res = fakeRes();

    await posterHandler(fakeReq({ query: { reportId: ID } }), res);

    expect(res.status).toBe(404);
    expect(res.body).toBeUndefined();
    expect(renderPoster).not.toHaveBeenCalled();
  });

  it("çağıranın token'ını loadReport'a taşır (yetkiyi veritabanı verir)", async () => {
    await posterHandler(
      fakeReq({ query: { reportId: ID }, headers: { authorization: "Bearer user-jwt" } }),
      fakeRes(),
    );
    expect(loadReport).toHaveBeenCalledWith(ID, "user-jwt");
  });

  it("token yoksa anon okur", async () => {
    await posterHandler(fakeReq({ query: { reportId: ID } }), fakeRes());
    expect(loadReport).toHaveBeenCalledWith(ID, null);
  });

  it("açık rapor CDN'de önbelleğe alınabilir; dosya adı arketipten türer", async () => {
    const res = fakeRes();
    await posterHandler(fakeReq({ query: { reportId: ID, format: "feed" } }), res);

    expect(res.status).toBe(200);
    expect(res.body).toBe(PNG);
    expect(renderPoster).toHaveBeenCalledWith(expect.anything(), "feed");
    expect(res.headers).toMatchObject({
      "Content-Type": "image/png",
      "Content-Length": PNG.length,
      "Content-Disposition": 'inline; filename="lens-kadife-ceketli-sokak-filozofu-feed.png"',
    });
    expect(res.headers["Cache-Control"]).toMatch(/^public,/);
  });

  // Sahibinin token'ıyla üretildi; başkasına servis edilmemeli.
  it("ÖZEL rapor asla önbelleğe alınmaz", async () => {
    vi.mocked(loadReport).mockResolvedValue(reportRow({ is_public: false }));
    const res = fakeRes();

    await posterHandler(fakeReq({ query: { reportId: ID } }), res);

    expect(res.status).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("bilinmeyen format story'ye düşer; id ve format URL'den de okunur", async () => {
    await posterHandler(fakeReq({ url: `/api/poster/${ID}?format=og` }), fakeRes());
    expect(loadReport).toHaveBeenCalledWith(ID, null);
    expect(renderPoster).toHaveBeenLastCalledWith(expect.anything(), "og");

    await posterHandler(fakeReq({ query: { reportId: ID, format: "tabloid" } }), fakeRes());
    expect(renderPoster).toHaveBeenLastCalledWith(expect.anything(), "story");
  });

  it("render patlarsa 500 döner", async () => {
    vi.mocked(renderPoster).mockRejectedValue(new Error("satori"));
    const res = fakeRes();
    await posterHandler(fakeReq({ query: { reportId: ID } }), res);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/og/:reportId", () => {
  it("açık raporun OG görselini döner", async () => {
    const res = fakeRes();
    await ogHandler(fakeReq({ query: { reportId: ID } }), res);

    expect(res.status).toBe(200);
    expect(res.body).toBe(PNG);
    expect(renderPoster).toHaveBeenCalledWith(expect.anything(), "og");
    expect(res.headers["Cache-Control"]).toContain("s-maxage=3600");
  });

  // Crawler çağırıyor; herkese açık olmayan hiçbir şey dönmemeli.
  it("Authorization başlığı gelse BİLE token'ı kullanmaz", async () => {
    await ogHandler(fakeReq({ query: { reportId: ID }, headers: { authorization: "Bearer owner-jwt" } }), fakeRes());
    expect(loadReport).toHaveBeenCalledWith(ID);
  });

  it("özel/olmayan raporda 404 DEĞİL jenerik marka görseli döner, kısa önbellekle", async () => {
    vi.mocked(loadReport).mockResolvedValue(null);
    const res = fakeRes();

    await ogHandler(fakeReq({ query: { reportId: ID } }), res);

    expect(res.status).toBe(200);
    expect(res.body).toBe(GENERIC);
    expect(renderPoster).not.toHaveBeenCalled();
    expect(res.headers["Cache-Control"]).toContain("s-maxage=300");
  });

  it("rapor okunamaz ya da render patlarsa jenerik görsele düşer", async () => {
    vi.mocked(loadReport).mockRejectedValue(new Error("db"));
    const failed = fakeRes();
    await ogHandler(fakeReq({ query: { reportId: ID } }), failed);
    expect(failed.status).toBe(200);
    expect(failed.body).toBe(GENERIC);

    vi.mocked(loadReport).mockResolvedValue(reportRow());
    vi.mocked(renderPoster).mockRejectedValue(new Error("satori"));
    const broken = fakeRes();
    await ogHandler(fakeReq({ query: { reportId: ID } }), broken);
    expect(broken.status).toBe(200);
    expect(broken.body).toBe(GENERIC);
    expect(broken.headers["Cache-Control"]).toContain("s-maxage=300");
  });

  it("jenerik görsel de üretilemezse 500 döner", async () => {
    vi.mocked(loadReport).mockRejectedValue(new Error("db"));
    vi.mocked(renderGeneric).mockRejectedValue(new Error("font"));
    const res = fakeRes();
    await ogHandler(fakeReq({ query: { reportId: ID } }), res);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/report-preview (crawler HTML'i)", () => {
  const host = { host: "lensestetik.com" };

  async function preview(req = fakeReq({ url: `/api/report-preview?id=${ID}`, headers: host })) {
    const res = fakeRes();
    await previewHandler(req, res);
    return { res, html: String(res.body) };
  }

  it("açık raporda arketip başlığı, özeti ve raporun OG görselini yazar", async () => {
    const { res, html } = await preview();

    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(html).toContain('<meta property="og:title" content="Kadife Ceketli Sokak Filozofu — Lens Estetik Kimlik">');
    expect(html).toContain(`<meta property="og:image" content="https://lensestetik.com/api/og/${ID}">`);
    expect(html).toContain(`<link rel="canonical" href="https://lensestetik.com/report/${ID}">`);
    expect(html).toContain("Salonla sokağı aynı cümlede buluşturan");
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<html lang="tr">');
  });

  it("anon okur: token GEÇMEZ", async () => {
    await preview(fakeReq({ url: `/?id=${ID}`, headers: { ...host, authorization: "Bearer owner-jwt" } }));
    expect(loadReport).toHaveBeenCalledWith(ID);
  });

  it("özel raporda jenerik meta kalır — arketip ve özet SIZMAZ", async () => {
    vi.mocked(loadReport).mockResolvedValue(null);
    const { res, html } = await preview();

    expect(res.status).toBe(200);
    expect(html).toContain("<title>Lens — Estetik Kimlik</title>");
    expect(html).toContain('content="https://lensestetik.com/api/og/lens"');
    expect(html).not.toContain("Filozof");
    expect(html).not.toContain("Salonla");
    // Bağlantı yine rapora götürür; sayfa giriş ister.
    expect(html).toContain(`https://lensestetik.com/report/${ID}`);
  });

  // Crawler'a giden 5xx o linkin bir süre yeniden denenmemesine yol açıyor.
  it("HİÇBİR KOŞULDA hata döndürmez: rapor okunamazsa jenerik 200", async () => {
    vi.mocked(loadReport).mockRejectedValue(new Error("db down"));
    const { res, html } = await preview();
    expect(res.status).toBe(200);
    expect(html).toContain("<title>Lens — Estetik Kimlik</title>");
  });

  it("id yoksa ana sayfaya işaret eder ve veritabanına gitmez", async () => {
    const { res, html } = await preview(fakeReq({ url: "/api/report-preview", headers: host }));
    expect(res.status).toBe(200);
    expect(html).toContain('<link rel="canonical" href="https://lensestetik.com/">');
    expect(loadReport).not.toHaveBeenCalled();
  });

  it("arketip adındaki HTML'i kaçışlar", async () => {
    vi.mocked(loadReport).mockResolvedValue(
      reportRow({ hero: { archetype: '<script>alert("x")</script> & Co', summary: 'tırnak " içerir' } } as never),
    );
    const { html } = await preview();

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
    expect(html).toContain("tırnak &quot; içerir");
  });

  it("arketibi boş raporda jenerik metaya düşer", async () => {
    vi.mocked(loadReport).mockResolvedValue(reportRow({ hero: { archetype: "  " } } as never));
    const { html } = await preview();
    expect(html).toContain("<title>Lens — Estetik Kimlik</title>");
    expect(html).toContain("/api/og/lens");
  });

  it("site kökünü istekten türetir (preview deploy'larında da doğru olsun)", async () => {
    const { html } = await preview(
      fakeReq({
        url: `/?id=${ID}`,
        headers: { "x-forwarded-host": "lens-git-x.vercel.app", "x-forwarded-proto": "https", host: "ic.host" },
      }),
    );
    expect(html).toContain(`https://lens-git-x.vercel.app/report/${ID}`);
  });

  it("host başlığı yoksa SITE_URL'e, o da yoksa lensestetik.com'a düşer", async () => {
    vi.stubEnv("SITE_URL", "https://staging.lens.test");
    expect((await preview(fakeReq({ url: `/?id=${ID}` }))).html).toContain("https://staging.lens.test/report/");

    vi.stubEnv("SITE_URL", "");
    expect((await preview(fakeReq({ url: `/?id=${ID}` }))).html).toContain("https://lensestetik.com/report/");
  });

  it("crawler yanıtı kısa yaşar (paylaşıma açılan rapor dakikalar içinde güncellensin)", async () => {
    const { res } = await preview();
    expect(res.headers["Cache-Control"]).toContain("s-maxage=300");
  });
});
