/**
 * Kapı 1 / Kapı 2 inceleme sayfası üreticisi.
 *
 * Posterleri küçültülmüş kopyalarla tek bir HTML'e gömer, böylece karar
 * verirken 27 ayrı PNG açmak gerekmez. Sayfa, değerlendirilen fontların
 * kendisiyle diziliyor (aynı TTF dosyaları data URI olarak gömülü) — kâğıt
 * üstünde göreceğin harfler posterdekilerle aynı.
 */
import { readFileSync } from "node:fs";

const FONT_DIR = "api/_assets/fonts";

function dataFont(file) {
  return `data:font/ttf;base64,${readFileSync(`${FONT_DIR}/${file}`).toString("base64")}`;
}

export function png(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const STYLE = `
@font-face{font-family:"Playfair Review";src:url("${dataFont("PlayfairDisplay-Italic-700.ttf")}") format("truetype");font-weight:700;font-style:italic;font-display:block}
@font-face{font-family:"Inter Review";src:url("${dataFont("Inter-Regular.ttf")}") format("truetype");font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:"Inter Review";src:url("${dataFont("Inter-SemiBold.ttf")}") format("truetype");font-weight:600;font-style:normal;font-display:block}

/* Sayfa sessiz kalır, rengi posterler taşır. Nötrler nötr değil: Lens'in
   kendi sıcak-koyu dünyasına doğru hafifçe eğik. */
:root{
  --paper:#FBFAF7; --panel:#F3F1EC; --ink:#1A1815; --muted:#6D685E;
  --rule:#E2DDD3; --accent:#8A6A2F; --ok:#3D6B47; --warn:#8A5A20;
  --shadow:0 1px 2px rgba(26,24,21,.06),0 12px 32px rgba(26,24,21,.10);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --paper:#121110; --panel:#1B1A17; --ink:#EDE7D9; --muted:#948D80;
    --rule:#2C2A26; --accent:#C9A35C; --ok:#7FA98A; --warn:#C79A55;
    --shadow:0 1px 2px rgba(0,0,0,.5),0 16px 40px rgba(0,0,0,.45);
  }
}
:root[data-theme="dark"]{
  --paper:#121110; --panel:#1B1A17; --ink:#EDE7D9; --muted:#948D80;
  --rule:#2C2A26; --accent:#C9A35C; --ok:#7FA98A; --warn:#C79A55;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 16px 40px rgba(0,0,0,.45);
}

*{box-sizing:border-box}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:"Inter Review",system-ui,sans-serif;font-size:16px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1160px;margin:0 auto;padding:64px 28px 120px}
.eyebrow{
  font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;
  color:var(--accent);margin:0 0 14px;
}
h1{
  font-family:"Playfair Review",Georgia,serif;font-style:italic;font-weight:700;
  font-size:clamp(38px,6vw,64px);line-height:1.02;margin:0 0 18px;text-wrap:balance;
}
h2{
  font-family:"Playfair Review",Georgia,serif;font-style:italic;font-weight:700;
  font-size:clamp(26px,3.4vw,36px);line-height:1.1;margin:0 0 6px;text-wrap:balance;
}
h3{font-size:15px;font-weight:600;letter-spacing:.02em;margin:0 0 4px}
p{margin:0 0 14px;max-width:66ch}
.lede{font-size:18px;color:var(--muted);max-width:64ch}
section{margin-top:72px;padding-top:40px;border-top:1px solid var(--rule)}
section:first-of-type{border-top:0}
.sub{color:var(--muted);font-size:14px;margin:0 0 26px;max-width:70ch}

.grid{display:grid;gap:26px}
.pair{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
/* Karşılaştırma tam olarak iki kolon: deep solda, rich sağda. auto-fit
   burada yanlıştı — geniş ekranda üçe sarıp çiftleri birbirine karıştırıyordu. */
.versus{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.rowlabel{
  grid-column:1/-1;display:flex;align-items:baseline;gap:10px;margin:6px 0 -10px;
  font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);
}
.rowlabel::after{content:"";flex:1;height:1px;background:var(--rule)}
.strip{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:start}

figure{margin:0;display:flex;flex-direction:column;gap:10px}
figure img{
  width:100%;height:auto;display:block;border-radius:8px;
  box-shadow:var(--shadow);background:var(--panel);
}
figcaption{display:flex;align-items:baseline;gap:10px;font-size:13px;color:var(--muted)}
figcaption b{color:var(--ink);font-weight:600}

.tag{
  display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  border:1px solid var(--rule);color:var(--muted);white-space:nowrap;
}
.tag.pick{border-color:var(--accent);color:var(--accent)}
.tag.ok{border-color:var(--ok);color:var(--ok)}

.card{
  background:var(--panel);border:1px solid var(--rule);border-radius:12px;
  padding:22px 24px;
}
.card h3{margin-bottom:8px}
.card p:last-child{margin-bottom:0}

.swatches{display:flex;gap:8px;margin:12px 0 4px}
.swatches i{width:34px;height:34px;border-radius:6px;border:1px solid var(--rule);display:block}

.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:640px;font-size:14px}
th,td{text-align:left;padding:13px 16px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted)}
code{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;
  background:var(--panel);border:1px solid var(--rule);border-radius:5px;padding:1px 5px;
}
:where(a):focus-visible,:where(summary):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.note{border-left:3px solid var(--accent);padding:2px 0 2px 18px;margin:22px 0;color:var(--muted)}
.note b{color:var(--ink)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export function page({ title, body }) {
  // charset İLK satırda olmak zorunda: tarayıcı kodlamayı belgenin ilk 1024
  // baytında arıyor ve altta gömülü fontlar yüzünden <style> bloğu devasa.
  // Olmazsa dosya yerelden açıldığında windows-1252 sanılıyor ve bütün Türkçe
  // metin "KAPÄ± 1" gibi çıkıyor.
  return `<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<div class="wrap">
${body}
</div>`;
}
