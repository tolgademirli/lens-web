import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { fitText, fontBuffer, measure, satoriFonts, wrapText, type FontId } from "../../api/_lib/fonts.ts";

const FONTS: FontId[] = ["playfair-italic-700", "inter-400", "inter-500", "inter-600"];

function parse(id: FontId) {
  const buf = fontBuffer(id);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("font dosyaları", () => {
  it("dört font da LOKAL dosyadan yüklenir (ağ isteği yok)", () => {
    for (const id of FONTS) expect(fontBuffer(id).byteLength).toBeGreaterThan(10_000);
  });

  it("satori'ye poster stillerindeki aile adlarıyla verilir", () => {
    expect(satoriFonts().map((f) => [f.name, f.weight, f.style])).toEqual([
      ["Playfair", 700, "italic"],
      ["Inter", 400, "normal"],
      ["Inter", 500, "normal"],
      ["Inter", 600, "normal"],
    ]);
  });

  // Glif yoksa posterde tofu kutusu (□) çıkar.
  it.each(FONTS)("%s Türkçe harflerin tamamını taşır", (id) => {
    const font = parse(id);
    for (const ch of "ıİşŞğĞüÜöÖçÇâîû") {
      expect(font.charToGlyphIndex(ch), `${id} içinde '${ch}' yok`).toBeGreaterThan(0);
    }
  });

  // Bu yüzden karşıtlık oku metin değil SVG path olarak çiziliyor.
  it("⟷ (U+27F7) hiçbir fontta YOK", () => {
    for (const id of FONTS) expect(parse(id).charToGlyphIndex("⟷")).toBe(0);
  });
});

describe("measure", () => {
  it("boş metin 0'dır", () => {
    expect(measure("", "inter-400", 40)).toBe(0);
  });

  it("puntoyla doğrusal ölçeklenir", () => {
    const at20 = measure("Sokak Filozofu", "playfair-italic-700", 20);
    expect(at20).toBeGreaterThan(0);
    expect(measure("Sokak Filozofu", "playfair-italic-700", 40)).toBeCloseTo(at20 * 2, 5);
  });

  it("harf aralığı her karakterden sonra eklenir", () => {
    const plain = measure("TOZ", "inter-500", 30);
    expect(measure("TOZ", "inter-500", 30, 10)).toBeCloseTo(plain + 30, 5);
  });

  it("uzun metin daha geniştir; Türkçe harfler ölçülebilir", () => {
    expect(measure("ışık çığlığı", "inter-400", 30)).toBeGreaterThan(measure("ışık", "inter-400", 30));
  });
});

describe("wrapText", () => {
  const sentence = "Salonla sokağı aynı cümlede buluşturan merakı ciddiyetinden büyük biri";

  it("boş ya da yalnızca boşluk olan metin satır üretmez", () => {
    expect(wrapText("", "inter-400", 30, 500)).toEqual([]);
    expect(wrapText("   \n ", "inter-400", 30, 500)).toEqual([]);
  });

  it("satırlar genişliği aşmaz ve kelimeler sırasıyla korunur", () => {
    const lines = wrapText(sentence, "inter-400", 36, 600);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, "inter-400", 36)).toBeLessThanOrEqual(600);
    expect(lines.join(" ")).toBe(sentence);
  });

  it("yeterince geniş kutuda tek satır kalır", () => {
    expect(wrapText(sentence, "inter-400", 20, 5000)).toEqual([sentence]);
  });

  it("tek kelime sığmasa bile ORTASINDAN bölünmez", () => {
    expect(wrapText("Varoluşçusu", "playfair-italic-700", 200, 100)).toEqual(["Varoluşçusu"]);
  });

  it("fazla boşlukları tek ayraca indirir", () => {
    expect(wrapText("Gece   Vardiyası\nVaroluşçusu", "inter-400", 20, 5000)).toEqual(["Gece Vardiyası Varoluşçusu"]);
  });
});

describe("fitText", () => {
  const box = { maxWidth: 918, maxLines: 2, min: 78, max: 190 };

  it("kısa metin en büyük puntoyu alır", () => {
    const fit = fitText("Lens", "playfair-italic-700", box);
    expect(fit).toEqual({ size: 190, lines: ["Lens"] });
  });

  it("uzun metinde punto küçülür: satır sayısı ve genişlik sınırda kalır", () => {
    const fit = fitText("Kırık Camdan Bakan Nostaljik Mimar", "playfair-italic-700", box);
    expect(fit.size).toBeLessThan(190);
    expect(fit.size).toBeGreaterThanOrEqual(78);
    expect(Number.isInteger(fit.size)).toBe(true);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    for (const line of fit.lines) {
      expect(measure(line, "playfair-italic-700", fit.size)).toBeLessThanOrEqual(918);
    }
  });

  it("alt sınırda bile sığmayan metinde alt sınır döner (çağıran kırpar)", () => {
    const fit = fitText("çok ".repeat(60).trim(), "playfair-italic-700", box);
    expect(fit.size).toBe(78);
    expect(fit.lines.length).toBeGreaterThan(2);
  });
});
