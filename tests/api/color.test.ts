import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  derivePosterTheme,
  hexToRgb,
  mix,
  oklchToHex,
  oklchToRgb,
  rgbToHex,
  rgbToOklch,
  type PaletteColor,
} from "../../api/_lib/color.ts";

const palette = (...hexes: string[]): PaletteColor[] => hexes.map((hex, i) => ({ name: `Renk ${i}`, hex }));

const WHITE = { r: 1, g: 1, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };

describe("hex ↔ rgb", () => {
  it("6 ve 3 haneli hex'i okur; # ve boşluk isteğe bağlı", () => {
    expect(hexToRgb("#ffffff")).toEqual(WHITE);
    expect(hexToRgb("000")).toEqual(BLACK);
    expect(hexToRgb(" #F00 ")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb("#1a1a1a").r).toBeCloseTo(26 / 255, 10);
  });

  it.each(["", "zzzzzz", "#12", "#1234567", "kırmızı"])("bozuk hex (%j) nötr griye düşer, patlamaz", (hex) => {
    expect(hexToRgb(hex)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it("rgbToHex taşan kanalları [0,1]'e kırpar", () => {
    expect(rgbToHex({ r: 2, g: -1, b: 0.5 })).toBe("#ff0080");
    expect(rgbToHex(WHITE)).toBe("#ffffff");
  });
});

describe("OKLCH dönüşümü", () => {
  it.each(["#1a1a1a", "#b5532a", "#e8dfc8", "#3366cc", "#00ff88", "#ffffff"])(
    "%s gidiş-dönüşte aynı rengi verir",
    (hex) => {
      expect(oklchToHex(rgbToOklch(hexToRgb(hex)))).toBe(hex);
    },
  );

  it("beyaz L≈1 ve renksiz, siyah L≈0", () => {
    const white = rgbToOklch(WHITE);
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeCloseTo(0, 3);
    expect(rgbToOklch(BLACK).l).toBeCloseTo(0, 5);
  });

  it("hue her zaman 0-360 aralığındadır", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#ff00ff"]) {
      const { h } = rgbToOklch(hexToRgb(hex));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  // Kanalları tek tek kırpmak hue'yu kaydırıyor: taşan mavi mora dönüyordu.
  it("gamut dışı rengi CHROMA azaltarak içeri çeker — hue ve lightness korunur", () => {
    const wild = { l: 0.6, c: 0.4, h: 264 };
    const rgb = oklchToRgb(wild);

    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    const back = rgbToOklch(rgb);
    expect(back.h).toBeCloseTo(wild.h, 0);
    expect(back.l).toBeCloseTo(wild.l, 2);
    expect(back.c).toBeLessThan(wild.c);
  });
});

describe("WCAG kontrastı", () => {
  it("siyah-beyaz 21:1, aynı renk 1:1, sıra fark etmez", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
  });

  it("mix düz alfa karışımıdır", () => {
    expect(mix(WHITE, BLACK, 0)).toEqual(BLACK);
    expect(mix(WHITE, BLACK, 1)).toEqual(WHITE);
    expect(mix(WHITE, BLACK, 0.25)).toEqual({ r: 0.25, g: 0.25, b: 0.25 });
  });
});

describe("derivePosterTheme", () => {
  const palettes: [string, PaletteColor[]][] = [
    ["koyu", palette("#3a3a3a", "#5a5a5a", "#141414")],
    // Doğrudan kullanılsaydı poster okunmaz olurdu — lightness tavanının sebebi.
    ["krem / bej / açık gri", palette("#f5efe0", "#e8dcc4", "#dcdcdc")],
    ["mavi-yeşil", palette("#0e7c86", "#14b8a6", "#38bdf8")],
    ["lavanta", palette("#c4b5fd", "#a78bfa", "#ede9fe")],
    ["doygun kırmızı", palette("#ff0000", "#ff7700", "#ffee00")],
    ["saf beyaz", palette("#ffffff", "#ffffff", "#ffffff")],
  ];

  it.each(palettes)("%s palette: ana metin ≥ 7:1, ikincil metin ≥ 4.5:1", (_name, colors) => {
    const theme = derivePosterTheme(colors);
    expect(theme.measured.text).toBeGreaterThanOrEqual(7);
    expect(theme.measured.muted).toBeGreaterThanOrEqual(4.5);
    // Ölçülen değer gerçekten yazılan renklerin kontrastıdır.
    expect(contrastRatio(hexToRgb(theme.text), hexToRgb(theme.background))).toBeGreaterThanOrEqual(6.9);
  });

  it.each(palettes)("%s palette: arka plan lightness tavanının (L ≤ 0.18) altında kalır", (_name, colors) => {
    const { background } = derivePosterTheme(colors);
    // Hex'e yuvarlama küçük bir sapma katabilir.
    expect(rgbToOklch(hexToRgb(background)).l).toBeLessThanOrEqual(0.19);
  });

  it("çıktı biçimleri: hex renkler ve %22 alfalı ayraç", () => {
    const theme = derivePosterTheme(palettes[2][1]);
    for (const hex of [theme.background, theme.glowTop, theme.glowBottom, theme.text, theme.textMuted]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(theme.rule).toMatch(/^rgba\(\d+, \d+, \d+, 0\.22\)$/);
  });

  it("arka plan paletin 3. renginden, odaklar 1. ve 2. renginden türer", () => {
    const base = derivePosterTheme(palette("#0e7c86", "#14b8a6", "#38bdf8"));
    const other = derivePosterTheme(palette("#0e7c86", "#14b8a6", "#b5532a"));
    expect(other.background).not.toBe(base.background);
    expect(other.glowTop).toBe(base.glowTop);
    expect(other.glowBottom).toBe(base.glowBottom);

    const swapped = derivePosterTheme(palette("#b5532a", "#14b8a6", "#38bdf8"));
    expect(swapped.glowTop).not.toBe(base.glowTop);
    expect(swapped.background).toBe(base.background);
  });

  describe("bozuk palet — `texture.colors` JSONB ve şemada CHECK yok", () => {
    const fallback = derivePosterTheme(undefined);

    it.each([
      ["boş dizi", []],
      ["hepsi bozuk hex", [{ name: "x", hex: "değil" }, { name: "y", hex: "" }]],
      ["hex alanı string değil", [{ name: "x", hex: 42 }, null]],
    ])("%s yedek palete düşer", (_label, colors) => {
      expect(derivePosterTheme(colors as unknown as PaletteColor[])).toEqual(fallback);
    });

    it("3'ten az renkte son rengi tekrar eder, patlamaz", () => {
      const single = derivePosterTheme(palette("#0e7c86"));
      expect(single).toEqual(derivePosterTheme(palette("#0e7c86", "#0e7c86", "#0e7c86")));
    });

    it("bozuk rengi atlar, 3'ten fazlasında ilk üçü kullanır", () => {
      const clean = derivePosterTheme(palette("#0e7c86", "#14b8a6", "#38bdf8"));
      expect(derivePosterTheme(palette("#0e7c86", "bozuk", "#14b8a6", "#38bdf8", "#ffffff"))).toEqual(clean);
    });
  });
});
