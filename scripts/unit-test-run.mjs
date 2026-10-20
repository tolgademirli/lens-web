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
 * Durum `tmp/unit-test/` altında tutulur (`tmp/` .gitignore'da):
 *   last-run.json    son koşunun özeti
 *   last-green.json  son YEŞİL koşu + o andaki kaynak dosya özetleri (hash)
 *   history.jsonl    her koşu için bir satır
 *
 * Çıkış kodu: testler geçtiyse 0, düştüyse 1, koşu hiç başlayamadıysa 2.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

/* ------------------------------------------------------------------ */
/* Koşu                                                                */
/* ------------------------------------------------------------------ */

mkdirSync(STATE, { recursive: true });
const reportFile = path.join(STATE, "vitest.json");
const startedAt = Date.now();

const vitest = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${posix(path.relative(ROOT, reportFile))}`],
  { cwd: ROOT, encoding: "utf8" },
);

let report = null;
try {
  if (statSync(reportFile).mtimeMs >= startedAt - 1000) report = JSON.parse(readFileSync(reportFile, "utf8"));
} catch {
  /* aşağıda ele alınıyor */
}

if (!report) {
  console.error("Testler başlatılamadı (vitest sonuç üretmedi). Çıktının sonu:\n");
  console.error(`${vitest.stdout ?? ""}\n${vitest.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n"));
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

const failures = [];
for (const suite of report.testResults) {
  const file = posix(path.relative(ROOT, suite.name));
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

const hashes = snapshot();
const previous = readJson("last-run.json");
const lastGreen = readJson("last-green.json");
const key = (f) => `${f.file} › ${f.name}`;
const previousFailures = new Set((previous?.failures ?? []).map(key));
const currentFailures = new Set(failures.map(key));

const run = {
  at: new Date().toISOString(),
  head: git("rev-parse", "--short", "HEAD"),
  green: failures.length === 0,
  total: report.numTotalTests,
  passed: report.numPassedTests,
  failed: failures.length,
  skipped: report.numPendingTests + report.numTodoTests,
  // numTotalTestSuites `describe` bloklarını sayar; dosya sayısı testResults'ın boyudur.
  files: report.testResults.length,
  durationMs: Date.now() - startedAt,
  failures,
  newlyFailing: failures.filter((f) => !previousFailures.has(key(f))),
  fixed: (previous?.failures ?? []).filter((f) => !currentFailures.has(key(f))),
  changedSinceGreen: lastGreen ? changedSince(lastGreen.hashes, hashes) : null,
  lastGreenAt: lastGreen?.at ?? null,
  lastGreenHead: lastGreen?.head ?? null,
  previousAt: previous?.at ?? null,
  previousGreen: previous?.green ?? null,
};

writeFileSync(path.join(STATE, "last-run.json"), JSON.stringify(run, null, 2));
appendFileSync(
  path.join(STATE, "history.jsonl"),
  `${JSON.stringify({ at: run.at, head: run.head, total: run.total, failed: run.failed, durationMs: run.durationMs })}\n`,
);
if (run.green) {
  writeFileSync(path.join(STATE, "last-green.json"), JSON.stringify({ at: run.at, head: run.head, total: run.total, hashes }));
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
  if (run.fixed.length) lines.push(`  Düzeldi: önceki koşuda düşen ${run.fixed.length} test artık geçiyor`);
  if (previous) {
    lines.push(`  Önceki koşu: ${clock(previous.at)} — ${previous.green ? "yeşil" : `${previous.failed} test düşüyordu`}`);
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
  lines.push(`  ✗ ${run.failed} test DÜŞTÜ · ${run.passed} geçti · ${run.total} toplam · ${seconds} sn`);

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

console.log(lines.join("\n"));
process.exit(run.green ? 0 : 1);
