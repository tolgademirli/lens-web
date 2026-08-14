/**
 * Font yükleme ve metin ölçümü.
 *
 * Fontlar SUNUCUDA LOKAL dosyadan okunur, CDN'den değil: runtime'da ağ isteği
 * render'ı kaydırır ve bir gün yavaşlarsa poster geç gelir ya da hiç gelmez.
 * Dosyalar `api/_assets/fonts/` altında, Vercel'e `includeFiles` ile taşınıyor.
 *
 * Ölçüm satori'nin işi değil — satori metni yerleştirir ama kaç satır olduğunu
 * geri söylemez. Hero puntosunu binary search ile bulabilmek için genişliği
 * önceden bilmek gerekiyor, o yüzden aynı TTF opentype.js ile ikinci kez
 * ayrıştırılıyor.
 */
import opentype from "opentype.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type FontId =
  | "playfair-italic-700"
  | "inter-400"
  | "inter-500"
  | "inter-600";

const FILES: Record<FontId, string> = {
  "playfair-italic-700": "PlayfairDisplay-Italic-700.ttf",
  "inter-400": "Inter-Regular.ttf",
  "inter-500": "Inter-Medium.ttf",
  "inter-600": "Inter-SemiBold.ttf",
};

/**
 * `new URL(..., import.meta.url)` biçimi kasıtlı: Vercel'in dosya izleyicisi
 * bu kalıbı tanıyıp asset'i lambda'ya dahil ediyor. Düz string birleştirme
 * lokalde çalışır, production'da ENOENT verir.
 */
function fontPath(file: string): string {
  return fileURLToPath(new URL(`../_assets/fonts/${file}`, import.meta.url));
}

const bufferCache = new Map<FontId, Buffer>();
const parsedCache = new Map<FontId, opentype.Font>();

export function fontBuffer(id: FontId): Buffer {
  let buf = bufferCache.get(id);
  if (!buf) {
    buf = readFileSync(fontPath(FILES[id]));
    bufferCache.set(id, buf);
  }
  return buf;
}

function parsed(id: FontId): opentype.Font {
  let font = parsedCache.get(id);
  if (!font) {
    const buf = fontBuffer(id);
    font = opentype.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    parsedCache.set(id, font);
  }
  return font;
}

/** satori'nin beklediği font tanımları. Aile adları poster stillerinde geçiyor. */
export function satoriFonts() {
  return [
    { name: "Playfair", data: fontBuffer("playfair-italic-700"), weight: 700 as const, style: "italic" as const },
    { name: "Inter", data: fontBuffer("inter-400"), weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: fontBuffer("inter-500"), weight: 500 as const, style: "normal" as const },
    { name: "Inter", data: fontBuffer("inter-600"), weight: 600 as const, style: "normal" as const },
  ];
}

/**
 * Metnin verilen puntodaki genişliği (px). Kerning dahil.
 *
 * `font.getAdvanceWidth()` KULLANILMIYOR: opentype.js 2.x onu shaping
 * hattından (Bidi → GSUB) geçiriyor ve Inter'in bir substitution tablosunda
 * "lookupType 6 substFormat 2 is not yet supported" diye patlıyor. Bize
 * shaping değil yalnızca genişlik lazım, o yüzden glif ilerlemeleri doğrudan
 * toplanıyor — hem çalışıyor hem daha hızlı.
 */
export function measure(text: string, id: FontId, size: number, letterSpacing = 0): number {
  if (!text) return 0;
  const font = parsed(id);
  const scale = size / font.unitsPerEm;

  let units = 0;
  let prev: opentype.Glyph | null = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) units += font.getKerningValue(prev, glyph);
    units += glyph.advanceWidth ?? 0;
    prev = glyph;
  }

  // Harf aralığı font metriğinde yok; satori her karakterden SONRA ekliyor.
  return units * scale + letterSpacing * text.length;
}

/**
 * Açgözlü satır bölme. Tek bir kelime bile sığmıyorsa o kelime kendi satırında
 * kalır (kelime ortasından bölmek Türkçede okunaksız oluyor) — çağıran taraf
 * puntoyu küçültmeye devam eder.
 */
export function wrapText(
  text: string,
  id: FontId,
  size: number,
  maxWidth: number,
  letterSpacing = 0
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measure(candidate, id, size, letterSpacing) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export interface FitResult {
  size: number;
  lines: string[];
}

/**
 * Metni kutuya sığdıran en büyük puntoyu binary search ile bulur.
 *
 * "Sığdı" = satır sayısı maxLines'ı aşmıyor VE en uzun satır maxWidth'i
 * aşmıyor. Alt sınıra kadar inip hâlâ sığmıyorsa alt sınır döner ve satırlar
 * o puntoda hesaplanır — çağıran taraf gerekirse kırpar.
 */
export function fitText(
  text: string,
  id: FontId,
  opts: {
    maxWidth: number;
    maxLines: number;
    min: number;
    max: number;
    letterSpacing?: number;
  }
): FitResult {
  const { maxWidth, maxLines, min, max, letterSpacing = 0 } = opts;

  const fits = (size: number): boolean => {
    const lines = wrapText(text, id, size, maxWidth, letterSpacing);
    if (lines.length > maxLines) return false;
    return lines.every((l) => measure(l, id, size, letterSpacing) <= maxWidth);
  };

  let lo = min;
  let hi = max;
  if (fits(hi)) lo = hi;
  else {
    // 0.5px çözünürlük yeterli — daha ince arama görünür fark yaratmıyor.
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  }

  const size = Math.floor(lo);
  return { size, lines: wrapText(text, id, size, maxWidth, letterSpacing) };
}
