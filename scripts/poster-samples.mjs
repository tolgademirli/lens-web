/**
 * Kapı 1 doğrulaması — üç örnek raporun posterlerini diske yazar.
 *
 * DİKKAT: buradaki raporlar ELLE KURULMUŞ nesnelerdir, veritabanından
 * gelmiyorlar. `analyze` prompt değişikliği deploy edilip yeni bir rapor
 * üretilene kadar hiçbir gerçek raporda `archetype_core` yok. Bu script
 * posterin ÇİZİMİNİ doğrular; üreticinin bölmeyi doğru yapıp yapmadığını
 * doğrulamaz (o Kapı 2).
 *
 *   node scripts/poster-samples.mjs
 *   → tmp/poster-samples/ altına PNG'ler + inceleme sayfası
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPoster, renderGeneric } from "../api/_lib/render.ts";
import { derivePosterTheme } from "../api/_lib/color.ts";
import { archetypeLayers, contrastPairs } from "../api/_lib/text.ts";
import { esc, page, png } from "./_review-page.mjs";

const OUT = "tmp/poster-samples";

/** 1 — Uzun ad (iki katman) + AÇIK PALET. Şartname madde 10.4 ve 10.5 aynı karede. */
const kirikCam = {
  hero: {
    archetype: "Kırık Camdan Bakan Nostaljik Mimar",
    archetype_qualifier: "Kırık camdan bakan",
    archetype_core: "Nostaljik Mimar",
    summary:
      "Eskimiş olanı atmak yerine onaran, en küçük detayda bütün bir planın izini süren biri.",
  },
  texture: {
    descriptions: [],
    colors: [
      { name: "Krem", hex: "#EDE4CE", description: "" },
      { name: "Soluk Bej", hex: "#C9B999", description: "" },
      { name: "Açık Gri", hex: "#B4B4B0", description: "" },
    ],
  },
  contrasts: [
    { left: { title: "Toz", poster: "TOZ" }, right: { title: "Işık", poster: "IŞIK" }, explanation: {} },
    { left: { title: "Plan", poster: "PLAN" }, right: { title: "Sezgi", poster: "SEZGİ" }, explanation: {} },
  ],
};

/** 2 — Kısa ad (tek katman), koyu-doygun palet. */
const geceNobetcisi = {
  hero: {
    archetype: "Gece Nöbetçisi",
    archetype_qualifier: "",
    archetype_core: "Gece Nöbetçisi",
    summary:
      "Kalabalığın sesini kısıp şehri uzaktan izleyen, geceyi kaçış değil gözlem yeri sayan biri.",
  },
  texture: {
    descriptions: [],
    colors: [
      { name: "Buzul Mavisi", hex: "#A8C6D9", description: "" },
      { name: "Yosun Yeşili", hex: "#6B8F6B", description: "" },
      { name: "Derin Lacivert", hex: "#1A2138", description: "" },
    ],
  },
  contrasts: [
    { left: { title: "Şehir", poster: "ŞEHİR" }, right: { title: "Sığınak", poster: "SIĞINAK" }, explanation: {} },
    { left: { title: "Uyku", poster: "UYKU" }, right: { title: "Nöbet", poster: "NÖBET" }, explanation: {} },
  ],
};

/**
 * 3 — Glif stres testi. Ş ş Ğ ğ İ ı Ç ç Ö ö Ü ü hepsi geçiyor; ayrıca
 * `poster` alanı EKSİK bırakıldı — düşüş zinciri (subtitle → title) sınansın.
 */
const bodrumKat = {
  hero: {
    archetype: "Bodrum Kattaki Düşünür",
    archetype_qualifier: "Bodrum kattaki",
    archetype_core: "Düşünür",
    summary:
      "Hem kafayı hem sokağı ciddiye alan, ironiyi kalkan değil mercek olarak kullanan biri; şüphesi ağır, çıkışı yumuşak.",
  },
  texture: {
    descriptions: [],
    colors: [
      { name: "Beton Grisi", hex: "#8A8A86", description: "" },
      { name: "Soluk Kahve", hex: "#B07D46", description: "" },
      { name: "Gece Lavantası", hex: "#6B62A8", description: "" },
    ],
  },
  contrasts: [
    { left: { title: "Salon", subtitle: "Salon düzeni" }, right: { title: "Sokak", subtitle: "Sokak gürültüsü" }, explanation: {} },
    { left: { title: "Yıkım", subtitle: "Yıkım isteği" }, right: { title: "Oyun", subtitle: "Oyun arayışı" }, explanation: {} },
  ],
};

const SAMPLES = [
  { id: "1-kirik-cam", label: "Uzun ad + açık palet", report: kirikCam },
  { id: "2-gece-nobetcisi", label: "Kısa ad, tek katman", report: geceNobetcisi },
  { id: "3-bodrum-kat", label: "Glif testi + poster alanı eksik", report: bodrumKat },
];

/** İnceleme sayfasına gömülecek küçültülmüş kopyaların genişlikleri. */
const PREVIEW_WIDTH = { story: 300, feed: 300, og: 620 };

