/**
 * GET /api/poster/:reportId?format=story|feed
 *
 * Paylaşılabilir poster. İstemci bunu `<img src>` ile değil `fetch` ile
 * çeker: dönen Blob hem önizlemede hem `navigator.share({files})`'da hem de
 * indirmede kullanılıyor. Tek istek, üç iş — ve JWT'yi query string'e koymak
 * gerekmiyor, `Authorization` başlığı yeterli.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { formatOf } from "../_lib/poster.ts";
import { renderPoster } from "../_lib/render.ts";
import { bearerToken, loadReport } from "../_lib/report.ts";
import { slugify } from "../_lib/text.ts";

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[]> },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reportId = String(req.query?.reportId ?? url.pathname.split("/").pop() ?? "");
    const format = formatOf(req.query?.format ?? url.searchParams.get("format"));

    const report = await loadReport(reportId, bearerToken(req.headers.authorization));
    if (!report) {
      // "yok" ile "yetkin yok" ayrılmıyor: özel bir raporun varlığını
      // doğrulamak da bir sızıntı.
      res.writeHead(404).end();
      return;
    }

    const png = await renderPoster(report, format);
    const name = `lens-${slugify(report.hero?.archetype ?? "")}-${format}.png`;

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": png.length,
      "Content-Disposition": `inline; filename="${name}"`,
      // Herkese açık rapor CDN'de yaşayabilir — rapor üretimden sonra
      // değişmiyor. Özel rapor asla önbelleğe alınmaz: sahibinin token'ıyla
      // üretildi, başkasına servis edilmemeli.
      "Cache-Control": report.is_public
        ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600"
        : "private, no-store",
    });
    res.end(png);
  } catch (err) {
    console.error("[poster] render başarısız:", err);
    res.writeHead(500).end();
  }
}
