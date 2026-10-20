import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md'deki "Kritik kurallar"ın kodla denetlenebilen kısmı. Bunlar davranış
 * testi değil, KAYNAK taraması: her biri en az bir kez canlıya hata olarak çıkmış
 * ya da çıkması tek satırlık bir dikkatsizliğe bakan bir kural.
 *
 * Bir kural bilerek değişirse test de CLAUDE.md ile BİRLİKTE güncellenir.
 */
const ROOT = process.cwd();
const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");
const read = (file: string) => readFileSync(path.resolve(ROOT, file), "utf8");

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  const abs = path.resolve(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(rel(full))) out.push(rel(full));
  }
  return out;
}

/** Yorumları atar: kural adları yorumlarda serbestçe geçebilir. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const isCode = (file: string) => /\.(ts|tsx)$/.test(file);
const srcFiles = walk("src", isCode);
const apiFiles = walk("api", isCode);
const edgeFiles = walk("supabase/functions", isCode);

describe("api/ — Vercel fonksiyonları", () => {
  it("taranacak dosya var (tarama boş dizinde sessizce geçmesin)", () => {
    expect(apiFiles.length).toBeGreaterThanOrEqual(8);
    expect(srcFiles.length).toBeGreaterThan(30);
    expect(edgeFiles.length).toBeGreaterThanOrEqual(12);
  });

  // Vercel import yolundaki uzantıyı yeniden yazmıyor: kaynakta `.ts` kalırsa
  // production'da ERR_MODULE_NOT_FOUND → 500. Bu bir kez canlıya böyle çıktı.
  it("yerel importlar `.js` uzantısıyla yazılır", () => {
    const offenders: string[] = [];
    for (const file of apiFiles) {
      for (const match of stripComments(read(file)).matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        if (!match[1].endsWith(".js")) offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // `api/` altındaki her .ts dosyası bir endpoint olur; test dosyası da olurdu.
  it("alt çizgiyle başlamayan her dosya bir handler'dır; test dosyası yoktur", () => {
    const endpoints = apiFiles.filter((file) => !file.split("/").some((part) => part.startsWith("_")));
    expect(endpoints.sort()).toEqual(["api/og/[reportId].ts", "api/poster/[reportId].ts", "api/report-preview.ts"]);
    for (const file of endpoints) expect(read(file), file).toMatch(/export default async function handler/);
    expect(apiFiles.filter((file) => /\.(test|spec)\./.test(file))).toEqual([]);
  });

  it("poster fontları depoda durur ve Vercel paketine dahil edilir", () => {
    for (const font of ["PlayfairDisplay-Italic-700.ttf", "Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf"]) {
      expect(existsSync(path.resolve(ROOT, "api/_assets/fonts", font)), font).toBe(true);
    }
    const vercel = JSON.parse(read("vercel.json"));
    expect(vercel.functions["api/**/*.ts"].includeFiles).toBe("api/_assets/**");
  });
});

describe("sırlar ve yetkili anahtarlar", () => {
  // ANTHROPIC_API_KEY ve SUPABASE_SERVICE_ROLE_KEY yalnızca edge function ortamında yaşar.
  it("istemci (`src/`) ve Vercel (`api/`) kodu hiçbir sunucu sırrını okumaz", () => {
    const secret = /SERVICE_ROLE|ANTHROPIC_API_KEY|RESEND_API_KEY|WEEKLY_PICKS_SECRET|UNSUBSCRIBE_SECRET|WATCH_API_KEY/;
    const offenders = [...srcFiles, ...apiFiles].filter((file) => secret.test(stripComments(read(file))));
    expect(offenders).toEqual([]);
  });

  it("depoda Anthropic / Supabase service anahtarına benzeyen bir değer yok", () => {
    const looksLikeKey = /sk-ant-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9]{24,}|service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,}/;
    const tracked = [...srcFiles, ...apiFiles, ...edgeFiles, ...walk("scripts", () => true), ...walk("tests", isCode)];
    expect(tracked.filter((file) => looksLikeKey.test(read(file)))).toEqual([]);
  });

  // Yeni env değişkeni eklenecekse `.env.example`'a belgelenir.
  it("istemcinin okuduğu her VITE_ değişkeni `.env.example`'da belgelidir", () => {
    const documented = read(".env.example");
    const used = new Set<string>();
    for (const file of srcFiles) {
      for (const match of read(file).matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(documented, name).toMatch(new RegExp(`^${name}=`, "m"));
  });
});

describe("analitik rıza kapısı", () => {
  // Kapının etrafından dolaşan tek bir `capture`, rızasız veri göndermek demektir.
  it("`posthog-js` yalnızca `src/lib/posthog.ts`'ten import edilir", () => {
    const importers = srcFiles.filter((file) => /from\s+["']posthog-js["']|import\(["']posthog-js["']\)/.test(read(file)));
    expect(importers).toEqual(["src/lib/posthog.ts"]);
  });
});

describe("rapor gizliliği", () => {
  // Açık raporları tablodan okumak tabloyu LİSTELENEBİLİR yapıyordu (14789e7).
  it("`reports` tablosuna yalnızca `src/lib/supabase.ts` dokunur (sahibinin kendi satırları)", () => {
    const readers = [...srcFiles, ...apiFiles].filter((file) => /from\(\s*["']reports["']\s*\)/.test(stripComments(read(file))));
    expect(readers).toEqual(["src/lib/supabase.ts"]);
  });

  it("rapor kimliğiyle `lens_report_by_id` üzerinden okunur", () => {
    expect(stripComments(read("src/lib/supabase.ts"))).toContain('rpc("lens_report_by_id"');
    expect(stripComments(read("api/_lib/report.ts"))).toContain('rpc("lens_report_by_id"');
  });
});

describe("paket (premium anahtarı)", () => {
  // Kolonu okuyan tek bir yeni yer anahtarı deler; web `lens_entitlements` okur.
  it("`user_preferences.plan` kolonunu istemci kodu seçmez", () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      for (const match of stripComments(read(file)).matchAll(/\.select\(\s*(["'`])([^"'`]*)\1/g)) {
        if (/\bplan\b/.test(match[2])) offenders.push(`${file}: select("${match[2]}")`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("edge function'lar", () => {
  const generators = [
    "supabase/functions/analyze/index.ts",
    "supabase/functions/daily-discovery/index.ts",
    "supabase/functions/generate-weekly-picks/prompt.ts",
  ];

  // Kopyalama, import et: birinde gevşerse sızıntı oradan olur.
  it.each(generators)("%s hassas çıkarım kuralını İMPORT eder, kopyalamaz", (file) => {
    const code = read(file);
    expect(code).toMatch(/import \{ SENSITIVE_INFERENCE_RULE \} from "\.\.\/_shared\/sensitive\.ts"/);
    expect(code).toContain("${SENSITIVE_INFERENCE_RULE}");
    expect(code).not.toContain("## HASSAS ÇIKARIM YOK");
  });

  // Çıplak bir [functions] bloğu bütün fonksiyonların korumasını birden kaldırır.
  it("`verify_jwt = false` YALNIZCA `unsubscribe` için açıktır", () => {
    const toml = read("supabase/config.toml").replace(/^\s*#.*$/gm, "");
    const tables = [...toml.matchAll(/^\[([^\]]+)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map((m) => ({
      name: m[1],
      body: m[2],
    }));
    const open = tables.filter((t) => /verify_jwt\s*=\s*false/.test(t.body)).map((t) => t.name);

    expect(open).toEqual(["functions.unsubscribe"]);
    expect(tables.map((t) => t.name)).not.toContain("functions");
  });

  // Üretim ile gönderim arıza alanı olarak ayrı: gönderen film seçmez.
  it("`send-weekly-picks` Claude'u ve erişilebilirlik istemcisini içermez", () => {
    for (const file of ["supabase/functions/send-weekly-picks/index.ts", "supabase/functions/send-weekly-picks/email.ts"]) {
      const code = stripComments(read(file));
      expect(code, file).not.toMatch(/api\.anthropic\.com|_shared\/watch\.ts|ANTHROPIC_API_KEY|WATCH_API_KEY/);
    }
    expect(stripComments(read("supabase/functions/generate-weekly-picks/index.ts"))).not.toMatch(/RESEND_API_KEY|api\.resend\.com/);
  });

  // Tablo tablo DELETE yazılırsa ikinci liste ilk yeni tabloda eskir.
  it("`delete-account` veriyi kendisi silmez (CASCADE + trigger'a bırakır)", () => {
    const code = stripComments(read("supabase/functions/delete-account/index.ts"));
    expect(code).not.toMatch(/\.from\(|\.delete\(/);
    expect(code).toContain("auth.admin.deleteUser(user.id)");
  });
});

describe("rotalar (BUG-01 dersi: rota silinmez, yönlendirilir)", () => {
  const app = read("src/app/App.tsx");
  const redirect = (from: string, to: string) =>
    new RegExp(`<Route\\s+path="${from}"\\s+element=\\{<Navigate\\s+to="${to}"\\s+replace\\s*/>\\}`);

  it.each([
    ["/books", "/start"],
    ["/movies", "/start"],
    ["/music", "/start"],
    // Yayına çıkmış haftalık seçki maillerinde bu adres var.
    ["/settings", "/account"],
    // Telegram bağlama sayfasıydı; botun eski mesajlarında bu adres var.
    ["/connect", "/"],
  ])("eski %s rotası %s'a yönlenir", (from, to) => {
    expect(app).toMatch(redirect(from, to));
  });

  it.each(["/", "/start", "/generating", "/report/:id", "/dashboard", "/dashboard/reports", "/dashboard/list", "/account", "/auth/callback", "/login"])(
    "%s rotası tanımlıdır",
    (route) => {
      expect(app).toContain(`path="${route}"`);
    },
  );

  it("rota dili İngilizcedir: `/rapor` geri gelmemiştir", () => {
    expect(app).not.toMatch(/path="\/rapor/);
    expect(srcFiles.filter((file) => /["'`]\/rapor\//.test(stripComments(read(file))))).toEqual([]);
  });
});