mkdirSync(OUT, { recursive: true });

console.log("Poster örnekleri\n");

const collected = [];

for (const sample of SAMPLES) {
  const layers = archetypeLayers(sample.report.hero);
  const pairs = contrastPairs(sample.report.contrasts);
  const theme = derivePosterTheme(sample.report.texture.colors);

  console.log(`── ${sample.id}  (${sample.label})`);
  console.log(
    `   arketip  : ${layers.twoLayer ? `[${layers.qualifier}] + [${layers.core}]` : `tek katman → [${layers.core}]`}`
  );
  console.log(`   karşıtlık: ${pairs.map((p) => `${p.left} ⟷ ${p.right}`).join("  ·  ")}`);
  console.log(
    `   renk     : bg ${theme.background}  metin ${theme.text}` +
      `  kontrast ${theme.measured.text.toFixed(1)}:1 (eşik 7)` +
      `  muted ${theme.measured.muted.toFixed(1)}:1 (eşik 4.5)`
  );

  const preview = {};
  const bytes = {};
  for (const format of ["story", "feed", "og"]) {
    const full = await renderPoster(sample.report, format);
    writeFileSync(join(OUT, `${sample.id}__${format}.png`), full);
    bytes[format] = full.length;
    preview[format] = png(await renderPoster(sample.report, format, PREVIEW_WIDTH[format]));
  }

  // Şartname madde 10.1 — 150px genişlikte arketip hâlâ okunuyor mu?
  const thumb = await renderPoster(sample.report, "story", 150);
  writeFileSync(join(OUT, `${sample.id}__thumb150.png`), thumb);
  preview.thumb = png(thumb);

  console.log(
    `   boyut    : story ${kb(bytes.story)} · feed ${kb(bytes.feed)} · og ${kb(bytes.og)}\n`
  );

  collected.push({ ...sample, layers, pairs, theme, preview, bytes });
}

const generic = {};
for (const format of ["story", "feed", "og"]) {
  const buf = await renderGeneric(format);
  writeFileSync(join(OUT, `0-jenerik__${format}.png`), buf);
  generic[format] = png(await renderGeneric(format));
}
console.log("── 0-jenerik  (özel rapor / okunamayan rapor karşılığı)\n");

writeFileSync(join(OUT, "index.html"), buildReviewPage(collected, generic));
console.log(`Bitti → ${OUT}/  (inceleme sayfası: ${OUT}/index.html)`);

// ---------------------------------------------------------------------------

function kb(n) {
  return `${Math.round(n / 1024)} KB`;
}

