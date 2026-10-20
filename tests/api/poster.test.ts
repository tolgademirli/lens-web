import { describe, expect, it } from "vitest";
import type { Node } from "../../api/_lib/h.ts";
import { formatOf, genericTree, posterTree, type PosterFormat } from "../../api/_lib/poster.ts";
import { renderGeneric, renderPoster } from "../../api/_lib/render.ts";
import { pngSize } from "../helpers/http";
import { reportRow } from "../helpers/fixtures";

const FORMATS: PosterFormat[] = ["story", "feed", "og"];
const SIZE: Record<PosterFormat, [number, number]> = {
  story: [1080, 1920],
  feed: [1080, 1350],
  og: [1200, 630],
};

/** Ağaçtaki bütün düğümler (derinlik öncelikli). */
function nodes(root: unknown): Node[] {
  const out: Node[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object" && "props" in value) {
      const node = value as Node;
      out.push(node);
      walk(node.props.children);
    }
  };
  walk(root);
  return out;
}

/** Posterde METİN olarak basılan her şey. */
function texts(root: unknown): string[] {
  return nodes(root)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === "string");
}

const styleOf = (node: Node) => (node.props.style ?? {}) as Record<string, unknown>;

describe("formatOf", () => {
  it("yalnızca 'feed' ve 'og' tanınır; gerisi 'story'", () => {
    expect(formatOf("feed")).toBe("feed");
    expect(formatOf("og")).toBe("og");
    for (const value of ["story", "STORY", "", undefined, null, ["feed"], 3]) {
      expect(formatOf(value)).toBe("story");
    }
  });
});