describe("vercel.json — link önizlemesi", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const preview = vercel.rewrites.find((r: { destination: string }) => r.destination.startsWith("/api/report-preview"));
  const crawler = new RegExp(preview.has[0].value);
  const spa = vercel.rewrites.find((r: { destination: string }) => r.destination === "/index.html");

  it("yalnızca `/report/:id` crawler'a özel HTML'e gider", () => {
    expect(preview.source).toBe("/report/:id");
    expect(preview.destination).toBe("/api/report-preview?id=:id");
    expect(preview.has[0]).toMatchObject({ type: "header", key: "user-agent" });
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "Twitterbot/1.0",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  ])("sosyal crawler tanınır: %s", (ua) => {
    expect(crawler.test(ua)).toBe(true);
  });

  // Gerçek kullanıcı ve Googlebot her zamanki SPA'yı alır.
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ])("gerçek tarayıcı ve Googlebot crawler SAYILMAZ: %s", (ua) => {
    expect(crawler.test(ua)).toBe(false);
  });

  it("SPA yönlendirmesi `/api/` yollarını yutmaz ve crawler kuralından SONRA gelir", () => {
    const source = new RegExp(`^${spa.source}$`);
    expect(source.test("/report/abc")).toBe(true);
    expect(source.test("/dashboard/list")).toBe(true);
    expect(source.test("/api/og/abc")).toBe(false);
    expect(source.test("/api/poster/abc")).toBe(false);
    expect(vercel.rewrites.indexOf(preview)).toBeLessThan(vercel.rewrites.indexOf(spa));
  });
});

