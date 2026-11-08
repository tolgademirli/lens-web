#!/usr/bin/env node
/**
 * Bütün unit testleri koşar ve sonucu BİR ÖNCEKİ koşuyla karşılaştırarak özetler.
 *
 *   npm run test:report            # koş + özet
 *   npm run test:report -- --json  # özet yerine makine-okur çıktı
 *
 * `npm test`ten farkı hafızası: "ne düştü" yerine "ne YENİ düştü ve son yeşil
 * koşudan beri hangi dosyalar değişti" der. Aralıklı koşuda (lens-unit-test skill'i,
 * `watch` modu) işe yarayan soru bu — 1200 testin geçtiğini her seferinde okumak
 * değil, kırıldığı anı ve olası sebebini görmek.
 *
 * "JSON'da düşen test yok" YEŞİL demek değil. Vitest, worker'ı başlayamayan bir
 * dosyayı sonuca hiç yazmaz ve JSON'daki `success` bunu saymaz; hatanın tek izi
 * çıkış kodu ve konsoldaki "Unhandled Errors" bölümüdür. 8 Kasım 2026'da makine
 * yüklüyken `tests/ui/emailCode.test.tsx` sonuçta hiç görünmedi ve bu betik "1140 test
 * geçti" dedi — giriş kodu kapısı sınanmadan yeşil göründü. O yüzden ayrıca düşen sayılır:
 *   - vitest'in kendi include/exclude ayarıyla topladığı ama sonuçta olmayan dosya,
 *   - vitest'in sıfırdan farklı çıkış kodu (işlenmemiş hata: başlayamayan ya da
 *     çöken worker, testten taşan bir reddetme).
 * Değişmeyen bir test dosyasının test sayısı son yeşil koşudan azaldıysa uyarı verilir.
 *
 * Durum `tmp/unit-test/` altında tutulur (`tmp/` .gitignore'da):
 *   last-run.json    son koşunun özeti
 *   last-green.json  son YEŞİL koşu + o andaki kaynak dosya özetleri (hash) ve dosya başına test sayısı
 *   history.jsonl    her koşu için bir satır
 *   files.json       vitest'in bu koşu için topladığı test dosyaları (`vitest list`)
 *   vitest.json      vitest'in ham JSON sonucu
 *   vitest.log       vitest'in konsol çıktısı — işlenmemiş hataların yazıldığı TEK yer
 *
 * Çıkış kodu: hepsi geçtiyse 0; test düştüyse, dosya koşmadıysa ya da vitest
 * işlenmemiş bir hata bildirdiyse 1; koşu hiç başlayamadıysa ya da test dosyaları
 * listelenemediyse 2.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE = path.join(ROOT, "tmp", "unit-test");
const asJson = process.argv.includes("--json");

/** Testlerin okuduğu her şey: kaynak, testler ve bekçi testlerin taradığı dosyalar. */
const WATCHED = [
  "src",
  "api",
  "supabase/functions",
  "supabase/migrations",
  "supabase/config.toml",
  "tests",
  "vitest.config.ts",
  "vercel.json",
  "package.json",
  ".env.example",
];

const posix = (file) => file.split(path.sep).join("/");
/** Vitest yolları mutlak ve `/` ayraçlı verir; durum dosyaları depoya göreli tutar. */
const relative = (abs) => posix(path.relative(ROOT, abs));

function listFiles(target, out = []) {
  const abs = path.join(ROOT, target);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) return out.push(posix(target)), out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === ".temp" || name === ".branches") continue;
    listFiles(path.join(target, name), out);
  }
  return out;
}

function snapshot() {
  const hashes = {};
  for (const target of WATCHED) {
    for (const file of listFiles(target)) {
      hashes[file] = createHash("sha1").update(readFileSync(path.join(ROOT, file))).digest("hex");
    }
  }
  return hashes;
}

function readJson(name) {
  try {
    return JSON.parse(readFileSync(path.join(STATE, name), "utf8"));
  } catch {
    return null;
  }
}

function git(...args) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : "";
}

/** İki özet arasında değişen dosyalar: "M" değişti, "+" eklendi, "-" silindi. */
function changedSince(before, now) {
  const out = [];
  for (const file of Object.keys(now)) {
    if (!(file in before)) out.push(`+ ${file}`);
    else if (before[file] !== now[file]) out.push(`M ${file}`);
  }
  for (const file of Object.keys(before)) if (!(file in now)) out.push(`- ${file}`);
  return out.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
}

