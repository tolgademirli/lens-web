/**
 * Crawler'a OG etiketli HTML döndürür.
 *
 * `vercel.json` yalnızca bilinen sosyal crawler'ların User-Agent'ını buraya
 * yönlendiriyor; gerçek kullanıcı ve Googlebot her zamanki SPA'yı alıyor.
 *
 * Neden böyle: uygulama bir SPA ve `index.html` statik. Paylaşılan
 * `/report/:id` bağlantısının önizlemesinde bir şey görünmesi için sunucu
 * tarafında meta etiketi üretmek şart. Alternatif — bütün `/report/:id`
 * trafiğini bir fonksiyondan geçirmek — en kritik sayfayı lambda'ya bağlar ve
 * fonksiyon bozulduğunda rapor sayfası hiç açılmaz. Bu yol bozulduğunda ise
 * crawler'lar bugünkü davranışa döner, kullanıcı hiç etkilenmez.
 *
 * BU FONKSİYON HİÇBİR KOŞULDA HATA DÖNDÜRMEZ. Crawler'a giden 5xx, o linkin
 * bir süre yeniden denenmemesine yol açıyor: kullanıcı raporunu paylaşıma
 * açsa bile önizleme ölü kalır. Her yol 200 + geçerli HTML ile biter.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadReport } from "./_lib/report.js";

const SITE_FALLBACK = "https://lensestetik.com";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Mutlak site kökü. Preview deploy'larında da doğru olsun diye istekten türetilir. */
function siteOrigin(req: IncomingMessage): string {
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!host) return process.env.SITE_URL || SITE_FALLBACK;
  const proto = header(req, "x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

interface Meta {
  title: string;
  description: string;
  image: string;
}

function html(meta: Meta, canonical: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lens">
<meta property="og:locale" content="tr_TR">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${esc(meta.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(meta.image)}">
<link rel="canonical" href="${esc(canonical)}">
<meta http-equiv="refresh" content="0; url=${esc(canonical)}">
</head>
<body>
<p><a href="${esc(canonical)}">${esc(meta.title)}</a></p>
</body>
</html>`;
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[]> },
  res: ServerResponse
): Promise<void> {
  const origin = siteOrigin(req);
  let canonical = `${origin}/`;
  let meta: Meta = {
    title: "Lens — Estetik Kimlik",
    description: "Okuduklarından, izlediklerinden ve dinlediklerinden estetik kimliğini çıkarır. Sen hangisisin?",
    image: `${origin}/api/og/lens`,
  };

  try {
    const url = new URL(req.url ?? "/", origin);
    const id = String(req.query?.id ?? url.searchParams.get("id") ?? "");
    canonical = id ? `${origin}/report/${id}` : canonical;

    // Token GEÇİLMİYOR: anon okuma, yani RLS'e göre yalnızca herkese açık
    // raporlar görünür. Rapor özelse aşağıdaki jenerik meta kalır — arketip
    // adı ve özet link önizlemesinden ASLA sızmaz.
    const report = id ? await loadReport(id) : null;

    if (report) {
      const archetype = (report.hero?.archetype ?? "").trim();
      const summary = (report.hero?.summary ?? "").trim();
      if (archetype) {
        meta = {
          title: `${archetype} — Lens Estetik Kimlik`,
          description: summary || meta.description,
          image: `${origin}/api/og/${id}`,
        };
      }
    }
  } catch (err) {
    console.error("[report-preview] jenerik metaya düşülüyor:", err);
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    // Crawler yanıtı kısa yaşasın: rapor paylaşıma açıldığında önizlemenin
    // gerçek postere dönmesi dakikalar sürsün, saatler değil.
    "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
  });
  res.end(html(meta, canonical));
}
