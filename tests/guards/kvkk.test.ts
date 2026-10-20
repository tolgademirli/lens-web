import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * KVKK: HUKUKİ METİNLER KODUN YAPTIĞINI ANLATIR ve onunla birlikte değişir.
 *
 * `/privacy`, `/cookies`, `/terms` ve rıza cümlesindeki her ifade bir sözdür:
 * "7 gün" yazıyorsa 7 günde siliniyor, "şu servislere gider" yazıyorsa başka
 * servise gitmiyor olmalı. Bu dosya metin ile kodun AYRIŞMASINI yakalar —
 * davranışın kendisi başka yerde sınanır (`tests/ui/transferConsent.test.tsx`,
 * `tests/lib/transferConsent.test.ts`).
 *
 * Buradaki bir test düştüğünde iki doğru cevap vardır: kodu sözüne döndür ya da
 * metni (ve gerekiyorsa rıza sürümünü) yeni gerçeğe göre güncelle. Testi tek
 * başına değiştirmek, kullanıcıya verilmiş sözü sessizce değiştirmektir.
 */
const ROOT = process.cwd();
const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");
const read = (file: string) => readFileSync(path.resolve(ROOT, file), "utf8");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  const abs = path.resolve(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    if (statSync(full).isDirectory()) {
      if (name !== "ui") out.push(...walk(full, accept));
    } else if (accept(rel(full))) out.push(rel(full));
  }
  return out;
}

const isCode = (file: string) => /\.(ts|tsx)$/.test(file);
const srcFiles = walk("src", isCode);
const codeFiles = [...srcFiles, ...walk("api", isCode), ...walk("supabase/functions", isCode)];

const legalPage = stripComments(read("src/pages/Legal.tsx"));
const legalData = read("src/lib/legal.ts");
const processors = [...stripComments(legalData).matchAll(/^\s+name: "([^"]+)",/gm)].map((m) => m[1]);
const consentVersion = /TRANSFER_CONSENT_VERSION = "([^"]+)"/.exec(legalData)![1];

