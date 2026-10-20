import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTROLLER,
  LEGAL_DRAFT,
  PROCESSORS,
  TRANSFER_CONSENT_VERSION,
  TRANSFER_COUNTRIES,
} from "@/lib/legal";

/**
 * Her rıza sürümünün kapsadığı aktarım. Sürüm YALNIZCA kapsam değişince yükselir
 * (yeni ülke, yeni alıcı türü, verinin niteliği): kapsam değişip sürüm aynı
 * kalırsa kimseye yeniden sorulmaz ve eski rıza yeni aktarımı örtmüş sayılır;
 * yazım düzeltmesinde yükselirse herkese boş yere sorulur.
 *
 * Aşağıdaki test düşerse ikisinden biri olmuştur. Kapsam gerçekten değiştiyse
 * `TRANSFER_CONSENT_VERSION`'ı yükselt ve buraya yeni bir satır ekle — eski
 * satırlar SİLİNMEZ, hangi sürümün neye rıza olduğunun kaydıdır.
 */
const SCOPE_BY_VERSION: Record<string, { sentence: string; destinations: string[] }> = {
  "2026-10-11": { sentence: "Güney Kore ve ABD", destinations: ["ABD", "Güney Kore"] },
};
import { WEEKLY_PICKS_EMAIL_PAUSED } from "@/lib/preferences";
import { hasTransferConsent, markPendingTransferConsent, recordTransferConsent } from "@/lib/transferConsent";
import { fakeSupabase, type QueryCall, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

const PENDING_KEY = "lens_pending_consent";
const MINUTE = 60 * 1000;

/** `user_consents`: okuma `existing`'i, yazma `write`'ı döner. */
function setup(options: { existing?: QueryResult; write?: QueryResult } = {}) {
  const fake = fakeSupabase({
    tables: {
      user_consents: (q: QueryCall) => (q.has("upsert") ? (options.write ?? { data: null }) : (options.existing ?? { data: null })),
    },
  });
  useWebSupabase(fake.client);
  return fake;
}

const writes = (fake: ReturnType<typeof setup>) => fake.callsTo("user_consents").filter((q) => q.has("upsert"));

beforeEach(() => {
  localStorage.clear();
});

describe("recordTransferConsent", () => {
  it("rızayı kullanıcı + tür + metin sürümüyle yazar; aynı sürüm ikinci kez yazılırsa ilk kayıt kalır", async () => {
    const fake = setup();

    expect(await recordTransferConsent("user-1")).toBe(true);

    const [write] = writes(fake);
    expect(write.arg("upsert", 0)).toEqual({ user_id: "user-1", kind: "transfer_abroad", version: TRANSFER_CONSENT_VERSION });
    expect(write.arg("upsert", 1)).toEqual({ onConflict: "user_id,kind,version", ignoreDuplicates: true });
  });

  // Damga client'ın yazabildiği bir alana bırakılsaydı oraya istediği tarihi koyabilirdi.
  it("zaman damgasını GÖNDERMEZ — onu sunucu vurur", async () => {
    const fake = setup();
    await recordTransferConsent("user-1");
    expect(Object.keys(writes(fake)[0].arg<object>("upsert", 0)!)).not.toContain("granted_at");
  });

  it("başarıda giriş ekranından taşınan işareti temizler; hatada bırakır", async () => {
    markPendingTransferConsent();
    setup({ write: { error: { message: "rls" } } });
    expect(await recordTransferConsent("user-1")).toBe(false);
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();

    setup();
    expect(await recordTransferConsent("user-1")).toBe(true);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("hasTransferConsent", () => {
  it("güncel sürümde kaydı olan kullanıcıya sorulmaz", async () => {
    const fake = setup({ existing: { data: { version: TRANSFER_CONSENT_VERSION } } });

    expect(await hasTransferConsent("user-1")).toBe(true);

    const lookup = fake.callsTo("user_consents")[0];
    expect(lookup.ops.filter((op) => op.method === "eq").map((op) => op.args)).toEqual([
      ["user_id", "user-1"],
      ["kind", "transfer_abroad"],
      ["version", TRANSFER_CONSENT_VERSION],
    ]);
    expect(writes(fake)).toHaveLength(0);
  });

  it("kaydı da işareti de yoksa SORULMASI gerekir; hiçbir şey yazılmaz", async () => {
    const fake = setup();
    expect(await hasTransferConsent("user-1")).toBe(false);
    expect(writes(fake)).toHaveLength(0);
  });

  // Rıza girişten ÖNCE alınır; o anda kullanıcı yoktur, kayıt giriş dönüşünde yazılır.
  it("giriş ekranında verilen rıza giriş dönüşünde kaydedilir", async () => {
    markPendingTransferConsent();
    const fake = setup();

    expect(await hasTransferConsent("user-1")).toBe(true);

    expect(writes(fake)).toHaveLength(1);
    expect(writes(fake)[0].arg<{ user_id: string }>("upsert", 0)!.user_id).toBe("user-1");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("işaret var ama kayıt yazılamazsa rıza VAR sayılmaz ve işaret sonraki deneme için kalır", async () => {
    markPendingTransferConsent();
    setup({ write: { error: { message: "network" } } });

    expect(await hasTransferConsent("user-1")).toBe(false);
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("60 dakikayı dolduran işaret bayattır: yeniden sorulur", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    markPendingTransferConsent();

    setup();
    vi.setSystemTime(new Date("2026-10-11T10:59:59Z"));
    expect(await hasTransferConsent("user-1")).toBe(true);

    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    markPendingTransferConsent();
    vi.setSystemTime(new Date("2026-10-11T11:00:00Z"));
    const fake = setup();
    expect(await hasTransferConsent("user-1")).toBe(false);
    expect(writes(fake)).toHaveLength(0);
  });

  // Kapsam değişince sürüm değişir; eski metne verilen rıza yenisine sayılmaz.
  it("BAŞKA bir metin sürümü için verilmiş işaret geçersizdir", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: "2025-01-01", at: Date.now() }));
    const fake = setup();

    expect(await hasTransferConsent("user-1")).toBe(false);
    expect(writes(fake)).toHaveLength(0);
  });

  it.each([
    ["bozuk JSON", "{bozuk"],
    ["zaman damgasız", JSON.stringify({ version: TRANSFER_CONSENT_VERSION })],
    ["metin zaman damgası", JSON.stringify({ version: TRANSFER_CONSENT_VERSION, at: "şimdi" })],
  ])("geçersiz işaret (%s) rıza sayılmaz", async (_label, stored) => {
    localStorage.setItem(PENDING_KEY, stored);
    setup();
    expect(await hasTransferConsent("user-1")).toBe(false);
  });

  // Tablo yokken ya da ağ koptuğunda herkesi kapının arkasında bırakmak daha kötü.
  it("kayıt OKUNAMAZSA kapı açık kalır (fail-open) ve hata loglanır", async () => {
    markPendingTransferConsent();
    const fake = setup({ existing: { error: { message: "relation does not exist" } } });

    expect(await hasTransferConsent("user-1")).toBe(true);

    expect(console.error).toHaveBeenCalledWith("[transfer-consent] okunamadı:", { message: "relation does not exist" });
    // Okunamayan kayıt, verilmiş rıza değildir: uydurma bir satır yazılmaz.
    expect(writes(fake)).toHaveLength(0);
  });
});

describe("markPendingTransferConsent", () => {
  it("kararı güncel metin sürümü ve zamanıyla saklar", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));

    markPendingTransferConsent();

    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({
      version: TRANSFER_CONSENT_VERSION,
      at: new Date("2026-10-11T10:00:00Z").getTime(),
    });
  });

  it("depolama yazamıyorsa fırlatmaz (girişten sonra kapı sorar)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => markPendingTransferConsent()).not.toThrow();
  });
});

