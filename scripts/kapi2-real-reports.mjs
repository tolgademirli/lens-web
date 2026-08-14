/**
 * Kapı 2 — GERÇEK üretici çıktısıyla doğrulama.
 *
 * Kapı 1'in örnekleri elle kurulmuş nesnelerdi; posterin çizimini doğruluyordu
 * ama üreticinin arketibi anlamlı bölüp bölmediğini doğrulamıyordu. Bu script
 * lokal `analyze` fonksiyonunu GERÇEK Anthropic çağrısıyla birkaç farklı sinyal
 * setiyle çalıştırır ve dönen `hero`/`contrasts` alanlarına bakar.
 *
 * Gerekenler: `npx supabase start` çalışıyor olmalı ve `supabase/functions/.env`
 * içinde `ANTHROPIC_API_KEY` dolu olmalı. Her rapor gerçek kredi harcar.
 *
 *   node scripts/kapi2-real-reports.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPoster } from "../api/_lib/render.ts";
import { derivePosterTheme } from "../api/_lib/color.ts";
import { archetypeLayers, contrastPairs } from "../api/_lib/text.ts";
import { esc, page, png } from "./_review-page.mjs";

const API = "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const OUT = "tmp/kapi2";

const w = (title, creator) => ({ title, creator, source: "manual", workId: null });

/**
 * Dört farklı zevk profili. Amaç bölmeyi zorlamak: bazısının uzun ve
 * niteleyicili, bazısının tek parça bir arketip üretmesi bekleniyor.
 */
const PROFILES = [
  {
    id: "1-kentli-karanlik",
    label: "Kentli, karanlık, ironik",
    books: [w("Sıfır Noktasındaki Kadın", "Nawal El Saadawi"), w("Yeraltından Notlar", "Dostoyevski"), w("Şehrin Aynaları", "Nedim Gürsel")],
    movies: [w("Taxi Driver", "Martin Scorsese"), w("Fight Club", "David Fincher"), w("Uzak", "Nuri Bilge Ceylan")],
    music: [w("Unknown Pleasures", "Joy Division"), w("Kesmeşeker", "Kesmeşeker")],
  },
  {
    id: "2-kirsal-sicak",
    label: "Kırsal, sıcak, yavaş",
    books: [w("Yer Demir Gök Bakır", "Yaşar Kemal"), w("Bir Bilim Adamının Romanı", "Oğuz Atay")],
    movies: [w("Bal", "Semih Kaplanoğlu"), w("Le Quattro Volte", "Michelangelo Frammartino"), w("Kaplumbağalar da Uçar", "Bahman Ghobadi")],
    music: [w("Muhabbet Kuşu", "Selda Bağcan"), w("Anadolu Ezgileri", "Neşet Ertaş"), w("Pink Moon", "Nick Drake")],
  },
  {
    id: "3-sistem-bilim",
    label: "Sistemci, bilimkurgu, soğuk",
    books: [w("Solaris", "Stanisław Lem"), w("Vakıf", "Isaac Asimov"), w("Karanlığın Sol Eli", "Ursula K. Le Guin")],
    movies: [w("Blade Runner 2049", "Denis Villeneuve"), w("Stalker", "Andrei Tarkovsky")],
    music: [w("Selected Ambient Works", "Aphex Twin"), w("Music for Airports", "Brian Eno")],
  },
  {
    id: "4-romantik-melankolik",
    label: "Romantik, melankolik, edebi",
    books: [w("Masumiyet Müzesi", "Orhan Pamuk"), w("Huzur", "Ahmet Hamdi Tanpınar"), w("Veronika Ölmek İstiyor", "Paulo Coelho")],
    movies: [w("In the Mood for Love", "Wong Kar-wai"), w("Amélie", "Jean-Pierre Jeunet")],
    music: [w("Gülümse", "Sezen Aksu"), w("Chega de Saudade", "João Gilberto")],
  },
];

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const anon = createClient(API, ANON, { auth: { persistSession: false } });

/**
 * Profil başına TAZE kullanıcı.
 *
 * `analyze` günde kullanıcı başına 3 rapora izin veriyor (DAILY_LIMIT). Tek
 * kullanıcıyla dördüncü profil 429 alıyordu — limitin kendisi doğru çalışıyor,
 * test onu tetiklememeli.
 */
async function freshUserToken(tag) {
  const email = `kapi2-${tag}-${Date.now()}@lens.test`;
  const password = "kapi2-test-parolasi";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`kullanıcı oluşturulamadı: ${error.message}`);
  const { data, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`giriş yapılamadı: ${signInErr.message}`);
  return data.session.access_token;
}

/**
 * REUSE=1 ile en son üretilmiş raporlar yeniden kullanılır, yeni Anthropic
 * çağrısı yapılmaz. Poster çiziminde bir şey değiştirip sayfayı tazelemek
 * istediğinde bunu kullan — her tazeleme dört rapor kadar kredi harcamasın.
 */
const REUSE = process.env.REUSE === "1";