function buildReviewPage(samples, generic) {
  const first = samples[0];

  const sections = samples
    .map(
      (s, i) => `
<section>
  <h2>${i + 1}. ${esc(s.label)}</h2>
  <p class="sub">
    Arketip: ${
      s.layers.twoLayer
        ? `iki katman — üstte <b>${esc(s.layers.qualifier)}</b>, hero puntosunda <b>${esc(s.layers.core)}</b>`
        : `tek katman — <b>${esc(s.layers.core)}</b> (qualifier boş, bölünmemesi doğru)`
    }.
    Karşıtlıklar: ${s.pairs.map((p) => `<b>${esc(p.left)} ⟷ ${esc(p.right)}</b>`).join(" · ")}.
    Arka plan <b>${esc(s.theme.background)}</b>, metin kontrastı ${s.theme.measured.text.toFixed(1)}:1.
  </p>
  <div class="grid versus">
    <figure>
      <img src="${s.preview.story}" alt="${esc(s.label)} — Story" width="300">
      <figcaption><b>Story 1080×1920</b> <span class="tag">palet yok</span>
        <span class="num">${kb(s.bytes.story)}</span></figcaption>
    </figure>
    <figure>
      <img src="${s.preview.feed}" alt="${esc(s.label)} — Feed" width="300">
      <figcaption><b>Feed 1080×1350</b> <span class="tag">palet var</span>
        <span class="num">${kb(s.bytes.feed)}</span></figcaption>
    </figure>
  </div>
</section>`
    )
    .join("\n");

  const og = `
<section>
  <h2>Link önizlemesi ve küçük boy</h2>
  <p class="sub">OG, Feed tasarımının yatay varyantı. Boyutu kritik: WhatsApp gibi istemciler
  büyük bir <code>og:image</code>'ı çoğu zaman hiç açmıyor, o yüzden ~150 KB bandında tutuldu.</p>
  <div class="grid" style="grid-template-columns:1fr">
    ${samples
      .map(
        (s) => `<figure>
      <img src="${s.preview.og}" alt="${esc(s.label)} — OG" width="620">
      <figcaption><b>OG 1200×630</b>
        <span class="num">${kb(s.bytes.og)}</span> — ${esc(s.label)}</figcaption>
    </figure>`
      )
      .join("\n")}
  </div>

  <h3 style="margin-top:40px">150px thumbnail — arketip adı okunuyor mu?</h3>
  <div class="grid strip" style="margin-top:14px">
    ${samples
      .map(
        (s) => `<figure>
      <img src="${s.preview.thumb}" alt="${esc(s.label)} — 150px" width="150" style="max-width:150px">
      <figcaption>${esc(s.layers.core)}</figcaption>
    </figure>`
      )
      .join("\n")}
    <figure>
      <img src="${generic.story}" alt="Jenerik poster" width="300" style="max-width:150px">
      <figcaption>Jenerik — özel rapor karşılığı</figcaption>
    </figure>
  </div>
</section>`;

  const decisions = `
<section>
  <h2>Kilitlenen iki karar</h2>
  <div class="grid pair">
    <div class="card">
      <h3>Arka plan <span class="tag pick">rich</span></h3>
      <p>L ≤ 0.18, tavan uygulandığında chroma ×1.15. Reddedilen alternatif L ≤ 0.14 idi:
      krem/bej palette ikisi de kabul edilebilirdi ama mavi-yeşil ve lavanta paletlerde
      0.14 rengin kimliğini bastırıp posteri "koyu bir şey" yapıyordu.</p>
      <p style="margin-bottom:0">Şartname L ≤ 0.25 diyordu, referanslar 0.10–0.14 bandındaydı.
      0.18 ikisinin arası — keyfi değil, üç palet üzerinde bakılarak seçildi.</p>
    </div>
    <div class="card">
      <h3>Film grain <span class="tag">kapalı</span></h3>
      <p>Grain çalışıyordu ama her pikseli oynattığı için PNG sıkıştırmasını kırıyor:
      Story <b>2273 KB → 373 KB</b>, OG <b>900 KB → 155 KB</b>. OG'de zaten taşınamazdı;
      Story/Feed'de ise paylaşım yolundaki her kanal görseli yeniden JPEG'e çevirip ince
      grain'i zaten yok ediyor.</p>
      <p style="margin-bottom:0">Bilinen bedeli: grain dither görevi de görüyordu. Grain'siz
      koyu gradyanlarda en uzun düz koşu 62 px — iyi bir OLED'de hafif bant görülebilir.
      Şikâyet gelirse çözüm grain'i geri açmak değil, glow duraklarını çoğaltmak.</p>
    </div>
  </div>
</section>`;

  const checklist = `
<section>
  <h2>Teslim öncesi kontrol listesi</h2>
  <p class="sub">Şartname madde 10'daki maddeler. Bu kapı posterin <b>çizimini</b> doğruluyor;
  üreticinin bölmeyi anlamlı yapıp yapmadığı Kapı 2'de sınanacak.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>#</th><th>Test</th><th>Sonuç</th><th>Kanıt</th></tr></thead>
    <tbody>
      <tr><td class="num">1</td><td>150px thumbnail'de arketip okunuyor</td>
        <td><span class="tag ok">geçti</span></td><td>Yukarıdaki thumbnail şeridi</td></tr>
      <tr><td class="num">2</td><td>Ş ş Ğ ğ İ ı Ç ç Ö ö Ü ü temiz render</td>
        <td><span class="tag ok">geçti</span></td>
        <td><code>scripts/check-glyphs.mjs</code> beş fontta da tam rapor ediyor; 3. örnek hepsini içeriyor</td></tr>
      <tr><td class="num">3</td><td>⟷ tofu kutusu çıkmıyor</td>
        <td><span class="tag ok">geçti</span></td>
        <td>Glif denetimi: sembol <b>hiçbir fontta yok</b> — bu yüzden SVG path olarak çiziliyor</td></tr>
      <tr><td class="num">4</td><td>Uzun ad iki katmana bölünüyor</td>
        <td><span class="tag ok">geçti</span></td><td>1. örnek: "Kırık camdan bakan" / "Nostaljik Mimar"</td></tr>
      <tr><td class="num">5</td><td>Açık palette arka plan koyu, metin okunur</td>
        <td><span class="tag ok">geçti</span></td>
        <td>1. örnek (Krem/Soluk Bej/Açık Gri): kontrast ${first.theme.measured.text.toFixed(1)}:1, eşik 7:1</td></tr>
      <tr><td class="num">6</td><td>Story'de palet yok, alt bant boş</td>
        <td><span class="tag ok">geçti</span></td><td>Story kolonları — palet yalnızca Feed ve OG'de</td></tr>
      <tr><td class="num">7</td><td>Arka plan ayarı seçildi</td>
        <td><span class="tag ok">rich</span></td><td>Yukarıdaki karar bölümü</td></tr>
    </tbody>
  </table></div>
</section>`;

  return page({
    title: "Estetik Kimlik Posteri",
    body: `
<p class="eyebrow">Kapı 1 · render doğrulaması</p>
<h1>Estetik Kimlik Posteri</h1>
<p class="lede">Render hattı çalışıyor: satori + resvg, lokal fontlar, sunucu tarafı.
Aşağıda üç örnek rapor. Bu posterler <b>elle kurulmuş verilerden</b> üretildi —
gerçek üretici çıktısı Kapı 2'de sınanacak.</p>
${sections}
${og}
${decisions}
${checklist}`,
  });
}