describe("legal.ts — beyanların iç tutarlılığı", () => {
  // `user_consents.version` kolonu 1-32 karakter (CHECK).
  it("rıza metni sürümü veritabanı kısıtına sığar ve tarih biçimindedir", () => {
    expect(TRANSFER_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TRANSFER_CONSENT_VERSION.length).toBeLessThanOrEqual(32);
  });

  it("rıza sürümü, rıza verilen kapsamla (ülkeler) BİRLİKTE değişir", () => {
    const scope = SCOPE_BY_VERSION[TRANSFER_CONSENT_VERSION];
    expect(scope, `${TRANSFER_CONSENT_VERSION} sürümünün kapsamı SCOPE_BY_VERSION'da kayıtlı değil`).toBeDefined();
    expect(TRANSFER_COUNTRIES).toBe(scope.sentence);
    expect([...new Set(PROCESSORS.map((p) => p.country))].sort()).toEqual(scope.destinations);
  });

  it("yayındaki metinler taslak DEĞİLDİR: veri sorumlusunun adı ve başvuru e-postası girilmiş", () => {
    expect(LEGAL_DRAFT).toBe(false);
  });

  // Kimliği belli olmayan bir veri sorumlusunun aydınlatma metni aydınlatma sayılmaz.
  // (Adres bilerek boş olabilir: kanun kimliği ister, adresi değil.)
  it("metinler taslak DEĞİLSE veri sorumlusunun adı ve geçerli bir başvuru e-postası vardır", () => {
    if (LEGAL_DRAFT) {
      expect(!CONTROLLER.name || !CONTROLLER.email).toBe(true);
      return;
    }
    expect(CONTROLLER.name.trim()).not.toBe("");
    expect(CONTROLLER.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("her hizmet sağlayıcı satırı eksiksizdir ve adlar tekildir", () => {
    for (const processor of PROCESSORS) {
      for (const field of ["name", "purpose", "data", "country"] as const) {
        expect(processor[field].trim(), `${processor.name}.${field}`).not.toBe("");
      }
    }
    expect(new Set(PROCESSORS.map((p) => p.name)).size).toBe(PROCESSORS.length);
  });

  // Rıza cümlesindeki ülkeler tabloyla BİRLİKTE değişir.
  it("tablodaki her ülke rıza cümlesinde geçer", () => {
    for (const processor of PROCESSORS) expect(TRANSFER_COUNTRIES, processor.name).toContain(processor.country);
  });

  // Kodun kişisel veri yolladığı her dış servis burada sayılmalı.
  it.each(["Supabase", "Anthropic", "Vercel", "Google", "Resend", "PostHog"])("%s tabloda yer alır", (service) => {
    expect(PROCESSORS.some((p) => p.name.includes(service))).toBe(true);
  });

  it("Resend satırındaki 'gönderilmiyor' notu mail kanalının durumunu izler", () => {
    const resend = PROCESSORS.find((p) => p.name === "Resend")!;
    expect(Boolean(resend.note)).toBe(WEEKLY_PICKS_EMAIL_PAUSED);
  });
});
