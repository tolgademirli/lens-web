/**
 * Poster renk sistemi.
 *
 * Arka plan kullanıcının kendi paletinden türetilir — poster her kullanıcıda
 * farklı görünmeli, yoksa feed'de "bir tane daha" hissi verir. Ama palet
 * doğrudan kullanılamaz: "Krem / Soluk Bej / Açık Gri" paletine sahip bir
 * kullanıcıda poster okunmaz olurdu.
 *
 * Çözüm hex'i elle karartmak değil, OKLCH'e çevirip lightness'a tavan koymak.
 * Hue korunur, chroma tavan uygulanırken hafifçe artırılır: koyu kalır ama
 * rengin kimliği hissedilir. sRGB'de karartmak hue kaymasına yol açıyor
 * (özellikle mavilerde) ve paletin karakterini bozuyor.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/**
 * Arka plan lightness tavanı (OKLCH L) ve tavan uygulandığında chroma'nın
 * çarpanı.
 *
 * Kapı 1'de iki ayar üç palet üzerinde karşılaştırıldı ve bu seçildi.
 * Reddedilen alternatif `L ≤ 0.14, chroma ×1.0` idi: krem/bej palette ikisi de
 * kabul edilebilir çıkıyordu ama mavi-yeşil ve lavanta paletlerde 0.14 rengin
 * kimliğini bastırıyor, poster "koyu bir şey" oluyordu. Lightness'ı biraz
 * bırakıp chroma'yı telafi etmek referansın koyuluğunu koruyup paleti
 * hissettiriyor.
 *
 * Şartname L ≤ 0.25 diyordu; referans posterler 0.10-0.14 bandındaydı. 0.18
 * ikisinin arası, keyfi değil ölçülerek seçildi.
 */
const BG_LIGHTNESS_CAP = 0.18;
const BG_CHROMA_BOOST = 1.15;

// ---------------------------------------------------------------------------
// sRGB ↔ OKLab/OKLCH  (Björn Ottosson, https://bottosson.github.io/posts/oklab/)
// ---------------------------------------------------------------------------

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 };
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  return {
    r: linearToSrgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: linearToSrgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: linearToSrgb(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  };
}

function inGamut({ r, g, b }: Rgb): boolean {
  const ok = (v: number) => v >= -0.0001 && v <= 1.0001;
  return ok(r) && ok(g) && ok(b);
}

/**
 * OKLCH → sRGB, gamut dışına taşarsa **chroma azaltılarak** içeri çekilir.
 *
 * Kanalları tek tek clamp etmek kolay ama hue'yu kaydırıyor: taşan bir mavi,
 * clamp sonrası mora dönüyor. Chroma'yı kısmak lightness ve hue'yu korur —
 * renk soluklaşır ama aynı renk kalır.
 */
export function oklchToRgb(color: Oklch): Rgb {
  let raw = oklchToRgbRaw(color);
  if (inGamut(raw)) return clampRgb(raw);

  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    raw = oklchToRgbRaw({ ...color, c: mid });
    if (inGamut(raw)) lo = mid;
    else hi = mid;
  }
  return clampRgb(oklchToRgbRaw({ ...color, c: lo }));
}