const clock = (iso) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(
    new Date(iso),
  );

// Varsayılan 1 MB'ı aşan çıktıda spawnSync çocuğu öldürür ve koşu yarım kalır.
const vitestCli = (args) =>
  spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const consoleOf = (res) => `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
const tail = (res) => consoleOf(res).split("\n").slice(-40).join("\n");

/* ------------------------------------------------------------------ */
/* Koşu                                                                */
/* ------------------------------------------------------------------ */

mkdirSync(STATE, { recursive: true });
const filesFile = path.join(STATE, "files.json");
const reportFile = path.join(STATE, "vitest.json");
const logFile = path.join(STATE, "vitest.log");
const startedAt = Date.now();

/**
 * Koşunun içermesi GEREKEN dosyalar, vitest'in kendi include/exclude ayarından
 * (`vitest.config.ts` → projects). Elle bir liste ya da `tests/` taraması değil: ikisi
 * de ilk yeni klasörde ya da ilk exclude'da eskir ve eksik dosyayı yine göremez.
 * `--filesOnly` dosyaları içe aktarmaz ve worker açmaz, yani yük altında da ~2 sn sürer.
 */
rmSync(filesFile, { force: true });
const listing = vitestCli(["list", "--filesOnly", `--json=${relative(filesFile)}`]);
let expected = null;
try {
  if (listing.status === 0) {
    expected = [...new Set(JSON.parse(readFileSync(filesFile, "utf8")).map((entry) => relative(entry.file)))].sort();
  }
} catch {
  /* aşağıda ele alınıyor */
}

if (!expected?.length) {
  console.error("Test dosyaları listelenemedi (`vitest list --filesOnly` sonuç vermedi). Çıktının sonu:\n");
  console.error(tail(listing));
  process.exit(2);
}

// dot raporlayıcısı JSON'a girmeyen işlenmemiş hataları basar; konsol çıktısı
// vitest.log'a yazılır. Geçen testlerin konsol günlükleri susturulur, düşenlerinki kalır.
const vitest = vitestCli([
  "run",
  "--reporter=json",
  "--reporter=dot",
  "--silent=passed-only",
  `--outputFile.json=${relative(reportFile)}`,
]);
const vitestConsole = consoleOf(vitest);
writeFileSync(logFile, `${vitestConsole}\n`);

let report = null;
try {
  if (statSync(reportFile).mtimeMs >= startedAt - 1000) report = JSON.parse(readFileSync(reportFile, "utf8"));
} catch {
  /* aşağıda ele alınıyor */
}

if (!report) {
  console.error("Testler başlatılamadı (vitest sonuç üretmedi). Çıktının sonu:\n");
  console.error(tail(vitest));
  process.exit(2);
}

/**
 * Zaman aşımı, Vitest'in JSON çıktısında anlamsız bir yer tutucuyla gelir. Ayrı
 * tanınır çünkü teşhisi farklıdır: zaman aşımına düşen bir test arkasında yarım iş
 * bırakır ve aynı dosyadaki SONRAKİ testleri de düşürebilir (bir kez 14 test böyle düştü).
 */
const TIMEOUT = "zaman aşımı — test süresini aştı";
const firstLine = (raw) => {
  const text = String(raw ?? "");
  if (/STACK_TRACE_ERROR|timed out in \d+ms/i.test(text)) return TIMEOUT;
  return text.split("\n")[0].slice(0, 300);
};

const rootPattern = new RegExp(`${posix(ROOT).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "gi");

/**
 * Konsoldaki "Unhandled Errors" bölümünden her hatanın ilk satırı ve "Caused by" satırı.
 * JSON raporunda bu hataların hiçbir izi yok; tek kaynak vitest'in kendi konsol çıktısı.
 * Her hata `⎯⎯ <tür> ⎯⎯` başlığıyla başlar; bölüm "Test Files" özetiyle biter.
 */
