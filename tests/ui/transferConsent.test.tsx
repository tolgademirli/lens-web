import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailOptInModal } from "@/app/components/EmailOptInModal";
import { Login } from "@/app/components/Login";
import { TransferConsentGate } from "@/app/components/TransferConsent";
import { Welcome } from "@/app/components/Welcome";
import { TRANSFER_CONSENT_VERSION, TRANSFER_COUNTRIES } from "@/lib/legal";
import { sendMagicLink, signInWithGoogle } from "@/lib/supabase";
import { markPendingTransferConsent } from "@/lib/transferConsent";
import { fakeSupabase, type QueryCall, type QueryResult } from "../helpers/fake-supabase";
import { button, click, currentPath, hasButton, mount, pageText, press, query, type, unmountAll } from "../helpers/render";
import { useWebSupabase } from "../helpers/web-supabase";

/**
 * Yurt dışı aktarımına açık rıza (KVKK m.9) — KAPI testleri.
 *
 * İki yol var. İLK RAPOR YOLUNDA e-posta "bağlantı gönder"e basıldığı an yurt
 * dışındaki sunucuya gider ve sinyaller girişin hemen ardından Claude'a gönderilir;
 * rıza ikisinden ÖNCE alınır: kutu işaretsiz gelir, işaretlenmeden giriş başlamaz.
 * DÖNEN KULLANICININ GİRİŞİNDE kutu yok — kimin girdiğini bilmeden her seferinde
 * kayıtlı rızayı yeniden soruyordu (20 Ekim 2026). Orada rızayı girişten sonraki
 * kapı sorar, yalnızca kaydı olmayana; kapı çıkış yolunu (hesap silme) ve metinleri
 * örtmez.
 */
vi.mock("@/lib/supabase", async () => {
  const { supabaseModuleMock } = await import("../helpers/web-supabase");
  const mocked = supabaseModuleMock() as { supabase: { auth: { getSession(): Promise<{ data: { session: { user: unknown } | null } }> } } };
  return {
    ...mocked,
    sendMagicLink: vi.fn(async () => ({ error: null })),
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    // Gerçeğiyle aynı: oturum, testin verdiği sahte istemciden okunur.
    getCurrentUser: async () => (await mocked.supabase.auth.getSession()).data.session?.user ?? null,
  };
});

const PENDING_KEY = "lens_pending_consent";
const MISSING = "Devam edebilmem için bu izne ihtiyacım var.";

const checkbox = () => query<HTMLButtonElement>('[role="checkbox"]');
const hasCheckbox = () => document.querySelector('[role="checkbox"]') !== null;
const isChecked = () => checkbox().getAttribute("aria-checked") === "true";
const emailInput = () => query<HTMLInputElement>('input[type="email"]');
const pending = () => JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { version: string; at: number } | null;

beforeEach(() => {
  localStorage.clear();
  useWebSupabase(fakeSupabase().client);
});

afterEach(async () => {
  await unmountAll();
});

describe("rıza kutusu (TransferConsentField)", () => {
  const openReportModal = () => mount(<EmailOptInModal open onOpenChange={() => {}} />, { route: "/start" });

  it("aktarımı ve ülkeleri AÇIKÇA söyler; ülkeler legal.ts'ten gelir", async () => {
    await openReportModal();
    expect(pageText()).toContain(
      `Verilerimin, Lens'in çalışması için yurt dışındaki (${TRANSFER_COUNTRIES}) hizmet sağlayıcılara aktarılmasına açık rıza veriyorum.`,
    );
  });

  // Giriş penceresi /start'ın üstünde duruyor; aynı sekmede gitmek yarım girişi kaldırırdı.
  it("Aydınlatma Metni ve Kullanım Koşulları'na YENİ SEKMEDE açılan bağlantı verir", async () => {
    await openReportModal();
    for (const href of ["/privacy", "/terms"]) {
      expect(query<HTMLAnchorElement>(`a[href="${href}"]`).target).toBe("_blank");
    }
  });

  // İki yerde iki ayrı cümleye verilen rıza, hangisine verildiği belli olmayan rızadır.
  it("giriş penceresinde ve girişten sonraki kapıda AYNI cümleyle durur", async () => {
    await openReportModal();
    const inModal = query("label").textContent;
    await unmountAll();

    useWebSupabase(fakeSupabase({ user: { id: "user-1" }, tables: { user_consents: { data: null } } }).client);
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    expect(query("label").textContent).toBe(inModal);
  });
});

