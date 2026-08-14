/**
 * Font glif denetimi — poster fontları Türkçeyi gerçekten taşıyor mu?
 *
 * Şartname madde 10.2/10.3'ün otomatik hali. Bir font değiştirilirse ya da
 * yeni bir ağırlık eklenirse önce bu çalıştırılır: eksik glif poster üzerinde
 * tofu kutusu (□) olarak çıkar ve bunu gözle yakalamak zordur.
 *
 *   node scripts/check-glyphs.mjs
 */
import opentype from "opentype.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FONT_DIR = "api/_assets/fonts";

/** Posterde geçmesi kesin olan Türkçe glifler. Noktasız ı ve büyük İ dahil. */
const TURKISH = "ŞşĞğİıÇçÖöÜüÂâÎîÛû";
/** Tipografik yardımcılar — özet kırpılırken … kullanılıyor. */
const TYPO = "…—’“”";
/**
 * Karşıtlık oku. Fontta OLMAMASI bekleniyor: bu yüzden SVG olarak çiziliyor.
 * Buradaki amaç "eksik" demek değil, varsayımın hâlâ doğru olduğunu görmek.
 */
const ARROW = "⟷";

let failed = false;

for (const file of readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")).sort()) {
  const buf = readFileSync(join(FONT_DIR, file));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  const missingTr = [...TURKISH].filter((ch) => !font.charToGlyphIndex(ch));
  const missingTypo = [...TYPO].filter((ch) => !font.charToGlyphIndex(ch));
  const hasArrow = !!font.charToGlyphIndex(ARROW);

  if (missingTr.length) failed = true;

  console.log(
    file.padEnd(30),
    missingTr.length ? `TR EKSİK → ${missingTr.join(" ")}` : "TR tam ✓",
    "|",
    missingTypo.length ? `tipo eksik → ${missingTypo.join(" ")}` : "tipo tam ✓",
    "|",
    `⟷ ${hasArrow ? "VAR (SVG'ye gerek kalmamış olabilir)" : "yok → SVG ile çiziliyor ✓"}`,
    "|",
    `${font.numGlyphs} glif`
  );
}

if (failed) {
  console.error("\nEN AZ BİR FONTTA TÜRKÇE GLİF EKSİK — bu fontla poster üretilemez.");
  process.exit(1);
}
console.log("\nTüm fontlar Türkçe için uygun.");