function unhandledErrors(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /⎯ Unhandled Errors ⎯/.test(line));
  if (start === -1) return [];
  const errors = [];
  for (let i = start + 1; i < lines.length && !/^\s*Test Files\s/.test(lines[i]); i++) {
    if (/^⎯+ .+ ⎯+$/.test(lines[i].trim())) errors.push({ message: "", cause: "" });
    const current = errors.at(-1);
    const line = lines[i].trim().replace(rootPattern, "");
    if (!current || !line || line.startsWith("⎯") || line.startsWith("❯")) continue;
    if (!current.message) current.message = line;
    else if (!current.cause && line.startsWith("Caused by:")) current.cause = line.replace(/^Caused by:\s*/, "");
  }
  return errors
    .filter((error) => error.message)
    .map((error) => (error.cause ? `${error.message} ← ${error.cause}` : error.message).slice(0, 300));
}

const failures = [];
for (const suite of report.testResults) {
  const file = relative(suite.name);
  const failed = suite.assertionResults.filter((t) => t.status === "failed");
  for (const test of failed) {
    failures.push({
      file,
      name: [...test.ancestorTitles, test.title].join(" › "),
      message: firstLine(test.failureMessages?.[0]),
    });
  }
  // Dosya hiç yüklenemediyse (import hatası) içinde test görünmez; yine de düşmüştür.
  if (suite.status === "failed" && failed.length === 0) {
    failures.push({ file, name: "(dosya yüklenemedi)", message: firstLine(suite.message) });
  }
}

// Vitest'in topladığı ama sonuçta hiç olmayan dosya: testleri geçmedi, KOŞMADI.
// "Daha az test" diye yutulursa o dosyanın sınadığı kapı sınanmadan yeşil görünür.
const NOT_RUN = "(dosya koşmadı — sonuçta yok)";
const unhandled = vitest.status === 0 ? [] : unhandledErrors(vitestConsole);
const seen = new Set(report.testResults.map((suite) => relative(suite.name)));
const missing = expected.filter((file) => !seen.has(file));
for (const file of missing) {
  const reason = unhandled.find((message) => message.includes(file));
  failures.push({
    file,
    name: NOT_RUN,
    message: reason ?? "vitest bu dosyayı topladı ama sonuca yazmadı: worker başlayamadı ya da çöktü (tmp/unit-test/vitest.log)",
  });
}
// Kalan işlenmemiş hatalar: bir dosyaya bağlanamadılar ama vitest'e göre koşu başarısız.
for (const message of unhandled.filter((m) => !missing.some((file) => m.includes(file)))) {
  failures.push({ file: "(vitest)", name: "işlenmemiş hata", message });
}
if (vitest.status !== 0 && failures.length === 0) {
  failures.push({
    file: "(vitest)",
    name: `çıkış kodu ${vitest.status ?? vitest.signal}`,
    message: "JSON'da düşen yok ama vitest başarısız çıktı — sebebi tmp/unit-test/vitest.log'da",
  });
}

const hashes = snapshot();
const previous = readJson("last-run.json");
const lastGreen = readJson("last-green.json");
const key = (f) => `${f.file} › ${f.name}`;
const previousFailures = new Set((previous?.failures ?? []).map(key));
const currentFailures = new Set(failures.map(key));
const counts = Object.fromEntries(report.testResults.map((suite) => [relative(suite.name), suite.assertionResults.length]));
const changedSinceGreen = lastGreen ? changedSince(lastGreen.hashes, hashes) : null;

/**
 * Son yeşil koşudan beri İÇERİĞİ değişmemiş bir test dosyasında test sayısı azaldıysa.
 * Düşen sayılmaz: testleri dizinden ya da başka bir dosyadan türeyen bekçiler (endpoint,
 * migration listesi) kaynak değişince meşru olarak azalır. Ama görünür — dosyanın kendisi
 * değişmeden kaybolan test, artık sınanmayan bir kural olabilir. Dosya başına sayı tutmayan
 * eski kayıtta yalnızca toplam karşılaştırılır, o da `tests/` altında hiçbir şey değişmediyse.
 */
function shrunkSinceGreen() {
  if (!lastGreen) return [];
  if (lastGreen.counts) {
    return Object.entries(counts)
      .filter(([file, n]) => n < (lastGreen.counts[file] ?? 0) && lastGreen.hashes[file] === hashes[file])
      .map(([file, n]) => ({ file, before: lastGreen.counts[file], after: n }));
  }
  const testsChanged = changedSinceGreen.some((change) => change.slice(2).startsWith("tests/"));
  return !testsChanged && report.numTotalTests < lastGreen.total
    ? [{ file: null, before: lastGreen.total, after: report.numTotalTests }]
    : [];
}