// Dönen kullanıcının giriş sayfası: kutu kimin girdiğini bilmeden her seferinde kayıtlı
// rızayı yeniden soruyordu. Rızası kayıtlı olmayanı girişten sonraki kapı yakalar.
describe("Login — /login, dönen kullanıcı", () => {
  it("rıza kutusu YOK", async () => {
    await mount(<Login />, { route: "/login" });
    expect(hasCheckbox()).toBe(false);
  });

  // İşaret verilmiş bir rızanın kaydıdır: yazılsaydı kapı sorulmamış rızayı sessizce kaydederdi.
  it("Google girişi doğrudan başlar; rıza işareti YAZILMAZ", async () => {
    await mount(<Login />, { route: "/login" });

    await click(button("Google ile Devam Et"));

    expect(signInWithGoogle).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/auth/callback?intent=reports`);
    expect(pending()).toBeNull();
  });

  it("giriş bağlantısı doğrudan gönderilir; rıza işareti YAZILMAZ", async () => {
    await mount(<Login />, { route: "/login" });
    await type(emailInput(), "  biri@example.com ");

    await click(button("Giriş Bağlantısı Gönder"));

    expect(sendMagicLink).toHaveBeenCalledExactlyOnceWith(
      "biri@example.com",
      `${window.location.origin}/auth/callback?intent=reports`,
    );
    expect(pending()).toBeNull();
    expect(pageText()).toContain("Email'inizi kontrol edin");
  });
});

describe("EmailOptInModal — ana sayfadaki 'Giriş yap' (context=login), dönen kullanıcı", () => {
  const open = () => mount(<EmailOptInModal open onOpenChange={() => {}} context="login" />);

  it("rıza kutusu YOK", async () => {
    await open();
    expect(hasCheckbox()).toBe(false);
  });

  it("Google girişi doğrudan başlar; rıza işareti YAZILMAZ", async () => {
    await open();

    await click(button("Google ile Devam Et"));

    expect(signInWithGoogle).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/auth/callback`);
    expect(pending()).toBeNull();
  });

  it("e-posta yolu doğrudan açılır ve bağlantı gönderilir; rıza işareti YAZILMAZ", async () => {
    await open();
    await click(button("Email ile Devam Et"));
    await type(emailInput(), "biri@example.com");

    await click(button("Devam Et"));

    expect(sendMagicLink).toHaveBeenCalledExactlyOnceWith("biri@example.com", `${window.location.origin}/auth/callback`);
    expect(pending()).toBeNull();
  });
});

describe("Welcome — ana sayfadaki 'Giriş yap'", () => {
  const SIGN_IN = "Zaten hesabın var mı? Giriş yap →";
  const dialog = () => document.querySelector('[role="dialog"]');

  // Eskiden pencere oturum varken de açılıyordu: kişi zaten içerideyken yeniden giriş yapıyordu.
  it("oturumu açık olan doğrudan paneline gider; giriş penceresi AÇILMAZ", async () => {
    useWebSupabase(fakeSupabase({ user: { id: "user-1" } }).client);
    await mount(<Welcome />, { route: "/" });

    await click(button(SIGN_IN));

    expect(currentPath()).toBe("/dashboard");
    expect(dialog()).toBeNull();
  });

  it("oturum yoksa giriş penceresi açılır; rıza kutusu orada YOK", async () => {
    useWebSupabase(fakeSupabase({ user: null }).client);
    await mount(<Welcome />, { route: "/" });

    await click(button(SIGN_IN));

    expect(currentPath()).toBe("/");
    expect(dialog()).not.toBeNull();
    expect(hasCheckbox()).toBe(false);
  });
});