describe("kişisel veri alan servisler ↔ Aydınlatma Metni'ndeki tablo", () => {
  /**
   * Kodda adı geçen HER dış adres. Değer: `PROCESSORS`'taki adı, ya da `null` —
   * oraya kullanıcıya dair hiçbir şey gitmiyorsa (gerekçesi yanında).
   *
   * Bu test yeni bir adres yüzünden düşerse karar ver: o adrese kullanıcının
   * kimliği, IP'si ya da içeriği gidiyor mu? Gidiyorsa `PROCESSORS` + Aydınlatma
   * Metni (ülke yeniyse rıza sürümü de). Gitmiyorsa buraya `null` ve gerekçe.
   */
  const HOSTS: Record<string, string | null> = {
    "api.anthropic.com": "Anthropic (Claude)",
    "api.resend.com": "Resend",
    "us.i.posthog.com": "PostHog",

    "api.movieofthenight.com": null, // yalnızca eser adı ve yılı
    "openlibrary.org": null, // yalnızca eser ve yazar adı
    "www.wikidata.org": null, // yalnızca eser ve yaratıcı adı
    "www.justwatch.com": null, // kullanıcıya verilen arama linki; biz istek atmıyoruz
    "www.movieofthenight.com": null, // künye linki
    "esm.sh": null, // Deno modül importu
    "lensestetik.com": null, // kendimiz
    localhost: null, // URL ayrıştırma tabanı
    "www.w3.org": null, // SVG ad alanı
  };

  const found = new Map<string, string>();
  for (const file of codeFiles) {
    for (const match of stripComments(read(file)).matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }

  it("koddaki her dış adres sınıflandırılmıştır (yeni servis fark edilmeden eklenemez)", () => {
    const unknown = [...found].filter(([host]) => !(host in HOSTS)).map(([host, file]) => `${host} (${file})`);
    expect(unknown).toEqual([]);
  });

  it("sınıflandırma listesi kodda geçmeyen adres taşımaz", () => {
    expect(Object.keys(HOSTS).filter((host) => !found.has(host))).toEqual([]);
  });

  it("kişisel veri alan her adresin sağlayıcısı tabloda yer alır", () => {
    expect(processors.length).toBeGreaterThanOrEqual(6);
    for (const [host, processor] of Object.entries(HOSTS)) {
      if (processor) expect(processors, host).toContain(processor);
    }
  });

  // Adresi env'den gelen (Supabase, PostHog istemcisi) ya da tarayıcı yönlendirmesiyle
  // ulaşılan (Google, Vercel) sağlayıcılar yukarıdaki taramada görünmez.
  it.each(["Supabase", "Vercel", "Google", "PostHog"])("%s tabloda yer alır", (name) => {
    expect(processors).toContain(name);
  });
});

describe("tarayıcıda tutulan kayıtlar ↔ Çerez Politikası'ndaki tablo", () => {
  const usesStorage = srcFiles.filter((file) => /\b(localStorage|sessionStorage)\b/.test(stripComments(read(file))));
  const inCode = new Set<string>();
  for (const file of usesStorage) {
    const code = stripComments(read(file));
    for (const match of code.matchAll(/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*["'`]([^"'`]+)["'`]/g)) {
      inCode.add(match[1]);
    }
    for (const match of code.matchAll(/const\s+[A-Z_]*KEY[A-Z_]*\s*=\s*["'`]([^"'`]+)["'`]/g)) inCode.add(match[1]);
  }

  const table = /const STORED = \[([\s\S]*?)\n\];/.exec(legalPage)![1];
  const documented = new Set([...table.matchAll(/\b(lens_[a-z_]+)\b/g)].map((m) => m[1]));

  it("kodun yazdığı anahtarlar bulunur (tarama boş kalmasın)", () => {
    expect([...inCode].sort()).toEqual(
      expect.arrayContaining(["lens_analytics_consent", "lens_auth_method", "lens_pending_consent", "lens_pending_library", "lens_pending_report"]),
    );
  });

  // `localStorage`'a yeni bir anahtar ekleyen commit tabloya da satır ekler.
  it("kodun yazdığı her anahtar Çerez Politikası'nda belgelidir", () => {
    expect([...inCode].filter((key) => !documented.has(key))).toEqual([]);
  });

  it("tabloda, kodun artık yazmadığı bir anahtar kalmamıştır", () => {
    expect([...documented].filter((key) => !inCode.has(key))).toEqual([]);
  });

  it("oturum kaydı ve sekme belleğindeki taslak da tabloda anlatılır", () => {
    expect(table).toContain("auth-token");
    expect(table).toContain("sekme belleğindeki taslak");
  });
});

describe("saklama süreleri ↔ metin", () => {
  const migrations = walk("supabase/migrations", (file) => /\/\d{14}_[^/]+\.sql$/.test(file)).sort();

  // "Günlük kullanım sayacındaki IP adresi 7 gün sonra silinir." — o satırları silen iş pg_cron'da.
  //
  // İş `date < CURRENT_DATE - N` olan satırları siler, yani N gün öncesinin satırı o gece
  // DURUR: bir satır en çok ~N+1 gün yaşar (gün başında yazılan satır, gece işi
  // günde bir koştuğu için). Metin N diyorsa anma değeri doğrudur, N+1 diyorsa kesin
  // doğrudur; ikisi de kabul. Bunun dışına çıkan her fark (iş 30 günde siler, metin
  // 7 der) söz ile kodun ayrışmasıdır.
  it("IP adresinin saklama süresi, kota tablosunu temizleyen işle UYUŞUR", () => {
    const purge = migrations.filter((file) => read(file).includes("lens-purge-extraction-quota")).at(-1);
    expect(purge, "kota temizliğini kuran migration").toBeDefined();

    const job = /cron\.schedule\('lens-purge-extraction-quota'[\s\S]*?CURRENT_DATE - (\d+)/.exec(read(purge!));
    const text = /IP adresi (\d+) gün sonra silinir\./.exec(legalPage);
    expect(job, "cron işindeki gün sayısı").not.toBeNull();
    expect(text, "metindeki gün sayısı").not.toBeNull();

    const cutoff = Number(job![1]);
    const promised = Number(text![1]);
    expect(promised, `iş ${cutoff} günden eskiyi siliyor, metin ${promised} gün diyor`).toBeGreaterThanOrEqual(cutoff);
    expect(promised, `iş ${cutoff} günden eskiyi siliyor, metin ${promised} gün diyor`).toBeLessThanOrEqual(cutoff + 1);
  });

  // Davranış (60. dakikada geçersizleşme) pendingReport / pendingLibrary /
  // transferConsent testlerinde sabit; burada metnin aynı sayıyı söylediği sınanır.
  it("giriş öncesi taslakların ömrü metinde 60 dakika olarak geçer", () => {
    expect(legalPage).toMatch(/yalnızca kendi tarayıcında durur ve 60 dakika sonra geçersizleşir/);
    expect(legalPage).toMatch(/lifetime: "[^"]*60 dakika sonra geçersizleşir\."/);
    for (const file of ["src/lib/pendingReport.ts", "src/lib/pendingLibrary.ts", "src/lib/transferConsent.ts"]) {
      expect(read(file), file).toMatch(/MAX_AGE_MS = 60 \* 60 \* 1000/);
    }
  });

  // Davranışı extract-works testi sınar (veritabanına yalnızca kota sayacı için gidilir).
  it("metin, yüklenen görsel ve metnin SAKLANMADIĞINI söyler", () => {
    expect(legalPage).toMatch(/Ekran görüntüleri ve yapıştırdığın metinler saklanmaz\./);
  });
});

describe("kullanım ölçümü: bant, Hesabım'daki kart ve Çerez Politikası AYNI şeyi söyler", () => {
  const texts: [string, string][] = [
    ["rıza bandı", stripComments(read("src/app/components/AnalyticsConsent.tsx"))],
    ["Hesabım'daki kart", stripComments(read("src/pages/Account.tsx"))],
    ["Çerez Politikası", legalPage],
  ];

  it.each(texts)("%s uğranan ekranları ve dokunulan yerleri söyler", (_name, text) => {
    expect(text).toMatch(/uğradığın/);
    expect(text).toMatch(/dokunduğun/);
  });

  // Oturum kaydı kodda kapalı (`disable_session_recording`); açılırsa ÜÇ metin de
  // aynı commit'te ekran kaydını söylemek zorunda. Söylenmeyen şeye verilen rıza geçersizdir.
  it.each(texts)("%s ekran kaydından söz ETMEZ — çünkü kayıt alınmıyor", (_name, text) => {
    expect(stripComments(read("src/lib/posthog.ts"))).toMatch(/disable_session_recording: true/);
    expect(text).not.toMatch(/ekran\S*\s+kayd|ekran kaydı|session replay/i);
  });

  it.each(texts)("%s verinin yurt dışındaki PostHog sunucularına gittiğini söyler", (_name, text) => {
    expect(text).toMatch(/PostHog/);
  });

  // "Adın ve e-posta adresin oraya gönderilmez."
  it("PostHog'a kimlik olarak yalnızca hesap numarası gider; hiçbir olay e-posta ya da ad taşımaz", () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      const code = stripComments(read(file));
      for (const match of code.matchAll(/posthog\.identify\(([^)]*)\)/g)) {
        if (file !== "src/lib/posthog.ts" && match[1].includes(",")) offenders.push(`${file}: identify(${match[1]})`);
      }
      for (const match of code.matchAll(/posthog\.capture\(([\s\S]*?)\);/g)) {
        if (/\b(e-?mail|full_name|given_name|user_metadata)\b/i.test(match[1])) offenders.push(`${file}: capture(${match[1].slice(0, 60)}…)`);
      }
    }
    expect(offenders).toEqual([]);
    expect(legalPage).toMatch(/adın ve e-posta adresin oraya gönderilmez/);
  });
});

describe("metinlerin dili", () => {
  // Premium anahtarı kapalıyken arayüz paket kelimelerini hiç kurmuyor; metinler de kurmaz.
  //
  // Sözcük sınırı (`\b`) BİLEREK yok: JS'te `\b` yalnızca ASCII harf tanır, "Ücretsiz"
  // ve ek almış "pakette" ondan kaçar. Kök aranır; çekimli hâller de yakalanır.
  it("'ücret / paket / premium' dili yok", () => {
    const text = `${legalPage}\n${stripComments(legalData)}`;
    expect(text.match(/[^\n]*(premium|ücret|paket)[^\n]*/giu) ?? []).toEqual([]);
  });

  it("üç metin de birbirine bağlantı verir", () => {
    for (const route of ["/privacy", "/cookies", "/terms"]) expect(legalPage).toContain(`to: "${route}"`);
  });
});

describe("giriş yolları ve rıza kutusu", () => {
  // Giriş başlatan her bileşen BİLEREK sınıflandırılır. "kutu": ilk rapor yolu — sinyaller
  // girişin hemen ardından Claude'a gider, girişten sonraki kapı orada yetişmez. "kapı":
  // yalnızca dönen kullanıcının yolu — kutu orada kayıtlı rızayı her girişte yeniden
  // soruyordu (20 Ekim 2026); rızası kayıtlı olmayanı `TransferConsentGate` yakalar.
  // Yeni bir giriş ekranı bu listeye kendi sınıfıyla girer.
  const STARTERS: Record<string, "kutu" | "kapı"> = {
    "src/app/components/EmailOptInModal.tsx": "kutu",
    "src/app/components/Login.tsx": "kapı",
  };

  it("giriş başlatan her bileşen sınıflandırılmıştır: rıza kutusunu taşır ya da rızayı kapıya bırakır", () => {
    const starters = srcFiles.filter(
      (file) => file !== "src/lib/supabase.ts" && /\b(sendMagicLink|signInWithGoogle)\(/.test(stripComments(read(file))),
    );
    expect(starters.sort()).toEqual(Object.keys(STARTERS).sort());

    for (const file of starters) {
      const code = stripComments(read(file));
      if (STARTERS[file] === "kutu") {
        expect(code, file).toContain("<TransferConsentField");
        expect(code, file).toContain("markPendingTransferConsent()");
      } else {
        // İşaret verilmiş bir rızanın kaydıdır; sorulmamış rızayı kapı sessizce kaydederdi.
        expect(code, file).not.toContain("markPendingTransferConsent");
      }
    }
  });

  it("Supabase'in giriş çağrıları yalnızca `src/lib/supabase.ts`'te durur", () => {
    const direct = srcFiles.filter((file) => /\.auth\.signInWith(Otp|OAuth|Password|IdToken)/.test(stripComments(read(file))));
    expect(direct).toEqual(["src/lib/supabase.ts"]);
  });

  // İki yerde iki ayrı cümleye verilen rıza, hangisine verildiği belli olmayan rızadır.
  it("rıza cümlesi tek bir bileşende yazılıdır", () => {
    const withSentence = srcFiles.filter((file) => /açık rıza veriyorum/.test(stripComments(read(file))));
    expect(withSentence).toEqual(["src/app/components/TransferConsent.tsx"]);
  });

  it("kapı ve analitik bandı rotaların DIŞINDA durur; metin sayfaları oturumsuz rotalardır", () => {
    const app = read("src/app/App.tsx");
    const routesEnd = app.indexOf("</Routes>");
    expect(routesEnd).toBeGreaterThan(0);
    expect(app.indexOf("<TransferConsentGate />")).toBeGreaterThan(routesEnd);
    expect(app.indexOf("<AnalyticsConsentBanner />")).toBeGreaterThan(routesEnd);
    for (const route of ["/privacy", "/cookies", "/terms"]) expect(app).toContain(`<Route path="${route}"`);
  });
});

describe("rıza kaydı: istemci ↔ `user_consents` tablosu", () => {
  const migrations = walk("supabase/migrations", (file) => /\/\d{14}_[^/]+\.sql$/.test(file)).sort();
  const sql = (file: string) => read(file).replace(/--.*$/gm, "");
  const table = sql(migrations.find((file) => /CREATE TABLE IF NOT EXISTS public\.user_consents/.test(read(file)))!);
  const client = stripComments(read("src/lib/transferConsent.ts"));

  it("istemcinin yazdığı rıza türü tablonun kabul ettiği türlerdendir", () => {
    const kind = /const KIND = "([^"]+)"/.exec(client)![1];
    const allowed = /CHECK \(kind IN \(([^)]*)\)\)/.exec(table)![1];
    expect(allowed).toContain(`'${kind}'`);
  });

  // `ignoreDuplicates` ancak çakışma hedefi birincil anahtarla aynıysa "ilk kayıt kalır" demektir.
  it("upsert'in çakışma hedefi tablonun birincil anahtarıdır", () => {
    const primaryKey = /PRIMARY KEY \(([^)]*)\)/.exec(table)![1].replace(/\s+/g, "");
    const onConflict = /onConflict: "([^"]+)"/.exec(client)![1];
    expect(onConflict).toBe(primaryKey);
    expect(client).toMatch(/ignoreDuplicates: true/);
  });

  it("rıza metni sürümü tablonun uzunluk kısıtına sığar", () => {
    const [, min, max] = /length\(version\) BETWEEN (\d+) AND (\d+)/.exec(table)!;
    expect(consentVersion.length).toBeGreaterThanOrEqual(Number(min));
    expect(consentVersion.length).toBeLessThanOrEqual(Number(max));
  });

  // Damga client'ın yazabildiği bir kolona bırakılsaydı oraya istediği tarihi koyabilirdi.
  it("zaman damgasını trigger vurur", () => {
    expect(table).toMatch(/NEW\.granted_at := now\(\)/);
    expect(table).toMatch(/BEFORE INSERT ON public\.user_consents/);
  });

  // Verilmiş bir rızanın kaydı sonradan oynanamaz, kullanıcı tarafından bile.
  it("hiçbir migration `user_consents`'e UPDATE / DELETE politikası açmaz", () => {
    const operations = new Set<string>();
    for (const file of migrations) {
      for (const match of sql(file).matchAll(/CREATE POLICY[^;]*?ON\s+(?:public\.)?user_consents\s+(?:AS\s+\w+\s+)?FOR\s+(\w+)/gi)) {
        operations.add(match[1].toUpperCase());
      }
    }
    expect([...operations].sort()).toEqual(["INSERT", "SELECT"]);
  });

  // Rızanın geri alınması = hesabın silinmesi; satır hesapla birlikte gider.
  it("rıza satırı hesapla birlikte silinir (CASCADE)", () => {
    expect(table).toMatch(/user_id\s+UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });
});