const run = {
  at: new Date().toISOString(),
  head: git("rev-parse", "--short", "HEAD"),
  green: failures.length === 0,
  exitCode: vitest.status,
  total: report.numTotalTests,
  passed: report.numPassedTests,
  failed: failures.length,
  skipped: report.numPendingTests + report.numTodoTests,
  // numTotalTestSuites `describe` bloklarını sayar; dosya sayısı testResults'ın boyudur.
  files: report.testResults.length,
  expectedFiles: expected.length,
  missing,
  shrunk: shrunkSinceGreen(),
  durationMs: Date.now() - startedAt,
  failures,
  newlyFailing: failures.filter((f) => !previousFailures.has(key(f))),
  fixed: (previous?.failures ?? []).filter((f) => !currentFailures.has(key(f))),
  changedSinceGreen,
  lastGreenAt: lastGreen?.at ?? null,
  lastGreenHead: lastGreen?.head ?? null,
  previousAt: previous?.at ?? null,
  previousGreen: previous?.green ?? null,
};

writeFileSync(path.join(STATE, "last-run.json"), JSON.stringify(run, null, 2));
// Koşmayan dosya ve azalan sayı geçmişe de yazılır: 8 Kasım'daki koşunun tek izi
// buradaki "total" satırıydı, vitest.json bir sonraki koşuyla ezilmişti.
appendFileSync(
  path.join(STATE, "history.jsonl"),
  `${JSON.stringify({
    at: run.at,
    head: run.head,
    total: run.total,
    failed: run.failed,
    files: run.files,
    ...(run.missing.length && { missing: run.missing }),
    ...(run.shrunk.length && { shrunk: run.shrunk.map((s) => `${s.file ?? "toplam"} ${s.before}→${s.after}`) }),
    ...(run.exitCode !== 0 && { exitCode: run.exitCode }),
    durationMs: run.durationMs,
  })}\n`,
);
if (run.green) {
  writeFileSync(
    path.join(STATE, "last-green.json"),
    JSON.stringify({ at: run.at, head: run.head, total: run.total, counts, hashes }),
  );
}

/* ------------------------------------------------------------------ */
/* Özet                                                                */
/* ------------------------------------------------------------------ */

if (asJson) {
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.green ? 0 : 1);
}

const seconds = (run.durationMs / 1000).toFixed(1);
const lines = [`Lens unit testleri — ${clock(run.at)} (${run.head || "commit yok"})`];