// Hesap açılmak üzere ve sinyaller girişin hemen ardından Claude'a gidiyor: kapı burada yetişmez.
describe("EmailOptInModal — ilk rapor yolu (/start)", () => {
  const open = () => mount(<EmailOptInModal open onOpenChange={() => {}} />);

  // Önceden işaretlenmiş kutu açık rıza sayılmaz.

  it("kutu İŞARETSİZ gelir", async () => {
    await open();
    expect(isChecked()).toBe(false);
  });

  it("kutu boşken Google girişi başlamaz ve tarayıcıya HİÇBİR şey yazılmaz", async () => {
    await open();

    await click(button("Google ile Devam Et"));

    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(pageText()).toContain(MISSING);
  });

  // Rıza, e-postanın yazılacağı ekrandan ÖNCE alınır: o ekrandaki düğme rızayı yeniden sormaz.
  it("kutu boşken e-posta formuna GEÇİLMEZ", async () => {
    await open();

    await click(button("Email ile Devam Et"));

    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(hasButton("Email ile Devam Et")).toBe(true);
    expect(pageText()).toContain(MISSING);
    expect(pending()).toBeNull();
  });

  it("kutu işaretlenince Google girişi başlar", async () => {
    await open();
    await click(checkbox());

    await click(button("Google ile Devam Et"));

    expect(signInWithGoogle).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/auth/callback`);
    expect(localStorage.getItem("lens_auth_method")).toBe("google");
    expect(pending()?.version).toBe(TRANSFER_CONSENT_VERSION);
  });

  it("işaret geri alınırsa giriş yine başlamaz", async () => {
    await open();
    await click(checkbox());
    await click(checkbox());
    expect(isChecked()).toBe(false);

    await click(button("Google ile Devam Et"));

    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(pending()).toBeNull();
  });

  it("uyarı kutu işaretlenince kaybolur", async () => {
    await open();
    await click(button("Google ile Devam Et"));
    expect(pageText()).toContain(MISSING);

    await click(checkbox());
    expect(pageText()).not.toContain(MISSING);
  });

  it("kutu işaretlenince e-posta yolu açılır ve bağlantı gönderilir", async () => {
    await open();
    await click(checkbox());
    await click(button("Email ile Devam Et"));
    await type(emailInput(), "biri@example.com");

    await click(button("Devam Et"));

    expect(sendMagicLink).toHaveBeenCalledExactlyOnceWith("biri@example.com", `${window.location.origin}/auth/callback`);
    expect(localStorage.getItem("lens_auth_method")).toBe("magic_link");
    expect(pending()?.version).toBe(TRANSFER_CONSENT_VERSION);
    expect(pageText()).toContain("Email'inizi kontrol edin");
  });

  it("e-posta formundan geri dönülüp işaret kaldırılırsa form yeniden AÇILMAZ", async () => {
    await open();
    await click(checkbox());
    await click(button("Email ile Devam Et"));
    await click(button("Geri"));
    await click(checkbox());

    await click(button("Email ile Devam Et"));

    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });
});

describe("TransferConsentGate — girişten SONRAKİ kapı", () => {
  const TITLE = "Devam etmeden önce bir izin";
  const dialog = () => document.querySelector('[role="alertdialog"]');

  /** Oturumu ve `user_consents`'in durumunu kurar. */
  function world(options: { user?: { id: string } | null; existing?: QueryResult; write?: QueryResult } = {}) {
    const fake = fakeSupabase({
      user: options.user === undefined ? { id: "user-1" } : options.user,
      tables: {
        user_consents: (q: QueryCall) =>
          q.has("upsert") ? (options.write ?? { data: null }) : (options.existing ?? { data: null }),
      },
    });
    useWebSupabase(fake.client);
    return fake;
  }
  const writes = (fake: ReturnType<typeof world>) => fake.callsTo("user_consents").filter((q) => q.has("upsert"));

  it("oturum yoksa sormaz ve kayda bakmaz", async () => {
    const fake = world({ user: null });
    await mount(<TransferConsentGate />, { route: "/dashboard" });

    expect(dialog()).toBeNull();
    expect(fake.callsTo("user_consents")).toHaveLength(0);
  });

  it("güncel sürümde rıza kaydı olana sormaz", async () => {
    world({ existing: { data: { version: TRANSFER_CONSENT_VERSION } } });
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    expect(dialog()).toBeNull();
  });

  // Bu kapıdan önce açılmış hesap, bağlantıyı başka cihazda açan, sürüm yükseldikten sonra dönen.
  it("oturumu olup rıza kaydı olmayana SORAR", async () => {
    world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });

    expect(dialog()).not.toBeNull();
    expect(pageText()).toContain(TITLE);
    expect(isChecked()).toBe(false);
  });

  // Rıza vermek istemeyenin çıkışı hesap silme (/account) ve o yol hiçbir şeye bağlanamaz;
  // neye rıza verdiğini okumak isteyen de kapıya takılmamalı.
  it.each(["/account", "/privacy", "/terms", "/cookies"])("%s sayfasını ÖRTMEZ", async (route) => {
    world();
    await mount(<TransferConsentGate />, { route });
    expect(dialog()).toBeNull();
  });

  it.each(["/dashboard", "/dashboard/reports", "/dashboard/list", "/start", "/generating", "/report/abc", "/"])(
    "%s sayfasında sorulur",
    async (route) => {
      world();
      await mount(<TransferConsentGate />, { route });
      expect(dialog()).not.toBeNull();
    },
  );

  it("kutu boşken 'Devam et' kayıt YAZMAZ; neyin eksik olduğunu söyler", async () => {
    const fake = world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });

    await click(button("Devam et"));

    expect(writes(fake)).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(pageText()).toContain(MISSING);
  });

  it("kutu işaretlenip devam edilince rıza OTURUMDAKİ kullanıcı için kaydedilir ve kapı açılır", async () => {
    const fake = world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    await click(checkbox());

    await click(button("Devam et"));

    expect(writes(fake)).toHaveLength(1);
    expect(writes(fake)[0].arg("upsert", 0)).toEqual({
      user_id: "user-1",
      kind: "transfer_abroad",
      version: TRANSFER_CONSENT_VERSION,
    });
    expect(dialog()).toBeNull();
  });

  it("kayıt yazılamazsa kapı KAPALI kalır ve hata söylenir", async () => {
    world({ write: { error: { message: "network" } } });
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    await click(checkbox());

    await click(button("Devam et"));

    expect(dialog()).not.toBeNull();
    expect(pageText()).toContain("İznin kaydedilemedi.");
  });

  // AlertDialog: dışına tıklayınca ya da Esc ile kapanmaz. İki çıkış var, ikisi de ekranda.
  it("Esc ile kapatılamaz", async () => {
    world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });

    await press(document, "Escape");
    await press(dialog()!, "Escape");

    expect(dialog()).not.toBeNull();
  });

  it("'Çıkış yap' oturumu kapatır ve ana sayfaya götürür; rıza yazılmaz", async () => {
    const fake = world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });

    await click(button("Çıkış yap"));

    expect(fake.client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe("/");
    expect(writes(fake)).toHaveLength(0);
  });

  it("çıkış yolunu gösterir: hesap silme bağlantısı /account'a gider", async () => {
    world();
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    expect(query<HTMLAnchorElement>('[role="alertdialog"] a[href="/account"]').textContent).toBe("Hesabım");
  });

  // Kutuyu ilk rapor penceresinde işaretleyip aynı cihazda dönen kişi bu pencereyi hiç görmez.
  it("giriş penceresinde verilen rıza sessizce kaydedilir; pencere HİÇ açılmaz", async () => {
    markPendingTransferConsent();
    const fake = world();

    await mount(<TransferConsentGate />, { route: "/dashboard" });

    expect(writes(fake)).toHaveLength(1);
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  // Tablo yokken ya da ağ koptuğunda herkesi kapının arkasında bırakmak daha kötü.
  it("kayıt okunamazsa kapı AÇIK kalır (fail-open)", async () => {
    world({ existing: { error: { message: "relation does not exist" } } });
    await mount(<TransferConsentGate />, { route: "/dashboard" });
    expect(dialog()).toBeNull();
  });
});