describe("posterTree", () => {
  const report = reportRow();

  it.each(FORMATS)("%s formatının ölçüleri sabittir", (format) => {
    const { metrics, node } = posterTree(report, format);
    expect([metrics.width, metrics.height]).toEqual(SIZE[format]);
    expect(styleOf(node)).toMatchObject({ width: SIZE[format][0], height: SIZE[format][1] });
  });

  it.each(FORMATS)("%s: iskelet metinleri, iki katmanlı arketip ve özet basılır", (format) => {
    const printed = texts(posterTree(report, format).node);
    expect(printed).toEqual(expect.arrayContaining(["LENS", "ESTETİK KİMLİK", "Lens.", "lensestetik.com", "sen hangisisin?"]));
    expect(printed.join(" ")).toContain("Kadife ceketli");
    expect(printed.join(" ")).toContain("Sokak Filozofu");
    expect(printed.join(" ")).toContain("Salonla sokağı");
  });

  it("karşıtlık etiketleri Türkçe BÜYÜK harfle basılır", () => {
    const printed = texts(posterTree(report, "feed").node);
    expect(printed).toContain("TOZ");
    expect(printed).toContain("IŞIK");
  });

  it("Story'de renk paleti YOK; Feed ve OG'de var", () => {
    expect(texts(posterTree(report, "story").node)).not.toContain("Is Siyahı");
    expect(texts(posterTree(report, "feed").node)).toEqual(expect.arrayContaining(["Is Siyahı", "Pas Turuncusu", "Soluk Krem"]));
    expect(texts(posterTree(report, "og").node)).toContain("Soluk Krem");
  });

  it.each(FORMATS)("%s: hex kodu poster üzerinde ASLA yazılmaz", (format) => {
    for (const printed of texts(posterTree(report, format).node)) {
      expect(printed).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  // ⟷ (U+27F7) fontlarda yok; metin olarak yazılsa tofu kutusu çıkardı.
  it.each(FORMATS)("%s: ok METİN değil, SVG görselidir", (format) => {
    const tree = posterTree(report, format).node;
    expect(texts(tree).join("")).not.toMatch(/[⟷↔→←]/);

    const arrows = nodes(tree).filter((node) => node.type === "img");
    expect(arrows).toHaveLength(1);
    expect(String(arrows[0].props.src)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  // Grain PNG sıkıştırmasını kırıyor (Story 373 KB → 2273 KB); ölçülmüş bir karar.
  it.each(FORMATS)("%s: film grain / SVG filtresi yok", (format) => {
    const serialized = JSON.stringify(posterTree(report, format).node);
    expect(serialized).not.toMatch(/feTurbulence|filter:/i);
  });

  it.each(FORMATS)("%s: hero puntosu sınırlar içinde ve en fazla 2 satırdır", (format) => {
    const long = reportRow({
      hero: {
        archetype: "Kırık Camdan Bakan Nostaljik Mimar",
        archetype_qualifier: "Kırık camdan bakan",
        archetype_core: "Nostaljik Mimar",
        summary: "Özet.",
      },
    } as never);
    const { node, metrics } = posterTree(long, format);
    const heroLines = nodes(node).filter((n) => styleOf(n).fontFamily === "Playfair");

    expect(heroLines.length).toBeGreaterThanOrEqual(1);
    expect(heroLines.length).toBeLessThanOrEqual(metrics.heroLines);
    for (const line of heroLines) {
      expect(styleOf(line).fontSize).toBeGreaterThanOrEqual(metrics.heroMin);
      expect(styleOf(line).fontSize).toBeLessThanOrEqual(metrics.heroMax);
    }
  });

  it("çok uzun özet en fazla 3 satıra iner (kırpma son çare)", () => {
    const summary = "Hem aydının iç hesaplaşmasını hem de toprağın sessiz direncini aynı ciddiyetle izleyen ".repeat(6);
    const report2 = reportRow({ hero: { archetype: "Nostaljik Mimar", summary } } as never);

    for (const format of FORMATS) {
      const { node, metrics } = posterTree(report2, format);
      const summaryLines = nodes(node).filter(
        (n) => styleOf(n).lineHeight === 1.45 && typeof n.props.children === "string",
      );
      expect(summaryLines.length).toBeGreaterThan(0);
      expect(summaryLines.length).toBeLessThanOrEqual(3);
      expect(styleOf(summaryLines[0]).fontSize).toBeLessThanOrEqual(metrics.summarySize);
    }
  });

  it("tema kullanıcının paletinden türer ve okunaklıdır", () => {
    const { theme } = posterTree(report, "story");
    expect(theme.measured.text).toBeGreaterThanOrEqual(7);
    expect(theme.background).not.toBe(posterTree(reportRow({ texture: { colors: [] } } as never), "story").theme.background);
  });

  it.each([
    ["hero yok", { hero: undefined }],
    ["texture yok", { texture: null }],
    ["contrasts dizi değil", { contrasts: "bozuk" }],
    ["her şey eksik", { hero: null, texture: undefined, contrasts: undefined }],
  ])("eksik JSONB (%s) render'ı patlatmaz", (_label, overrides) => {
    for (const format of FORMATS) {
      expect(() => posterTree(reportRow(overrides as never), format)).not.toThrow();
    }
  });
});

describe("genericTree — rapor okunamadığında", () => {
  it.each(FORMATS)("%s: yalnızca marka metni taşır, rapor içeriği SIZMAZ", (format) => {
    const { node, metrics } = genericTree(format);
    const printed = texts(node);

    expect([metrics.width, metrics.height]).toEqual(SIZE[format]);
    expect(printed).toEqual(expect.arrayContaining(["LENS", "Estetik Kimlik", "SEN HANGİSİSİN?"]));
    expect(printed.join(" ")).not.toContain("Filozof");
    expect(nodes(node).filter((n) => n.type === "img")).toHaveLength(0);
  });
});

/**
 * Gerçek render: satori + resvg, lokal fontlarla. Ağ yok (bekçi `fetch`'i
 * yakalardı). Bir unit testten ağır ama poster hattının tamamını — font
 * yükleme, ölçüm, satori'nin kabul ettiği stil — tek seferde sınayan tek yer.
 */
describe("render (PNG)", { timeout: 60_000 }, () => {
  const report = reportRow();

  it.each(FORMATS)("%s formatı doğru boyutta bir PNG üretir", async (format) => {
    const png = await renderPoster(report, format);
    expect(pngSize(png)).toEqual({ width: SIZE[format][0], height: SIZE[format][1] });
  });

  // WhatsApp büyük og:image'ı hiç açmıyor; grain'li sürüm 900 KB'tı, grain'siz 155 KB.
  it("OG görseli link önizlemesinin taşıyabileceği boyutta kalır (< 400 KB)", async () => {
    const png = await renderPoster(report, "og");
    expect(png.byteLength).toBeLessThan(400 * 1024);
  });

  it("Story posteri < 1 MB kalır", async () => {
    const png = await renderPoster(report, "story");
    expect(png.byteLength).toBeLessThan(1024 * 1024);
  });

  it("çıktı genişliği verilirse küçültülmüş PNG döner", async () => {
    const png = await renderPoster(report, "story", 270);
    expect(pngSize(png)).toEqual({ width: 270, height: 480 });
  });

  it("jenerik marka görseli de render edilir", async () => {
    expect(pngSize(await renderGeneric("og"))).toEqual({ width: 1200, height: 630 });
  });

  it("eksik alanlı rapor da render edilir", async () => {
    const png = await renderPoster(reportRow({ hero: { archetype: "Nostaljik Mimar" }, texture: null, contrasts: [] } as never), "feed");
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 });
  });
});
