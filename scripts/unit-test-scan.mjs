#!/usr/bin/env node
/**
 * Eksik unit test taraması: testlerin HİÇ ÇALIŞTIRMADIĞI kodu bulur.
 *
 *   npm run test:scan              # testleri kapsam ölçümüyle koş + rapor
 *   npm run test:scan -- --reuse   # son kapsam çıktısını yeniden kullan (koşmaz)
 *   npm run test:scan -- --json    # rapor yerine makine-okur çıktı
 *
 * "Test dosyası var mı" diye bakmaz — o soru yanıltıcı: dosyası olup yarısı
 * sınanmayan modül "testli" görünür. Kapsam verisine bakar ve dört şey söyler:
 *   1. Çekirdek mantıkta hiçbir satırı çalışmayan dosyalar (testsiz)
 *   2. Çekirdek mantıkta çalışmayan fonksiyonu ya da satırı kalan dosyalar (kısmi)
 *   3. Bileşenler: hangisini bir test çiziyor, hangisini çizmiyor. Bileşen testi
 *      yalnızca KAPI taşıyan bileşenlere yazıldığı için buradaki "testsiz" sayısı
 *      eksik sayısı değildir — ama saklanmaz da.
 *   4. Bu ölçümün HİÇ GÖREMEDİĞİ yerler (SQL, prompt çıktısı) — sessizce
 *      "kapsam %98" demek, o %98'in neyin yüzdesi olduğunu saklamak olurdu.
 *
 * Çekirdek = src/lib · api · supabase/functions. Başlıktaki yüzdeler yalnızca
 * onundur; otuz testsiz bileşen o sayıyı anlamsızlaştırırdı.
 *
 * Son yeşil koşudan beri değişen dosyalar öne alınır (bkz. unit-test-run.mjs):
 * az önce dokunulan ve sınanmayan kod, eski ve sınanmayan koddan önce gelir.
 *
 * Kapsam bir ALT SINIRDIR, kanıt değil: çalışan satır doğru sınanmış satır
 * demek değildir. Rapor "nereye bakmalı"yı söyler; "yeterince sınandı"yı söylemez.
 * Sınayıp sınamadığını `npm run test:mutate` söyler.
 *
 * Rapor `tmp/unit-test/scan.json`'a da yazılır. Çıkış kodu her zaman 0'dır
 * (tarama bilgidir, kapı değil); yalnızca kapsam hiç üretilemezse 2.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE = path.join(ROOT, "tmp", "unit-test");
const COVERAGE = path.join(ROOT, "tmp", "coverage", "coverage-final.json");
const reuse = process.argv.includes("--reuse");
const asJson = process.argv.includes("--json");

/** Satır kapsamı bunun altındaysa dosya "kısmi" sayılır (çalışmayan fonksiyonu olmasa da). */
const LINE_THRESHOLD = 90;

const posix = (file) => file.split(path.sep).join("/");
const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 1000) / 10);

/** Bileşen katmanı: çekirdek mantıktan ayrı raporlanır. */
const isUi = (file) => file.startsWith("src/app/") || file.startsWith("src/pages/") || file === "src/main.tsx";

function listFiles(target, accept, out = []) {
  const abs = path.join(ROOT, target);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules") continue;
    const rel = path.join(target, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) listFiles(rel, accept, out);
    else if (accept(posix(rel))) out.push(posix(rel));
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Ardışık satırları "12-18, 40" biçiminde aralıklara toplar. */
function ranges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] - sorted[end] <= 1) end += 1;
    out.push(sorted[i] === sorted[end] ? `${sorted[i]}` : `${sorted[i]}-${sorted[end]}`);
    i = end;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1) Kapsam ölçümü                                                    */
/* ------------------------------------------------------------------ */

mkdirSync(STATE, { recursive: true });
let tests = null;

