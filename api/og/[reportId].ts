/**
 * GET /api/og/:reportId  →  1200×630 link önizleme görseli
 *
 * YETKİSİZ endpoint — anon client ile okur, yani RLS'e göre yalnızca herkese
 * açık raporlar görünür. Rapor özelse (ya da hiç yoksa) JENERİK marka görseli
 * döner: arketip adı, özet, palet, karşıtlık — hiçbiri yazılmaz. Özel rapor
 * içeriği link önizlemesinden sızmamalı.
 *
 * Bu fonksiyon 404 dönmez, çünkü kırık bir og:image ile jenerik bir og:image
 * arasında kullanıcı için fark var: ilki paylaşılan mesajı çirkinleştirir.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { renderGeneric, renderPoster } from "../_lib/render.ts";
import { loadReport } from "../_lib/report.ts";

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[]> },
  res: ServerResponse
): Promise<void> {
  let png: Buffer;
  let isPublicReport = false;

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reportId = String(req.query?.reportId ?? url.pathname.split("/").pop() ?? "");

    // Token GEÇİLMİYOR: bu endpoint'i crawler çağırıyor ve herkese açık
    // olmayan hiçbir şey dönmemeli.
    const report = await loadReport(reportId);

    if (report) {
      png = await renderPoster(report, "og");
      isPublicReport = true;
    } else {
      png = await renderGeneric("og");
    }
  } catch (err) {
    console.error("[og] render başarısız, jenerik görsele düşülüyor:", err);
    try {
      png = await renderGeneric("og");
    } catch {
      res.writeHead(500).end();
      return;
    }
  }

  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": png.length,
    // Jenerik yanıt kısa yaşar: rapor paylaşıma açıldığında önizlemenin
    // gerçek postere dönmesi dakikalar sürsün, saatler değil. Tersi de
    // geçerli — rapor tekrar özel yapıldığında CDN'deki kopya en fazla bu
    // kadar yaşar. (Sosyal platformların KENDİ önbelleği bizim elimizde
    // değil; onlar haftalarca tutabilir.)
    "Cache-Control": isPublicReport
      ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=600"
      : "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
  });
  res.end(png);
}
