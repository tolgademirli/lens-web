#!/usr/bin/env node
/**
 * Mutasyon denetimi: bir satırı GEÇİCİ olarak boz, ilgili test DÜŞMELİ, sonra geri yaz.
 *
 *   npm run test:mutate -- --file src/lib/x.ts --find "if (!ok) {" --replace "if (false) {" --test tests/lib/x.test.ts
 *   npm run test:mutate -- mutasyonlar.json
 *
 * JSON biçimi: [{ "name": "...", "file": "...", "find": "...", "replace": "...", "test": "..." }]
 *
 * NEDEN VAR: hiç düşmeyen test, olmayan testtir — ve bunu anlamanın tek yolu kodu
 * bozup bakmaktır. İlk kullanımda 21 kritik kapıdan biri yakalanmadı: mail
 * şablonundaki protokol denetimi `javascript:alert(1)` ile sınanıyordu ama o
 * girdiyi zaten host denetimi durduruyordu.
 *
 * GÜVENLİK — bu betik üretim kodunu değiştirir, o yüzden dar tutuldu:
 *   - `find` dosyada TAM BİR KEZ geçmeli; yoksa o mutasyon atlanır.
 *   - Geri yazma bellekteki asıl içerikten yapılır, `git checkout` ile DEĞİL
 *     (commit edilmemiş başka değişiklikleri de silerdi).
 *   - Geri yazmadan önce dosyanın hâlâ bizim bozduğumuz hâlde olduğu doğrulanır;
 *     araya başka bir yazım girdiyse dokunulmaz ve yüksek sesle söylenir.
 *   - Ctrl+C ve beklenmeyen çıkışta da geri yazılır.
 *
 * Çıkış kodu: bütün mutasyonlar yakalandıysa 0; biri bile yakalanmadı ya da
 * atlandıysa 1; dosya geri yazılamadıysa 3 (elle bakılmalı).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

let mutations;
if (args[0] && !args[0].startsWith("--")) {
  mutations = JSON.parse(readFileSync(path.resolve(ROOT, args[0]), "utf8"));
} else {
  const one = { file: flag("file"), find: flag("find"), replace: flag("replace"), test: flag("test"), name: flag("name") };
  if (!one.file || one.find === undefined || one.replace === undefined || !one.test) {
    console.error("Kullanım: --file <dosya> --find <metin> --replace <metin> --test <test dosyası>   ya da   <mutasyonlar.json>");
    process.exit(1);
  }
  mutations = [one];
}

/** `find`i satır sonundan bağımsız arar: desendeki \n, dosyadaki \r\n ile de eşleşir. */
function matcher(find) {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\r?\n/g, "\\r?\\n");
  return new RegExp(escaped, "g");
}

/** O an bozuk duran dosya — beklenmeyen çıkışta geri yazılacak. */
let active = null;

function restore() {
  if (!active) return true;
  const { file, original, mutated } = active;
  active = null;
  if (readFileSync(file, "utf8") !== mutated) {
    console.error(`\nUYARI: ${path.relative(ROOT, file)} bu sırada başkası tarafından değişti; GERİ YAZILMADI. Elle kontrol et.`);
    return false;
  }
  writeFileSync(file, original);
  return true;
}

process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("exit", () => {
  restore();
});

let missed = 0;
let unsafe = false;

for (const m of mutations) {
  const label = m.name ?? `${m.file}: ${m.find.split("\n")[0].trim().slice(0, 60)}`;
  const file = path.resolve(ROOT, m.file);
  const original = readFileSync(file, "utf8");
  const hits = original.match(matcher(m.find))?.length ?? 0;

  if (hits !== 1) {
    console.log(`ATLANDI      ${label} — desen ${hits} kez bulundu (tam 1 olmalı)`);
    missed += 1;
    continue;
  }

  const mutated = original.replace(matcher(m.find), () => m.replace);
  active = { file, original, mutated };
  writeFileSync(file, mutated);

  let status;
  try {
    status = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...[m.test].flat()], {
      cwd: ROOT,
      encoding: "utf8",
    }).status;
  } finally {
    if (!restore()) unsafe = true;
  }

  if (status === 0) missed += 1;
  console.log(`${status === 0 ? "YAKALANMADI " : "yakalandı   "} ${label}`);
}

console.log(`\n${mutations.length - missed}/${mutations.length} mutasyon yakalandı`);
if (missed > 0) console.log("Yakalanmayan her satır için: o satırı GERÇEKTEN gerektiren girdiyi bul ve testine ekle.");
process.exit(unsafe ? 3 : missed === 0 ? 0 : 1);