if (!reuse) {
  const reportFile = path.join(STATE, "vitest.json");
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--coverage",
      // Düşen test varken de kapsam üretilsin: tarama en çok o zaman lazım.
      "--coverage.reportOnFailure=true",
      "--reporter=json",
      `--outputFile=${posix(path.relative(ROOT, reportFile))}`,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const report = readJson(reportFile);
  if (report) {
    const failedFiles = report.testResults.filter((suite) => suite.status === "failed").length;
    tests = { total: report.numTotalTests, failed: Math.max(report.numFailedTests, failedFiles) };
  }
  if (!existsSync(COVERAGE)) {
    console.error("Kapsam üretilemedi. Çıktının sonu:\n");
    console.error(`${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n"));
    process.exit(2);
  }
}

const coverage = readJson(COVERAGE);
if (!coverage) {
  console.error("tmp/coverage/coverage-final.json yok. `--reuse` olmadan çalıştır.");
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* 2) Dosya başına özet                                                */
/* ------------------------------------------------------------------ */

const lastGreen = readJson(path.join(STATE, "last-green.json"));
const sha1 = (file) => createHash("sha1").update(readFileSync(path.join(ROOT, file))).digest("hex");
/** Son yeşil koşudan beri değişti mi? Kayıt yoksa bilinmiyor (null). */
const changed = (file) => (lastGreen ? lastGreen.hashes[file] !== sha1(file) : null);

const files = [];
const totals = { lines: [0, 0], functions: [0, 0], branches: [0, 0] };

for (const [abs, entry] of Object.entries(coverage)) {
  const file = posix(path.relative(ROOT, abs));
  if (!existsSync(path.join(ROOT, file))) continue;

  // Satır kapsamı: bir satır, üzerindeki ifadelerden biri çalıştıysa çalışmıştır.
  const lineHits = new Map();
  for (const [id, loc] of Object.entries(entry.statementMap)) {
    const line = loc.start.line;
    lineHits.set(line, Math.max(lineHits.get(line) ?? 0, entry.s[id]));
  }
  const lineTotal = lineHits.size;
  const uncoveredLines = [...lineHits].filter(([, hits]) => hits === 0).map(([line]) => line);

  const fns = Object.entries(entry.fnMap).map(([id, fn]) => ({
    name: fn.name,
    line: fn.loc?.start?.line ?? fn.decl?.start?.line ?? 0,
    hits: entry.f[id],
  }));
  const deadFns = fns.filter((fn) => fn.hits === 0);
  const branchHits = Object.values(entry.b).flat();
  const ui = isUi(file);

  if (!ui) {
    totals.lines[0] += lineTotal - uncoveredLines.length;
    totals.lines[1] += lineTotal;
    totals.functions[0] += fns.length - deadFns.length;
    totals.functions[1] += fns.length;
    totals.branches[0] += branchHits.filter((h) => h > 0).length;
    totals.branches[1] += branchHits.length;
  }

  files.push({
    file,
    ui,
    changed: changed(file),
    lines: pct(lineTotal - uncoveredLines.length, lineTotal),
    functions: pct(fns.length - deadFns.length, fns.length),
    branches: pct(branchHits.filter((h) => h > 0).length, branchHits.length),
    functionCount: fns.length,
    lineCount: lineTotal,
    // Adsız fonksiyonların (callback) satırı, adlılarınsa adı işe yarar.
    deadFunctions: deadFns.map((fn) => (fn.name.startsWith("(anonymous") ? `(adsız) L${fn.line}` : `${fn.name} L${fn.line}`)),
    uncoveredLines: ranges(uncoveredLines),
    untouched: lineTotal > 0 && uncoveredLines.length === lineTotal,
  });
}

// Değişenler önce, sonra en çok açığı olan.
const byRisk = (a, b) =>
  Number(b.changed === true) - Number(a.changed === true) ||
  b.deadFunctions.length - a.deadFunctions.length ||
  a.lines - b.lines ||
  a.file.localeCompare(b.file);

const core = files.filter((f) => !f.ui);
const untested = core.filter((f) => f.untouched).sort(byRisk);
const partial = core.filter((f) => !f.untouched && (f.deadFunctions.length > 0 || f.lines < LINE_THRESHOLD)).sort(byRisk);
const covered = core.filter((f) => !f.untouched && !partial.includes(f));

const ui = files.filter((f) => f.ui);
const uiTested = ui.filter((f) => !f.untouched).sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
const uiUntested = ui.filter((f) => f.untouched).sort(byRisk);

/* ------------------------------------------------------------------ */
/* 3) Bileşenlerde kalmış mantık · ölçümün göremediği yerler            */
/* ------------------------------------------------------------------ */

/** Bileşen dosyasında duran ama bileşen olmayan (küçük harfle başlayan) fonksiyonlar. */
const strandedLogic = [];
for (const { file } of ui) {
  const names = [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([a-z]\w*)/gm)]
    .map((m) => m[1])
    .filter((name) => !name.startsWith("use"));
  if (names.length) strandedLogic.push({ file, functions: names });
}
strandedLogic.sort((a, b) => a.file.localeCompare(b.file));

const sqlFunctions = new Set();
const migrations = listFiles("supabase/migrations", (file) => file.endsWith(".sql"));
for (const file of migrations) {
  for (const match of readFileSync(path.join(ROOT, file), "utf8").matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi)) {
    sqlFunctions.add(match[1].toLowerCase());
  }
}

const result = {
  at: new Date().toISOString(),
  tests,
  totals: {
    lines: pct(...totals.lines),
    functions: pct(...totals.functions),
    branches: pct(...totals.branches),
    files: core.length,
  },
  untested,
  partial,
  coveredCount: covered.length,
  ui: {
    files: ui.length,
    tested: uiTested.map((f) => ({ file: f.file, lines: f.lines, functions: f.functions, changed: f.changed })),
    untested: uiUntested.map((f) => ({ file: f.file, changed: f.changed })),
    strandedLogic,
  },
  outOfScope: { sqlFunctions: sqlFunctions.size, migrations: migrations.length },
  changeTracking: Boolean(lastGreen),
};

writeFileSync(path.join(STATE, "scan.json"), JSON.stringify(result, null, 2));

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Rapor                                                               */
/* ------------------------------------------------------------------ */

const out = [];
const mark = (f) => (f.changed === true ? " · DEĞİŞTİ" : "");
const clip = (list, max) => (list.length > max ? [...list.slice(0, max), `… +${list.length - max}`] : list).join(", ");
const short = (file) => file.replace(/^src\/(app\/components\/|app\/|pages\/)?/, "");

out.push("# Unit test taraması");
if (tests) {
  out.push(
    tests.failed > 0
      ? `Testler: ${tests.failed} DÜŞEN var (toplam ${tests.total}) — önce onları çöz; tarama eksik olabilir.`
      : `Testler: ${tests.total} test geçti.`,
  );
} else {
  out.push("Testler koşulmadı (--reuse): kapsam verisi son ölçümden.");
}
out.push(
  `Çekirdek mantık (lib · api · edge function, ${core.length} dosya): satır %${result.totals.lines} · fonksiyon %${result.totals.functions} · dal %${result.totals.branches}`,
);
out.push(
  result.changeTracking
    ? "DEĞİŞTİ = son yeşil koşudan beri dokunulmuş dosya."
    : "Kayıtlı yeşil koşu yok, 'değişti' işareti konamadı (`npm run test:report` bir kez yeşil koşunca başlar).",
);

out.push("", `## 1. Çekirdekte hiç testi olmayan dosyalar (${untested.length})`);
if (untested.length === 0) out.push("Yok.");
for (const f of untested) out.push(`- ${f.file} — ${f.functionCount} fonksiyon, ${f.lineCount} satır${mark(f)}`);

out.push("", `## 2. Çekirdekte kısmen sınanan dosyalar (${partial.length})`);
if (partial.length === 0) out.push("Yok.");
for (const f of partial) {
  out.push(`- ${f.file} — satır %${f.lines} · fonksiyon %${f.functions} · dal %${f.branches}${mark(f)}`);
  if (f.deadFunctions.length) out.push(`  - hiç çalışmayan fonksiyon: ${clip(f.deadFunctions, 12)}`);
  if (f.uncoveredLines.length) out.push(`  - çalışmayan satırlar: ${clip(f.uncoveredLines, 14)}`);
}

out.push("", `## 3. Bileşenler ve sayfalar (${ui.length} dosya)`);
out.push(
  "Bileşen testi yalnızca KAPI taşıyan bileşenlere yazılır (tests/ui): bir şey olmadan başka bir şeyin başlamaması " +
    "gereken yerler. 'Çizilmeyen' sayısı eksik test sayısı DEĞİLDİR — ama içlerinden biri kapı taşıyorsa eksiktir.",
);
out.push(
  `- Bir testin çizdiği (${uiTested.length}): ${uiTested.map((f) => `${short(f.file)} %${f.lines}${mark(f)}`).join(" · ") || "yok"}`,
);
const uiChanged = uiUntested.filter((f) => f.changed === true);
out.push(
  `- Hiçbir testin çizmediği: ${uiUntested.length} dosya` +
    (uiChanged.length ? ` — son yeşil koşudan beri DEĞİŞENLER: ${uiChanged.map((f) => short(f.file)).join(", ")}` : ""),
);
if (strandedLogic.length) {
  out.push("- Bileşen dosyasında kalmış saf mantık (dışarı alınırsa unit test yazılabilir):");
  for (const s of strandedLogic) out.push(`  - ${s.file}: ${s.functions.join(", ")}`);
}
out.push("- Görünüm, düzen ve akışın tamamı için elle senaryolar: docs/test-senaryolari.md");

out.push("", "## 4. Bu ölçümün GÖREMEDİĞİ yerler");
out.push(
  `- Veritabanı: ${migrations.length} migration'da ${sqlFunctions.size} SQL fonksiyonu (record_feedback, lens_blocked_works, lens_work_key …). ` +
    "Sinyal ağırlıkları, yasak küme sırası ve RLS burada yaşıyor; unit testler onları SAHTE istemciyle geçiyor. Doğrulaması lokal Supabase ister.",
);
out.push("- Üretici prompt'ların ÇIKTI kalitesi (Türkçe karakter, uydurma eser, hassas çıkarım): kodla değil ölçümle sınanır.");
out.push("- CLAUDE.md'ye yeni giren kuralların testte karşılığı olup olmadığı: bkz. lens-unit-test skill'i, `scan` adımı.");

out.push("", `Tam sınanan çekirdek dosya: ${covered.length}/${core.length} · ayrıntı: tmp/unit-test/scan.json`);
console.log(out.join("\n"));
