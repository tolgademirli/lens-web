/**
 * satori (JSX ağacı → SVG) + resvg (SVG → PNG).
 *
 * Tek render yolu: hem paylaşım indirmesi hem OG görseli buradan geçiyor.
 * Ayrı iki yol olsaydı font yükleme iki yerde durur ve çıktılar zamanla
 * birbirinden ayrışırdı.
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Report } from "../../src/lib/types.ts";
import { satoriFonts } from "./fonts.ts";
import { genericTree, posterTree, type PosterFormat } from "./poster.ts";

export async function renderPoster(
  report: Report,
  format: PosterFormat,
  /** Çıktı genişliği — thumbnail testi için. Verilmezse formatın kendi boyutu. */
  outputWidth?: number
): Promise<Buffer> {
  const { node, metrics } = posterTree(report, format);
  return toPng(node, metrics.width, metrics.height, outputWidth);
}

export async function renderGeneric(format: PosterFormat): Promise<Buffer> {
  const { node, metrics } = genericTree(format);
  return toPng(node, metrics.width, metrics.height);
}

async function toPng(
  node: unknown,
  width: number,
  height: number,
  outputWidth?: number
): Promise<Buffer> {
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: satoriFonts(),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: outputWidth ?? width },
  });
  return Buffer.from(resvg.render().asPng());
}