mkdirSync(OUT, { recursive: true });
console.log(`Kapı 2 — gerçek raporlar${REUSE ? "  (REUSE: mevcut raporlar yeniden çiziliyor)" : ""}\n`);

let reused = [];
if (REUSE) {
  const { data } = await admin
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PROFILES.length);
  reused = (data ?? []).reverse();
}

const results = [];

for (const [index, profile] of PROFILES.entries()) {
  process.stdout.write(`── ${profile.id}  (${profile.label}) … `);

  let report;
  if (REUSE) {
    report = reused[index];
    if (!report) {
      console.log("yeniden kullanılacak rapor yok");
      continue;
    }
  } else {
    const token = await freshUserToken(profile.id);
    const res = await fetch(`${API}/functions/v1/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ books: profile.books, movies: profile.movies, music: profile.music }),
    });

    if (!res.ok) {
      console.log(`HATA ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const { reportId } = await res.json();

    const { data, error } = await admin.from("reports").select("*").eq("id", reportId).single();
    if (error) {
      console.log("rapor okunamadı:", error.message);
      continue;
    }
    report = data;
  }

  const layers = archetypeLayers(report.hero);
  const pairs = contrastPairs(report.contrasts);
  const theme = derivePosterTheme(report.texture?.colors);

  console.log("tamam");
  console.log(`   full     : ${report.hero.archetype}`);
  console.log(
    `   bölme    : ${
      layers.twoLayer
        ? `[${layers.qualifier}] + [${layers.core}]   (core ${layers.core.length} karakter)`
        : "TEK KATMAN (qualifier boş)"
    }`
  );
  console.log(
    `   poster   : ${report.contrasts
      .map((c) => `${c.left?.poster ?? "—"}/${c.right?.poster ?? "—"}`)
      .join("  ")}`
  );
  console.log(`   posterde : ${pairs.map((p) => `${p.left} ⟷ ${p.right}`).join("  ·  ")}`);
  console.log(`   palet    : ${(report.texture?.colors ?? []).map((c) => c.name).join(" · ")}`);

  const preview = {};
  for (const format of ["story", "feed"]) {
    const full = await renderPoster(report, format);
    writeFileSync(join(OUT, `${profile.id}__${format}.png`), full);
    preview[format] = png(await renderPoster(report, format, 300));
  }
  console.log("");

  results.push({ ...profile, report, layers, pairs, theme, preview });
}

writeFileSync(join(OUT, "index.html"), buildPage(results));
console.log(`Bitti → ${OUT}/  (inceleme sayfası: ${OUT}/index.html)`);

// ---------------------------------------------------------------------------

function buildPage(items) {
  const sections = items
    .map(
      (r, i) => `
<section>
  <h2>${i + 1}. ${esc(r.label)}</h2>
  <p class="sub">
    Üreticinin verdiği tam ad: <b>${esc(r.report.hero.archetype)}</b><br>
    Bölme: ${
      r.layers.twoLayer
        ? `<b>${esc(r.layers.qualifier)}</b> / <b>${esc(r.layers.core)}</b> — çekirdek ${r.layers.core.length} karakter`
        : "<b>tek katman</b> — qualifier boş geldi"
    }<br>
    Karşıtlıklar: ${r.pairs.map((p) => `<b>${esc(p.left)} ⟷ ${esc(p.right)}</b>`).join(" · ")}<br>
    Özet: ${esc(r.report.hero.summary)}
  </p>
  <div class="grid versus">
    <figure><img src="${r.preview.story}" alt="Story" width="300">
      <figcaption><b>Story</b></figcaption></figure>
    <figure><img src="${r.preview.feed}" alt="Feed" width="300">
      <figcaption><b>Feed</b></figcaption></figure>
  </div>
</section>`
    )
    .join("\n");

  const twoLayer = items.filter((r) => r.layers.twoLayer).length;

  return page({
    title: "Poster · Gerçek Raporlar",
    body: `
<p class="eyebrow">Kapı 2 · üretici doğrulaması</p>
<h1>Gerçek raporlarla poster</h1>
<p class="lede">Bu posterler lokal <code>analyze</code> fonksiyonundan gerçek Anthropic
çağrısıyla üretilmiş raporlardan geliyor. Sorulan soru tek: üretici arketibi
<b>anlamlı</b> bölüyor mu, yoksa kelime sayısına göre mi kesiyor?</p>
<div class="card" style="margin-top:26px">
  <h3>Özet</h3>
  <p style="margin-bottom:0">${items.length} rapor üretildi.
  ${twoLayer} tanesi iki katmana bölündü, ${items.length - twoLayer} tanesi tek katman kaldı.
  Bölme <code>analyze</code> içinde doğrulanıyor: <code>qualifier + core</code> birleşimi
  <code>full</code>'ü vermiyorsa tek katmana düşülüyor, yani buradaki her iki katmanlı
  sonuç aynı zamanda o denetimden geçmiş demektir.</p>
</div>
${sections}`,
  });
}