/**
 * Migration kuralları İLERİYE DÖNÜK: eski dosyalar tarihsel kayıttır ve düzeltmeleri
 * sonraki migration'larda yapıldı. Kural, düzeltmenin geldiği dosyadan SONRA yazılan
 * her migration için geçerli.
 */
describe("migration'lar", () => {
  const migrations = walk("supabase/migrations", (file) => /\/\d{14}_[^/]+\.sql$/.test(file)).sort();
  const stamp = (file: string) => file.match(/\/(\d{14})_/)![1];
  const after = (cutoff: string) => migrations.filter((file) => stamp(file) > cutoff);
  const sql = (file: string) => read(file).replace(/--.*$/gm, "");

  it("zaman damgalı adlandırma kuralına uyan migration'lar bulunur", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(10);
    expect(migrations.some((file) => file.includes("20261010120000_account_deletion"))).toBe(true);
  });

  // Biri atlanırsa hesap silme ya hata verir ya da sessizce eksik kalır.
  it("hesap silmeden sonraki her `auth.users` bağlantısı ON DELETE CASCADE taşır", () => {
    const offenders: string[] = [];
    for (const file of after("20261010120000")) {
      for (const match of sql(file).matchAll(/REFERENCES\s+auth\.users\s*\([^)]*\)([^,;\n]*)/gi)) {
        if (!/ON\s+DELETE\s+CASCADE/i.test(match[1])) offenders.push(`${file}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // `anon`'da da auth.uid() NULL'dır; o yüklem oturumsuz çağıranı service_role sanar.
  // Bu hata iki kez canlıya çıktı. Doğrusu: lens_private.lens_may_act_for(p_user_id).
  it("yetki düzeltmesinden sonra `auth.uid() IS NULL OR ...` yüklemi yazılmaz", () => {
    const offenders = after("20261011093000").filter((file) => /auth\.uid\(\)\s+IS\s+NULL\s+OR/i.test(sql(file)));
    expect(offenders).toEqual([]);
  });

  // RLS satıra bakar, isteğe değil: o politika açık raporların tamamını tek istekte veriyordu.
  it("`reports`'a `is_public` koşullu bir SELECT politikası GERİ EKLENMEZ", () => {
    const offenders = after("20261011090000").filter((file) =>
      /CREATE\s+POLICY[\s\S]{0,200}?\bON\s+(public\.)?reports\b[\s\S]{0,200}?FOR\s+SELECT[\s\S]{0,300}?is_public/i.test(sql(file)),
    );
    expect(offenders).toEqual([]);
  });
});