function clampRgb({ r, g, b }: Rgb): Rgb {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { r: c(r), g: c(g), b: c(b) };
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

// ---------------------------------------------------------------------------
// WCAG kontrast
// ---------------------------------------------------------------------------

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/** WCAG kontrast oranı (1–21). Şartname hero/gövde metni için ≥ 7 istiyor. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** İki rengi düz alfa ile karıştırır — "muted" tonların gerçek rengini bulmak için. */
export function mix(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

// ---------------------------------------------------------------------------
// Poster teması
// ---------------------------------------------------------------------------

export interface PaletteColor {
  name: string;
  hex: string;
}

export interface PosterTheme {
  /** Düz arka plan rengi (glow'lar bunun üstüne biner). */
  background: string;
  /** Diyagonal odaklar: sağ-üst ve sol-alt. */
  glowTop: string;
  glowBottom: string;
  /** Ana metin — arka plana karşı ≥ 7:1. */
  text: string;
  /** İkincil metin (özet, etiketler) — ≥ 4.5:1. */
  textMuted: string;
  /** Ayraç çizgileri ve ok. */
  rule: string;
  /** Ölçülen gerçek kontrast oranları — doğrulama çıktısında basılır. */
  measured: { text: number; muted: number };
}

const FALLBACK_PALETTE: PaletteColor[] = [
  { name: "Is", hex: "#3a3a3a" },
  { name: "Kül", hex: "#5a5a5a" },
  { name: "Gece", hex: "#141414" },
];

/**
 * Paleti poster temasına indirir.
 *
 * `texture.colors` JSONB ve şemada CHECK yok — 3'ten az renk gelirse ya da
 * hex bozuksa render patlamamalı, bu yüzden her adımda düşüş yolu var.
 */
export function derivePosterTheme(palette: PaletteColor[] | undefined): PosterTheme {
  const colors = normalizePalette(palette);

  // Baz: palette[2]. Tavana çekilirken chroma hafif artar.
  const baseLch = rgbToOklch(hexToRgb(colors[2].hex));
  const capped = Math.min(baseLch.l, BG_LIGHTNESS_CAP);
  const boost = capped < baseLch.l ? BG_CHROMA_BOOST : 1;
  const bgLch: Oklch = { l: capped, c: baseLch.c * boost, h: baseLch.h };
  const bgRgb = oklchToRgb(bgLch);

  // Odaklar: aynı hue, daha yüksek chroma, hâlâ koyu. Glow'lar arka planın
  // üstüne düşük alfayla bineceği için burada biraz daha açık tutuluyorlar.
  const glow = (hex: string): string => {
    const lch = rgbToOklch(hexToRgb(hex));
    return oklchToHex({
      l: Math.min(lch.l, 0.32),
      c: Math.max(lch.c, 0.04) * 1.25,
      h: lch.h,
    });
  };

  // Metin: paletin en açık renginden türetilmiş kremimsi ton. Chroma neredeyse
  // sıfıra çekilir (rengin sıcaklığı kalsın ama metin renkli görünmesin).
  const lightest = colors
    .map((c) => rgbToOklch(hexToRgb(c.hex)))
    .reduce((a, b) => (a.l >= b.l ? a : b));

  const text = raiseUntilContrast({ l: 0.93, c: Math.min(lightest.c, 0.02), h: lightest.h }, bgRgb, 7);
  const muted = raiseUntilContrast({ l: 0.74, c: Math.min(lightest.c, 0.015), h: lightest.h }, bgRgb, 4.5);

  return {
    background: rgbToHex(bgRgb),
    glowTop: glow(colors[0].hex),
    glowBottom: glow(colors[1].hex),
    text: rgbToHex(text),
    textMuted: rgbToHex(muted),
    rule: `rgba(${Math.round(text.r * 255)}, ${Math.round(text.g * 255)}, ${Math.round(text.b * 255)}, 0.22)`,
    measured: {
      text: contrastRatio(text, bgRgb),
      muted: contrastRatio(muted, bgRgb),
    },
  };
}

/**
 * Hedef kontrasta ulaşana kadar lightness'ı artırır.
 *
 * Arka plan zaten L ≤ 0.18'e çekildiği için bu döngü pratikte ilk denemede
 * çıkıyor; yine de duruyor çünkü tavan bir gün gevşetilirse sessizce
 * okunaksız metin üretmesin.
 */
function raiseUntilContrast(start: Oklch, bg: Rgb, target: number): Rgb {
  let lch = { ...start };
  for (let i = 0; i < 24; i++) {
    const rgb = oklchToRgb(lch);
    if (contrastRatio(rgb, bg) >= target) return rgb;
    if (lch.l >= 1) break;
    lch = { ...lch, l: Math.min(1, lch.l + 0.02), c: lch.c * 0.9 };
  }
  return { r: 1, g: 1, b: 1 };
}

function normalizePalette(palette: PaletteColor[] | undefined): PaletteColor[] {
  const valid = (palette ?? []).filter(
    (c) => c && typeof c.hex === "string" && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.hex.trim())
  );
  if (valid.length === 0) return FALLBACK_PALETTE;
  const out = valid.slice(0, 3);
  while (out.length < 3) out.push(out[out.length - 1]);
  return out;
}