if (run.green) {
  lines.push(`  ✓ ${run.passed} test geçti · ${run.files} dosya · ${seconds} sn`);
  if (run.skipped) lines.push(`  ! ${run.skipped} test atlanmış (skip/todo) — atlanan test, olmayan testtir`);
  const fixedFiles = run.fixed.filter((f) => f.name === NOT_RUN).length;
  if (run.fixed.length - fixedFiles) {
    lines.push(`  Düzeldi: önceki koşuda düşen ${run.fixed.length - fixedFiles} test artık geçiyor`);
  }
  if (fixedFiles) lines.push(`  Düzeldi: önceki koşuda koşmayan ${fixedFiles} dosya artık koşuyor`);
  if (previous) {
    const notRun = previous.missing?.length ?? 0;
    const verdict = [previous.failed - notRun && `${previous.failed - notRun} test düşüyordu`, notRun && `${notRun} dosya koşmamıştı`];
    lines.push(`  Önceki koşu: ${clock(previous.at)} — ${previous.green ? "yeşil" : verdict.filter(Boolean).join(", ")}`);
    if (lastGreen) {
      const changed = run.changedSinceGreen.length;
      lines.push(
        changed === 0
          ? `  Son yeşil koşudan (${clock(lastGreen.at)}) beri dosya değişmedi.`
          : `  Son yeşil koşudan (${clock(lastGreen.at)}) beri ${changed} dosya değişti — hepsi bu koşuda sınandı.`,
      );
    }
  } else {
    lines.push("  İlk kayıtlı koşu: karşılaştırılacak önceki sonuç yok.");
  }
} else {
  const testFailures = run.failed - missing.length;
  const verdict = [testFailures && `${testFailures} test DÜŞTÜ`, missing.length && `${missing.length} dosya KOŞMADI`];
  lines.push(`  ✗ ${verdict.filter(Boolean).join(" · ")} · ${run.passed} geçti · ${run.total} toplam · ${seconds} sn`);

  const fresh = new Set(run.newlyFailing.map(key));
  const show = (title, list) => {
    if (list.length === 0) return;
    lines.push("", `  ${title}`);
    for (const f of list.slice(0, 25)) {
      lines.push(`    ${f.file}`, `      ${f.name}`);
      if (f.message) lines.push(`      → ${f.message}`);
    }
    if (list.length > 25) lines.push(`    … ve ${list.length - 25} test daha (tmp/unit-test/last-run.json)`);
  };
  show(previous ? "YENİ düşenler (önceki koşuda geçiyordu):" : "Düşenler:", run.newlyFailing);
  show("Hâlâ düşenler (önceki koşuda da düşüyordu):", failures.filter((f) => !fresh.has(key(f))));

  if (missing.length) {
    lines.push(
      "",
      `  ! ${missing.length} dosya vitest'in topladığı ${expected.length} dosyadan sonuçta YOK: testleri geçmedi, hiç koşmadı.`,
      "    Sık sebep makine yükü: worker 60 sn içinde başlayamıyor (\"Failed to start forks worker\").",
      "    Dosyayı tek başına koş; yük kalkınca paketi yeniden koş. Ayrıntı: tmp/unit-test/vitest.log",
    );
  }

  const timedOut = failures.filter((f) => f.message === TIMEOUT);
  if (timedOut.length) {
    const files = [...new Set(timedOut.map((f) => f.file))];
    lines.push(
      "",
      `  ! ${timedOut.length} test ZAMAN AŞIMINA düştü (${files.join(", ")}).`,
      "    Aynı dosyadaki diğer düşüşler zincirleme olabilir: önce o dosyayı tek başına koş.",
    );
  }

  if (run.changedSinceGreen) {
    lines.push("", `  Son yeşil koşudan (${clock(run.lastGreenAt)}, ${run.lastGreenHead || "?"}) beri değişen dosyalar:`);
    if (run.changedSinceGreen.length === 0) {
      lines.push("    (yok — kod değişmeden düşen test KARARSIZDIR: yük, saat ya da sıra bağımlılığı. Kök nedenini bul.)");
    }
    for (const change of run.changedSinceGreen.slice(0, 40)) lines.push(`    ${change}`);
    if (run.changedSinceGreen.length > 40) lines.push(`    … ve ${run.changedSinceGreen.length - 40} dosya daha`);
  } else {
    lines.push("", "  Kayıtlı bir yeşil koşu yok; değişen dosyalar için `git status` ve `git diff`e bak.");
  }
}

if (run.shrunk.length) {
  const [only] = run.shrunk;
  lines.push("");
  if (only.file === null) {
    lines.push(
      `  ! Toplam test sayısı son yeşil koşudan (${clock(lastGreen.at)}) beri AZALDI: ${only.before} → ${only.after},`,
      "    ve tests/ altında hiçbir dosya değişmedi. (Dosya başına sayı bir sonraki yeşil koşudan itibaren tutuluyor.)",
    );
  } else {
    lines.push(`  ! Son yeşil koşudan (${clock(lastGreen.at)}) beri DEĞİŞMEYEN test dosyalarında test sayısı azaldı:`);
    for (const s of run.shrunk) lines.push(`      ${s.file}  ${s.before} → ${s.after}`);
  }
  lines.push(
    "    Dosya değişmeden test kaybolmaz: test listesi başka bir dosyadan ya da ortamdan türüyor olabilir",
    "    (bekçiler) ya da dosya yarım koştu. Sebebi belli olmadan bu koşunun yeşiline güvenme. Uyarı bir kez",
    "    görünür: yeşil koşu yeni sayıyı taban alır.",
  );
  if (run.green && run.changedSinceGreen.length) {
    lines.push("    Son yeşilden beri değişenler (azalmayı açıklıyor olabilir):");
    for (const change of run.changedSinceGreen.slice(0, 10)) lines.push(`      ${change}`);
    if (run.changedSinceGreen.length > 10) lines.push(`      … ve ${run.changedSinceGreen.length - 10} dosya daha`);
  }
}

console.log(lines.join("\n"));
process.exit(run.green ? 0 : 1);
