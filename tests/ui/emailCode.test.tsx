import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "@/app/components/AuthCallback";
import { EmailOptInModal } from "@/app/components/EmailOptInModal";
import { Login } from "@/app/components/Login";
import { writePendingReport } from "@/lib/pendingReport";
import { posthog } from "@/lib/posthog";
import { sendMagicLink, verifyEmailCode } from "@/lib/supabase";
import { fakeSupabase } from "../helpers/fake-supabase";
import { button, click, currentPath, hasButton, mount, pageText, press, query, type, unmountAll } from "../helpers/render";
import { useWebSupabase } from "../helpers/web-supabase";

/**
 * E-postadaki kodla giriş — KAPI testleri.
 *
 * Giriş bağlantısı çoğu zaman formun doldurulduğu tarayıcıdan başka bir yerde
 * açılır (Instagram / LinkedIn'in uygulama içi tarayıcısından gelende her zaman):
 * oturum orada açılır, yazılan sinyaller ve aktarım rızası burada kalır, kullanıcı
 * boş bir panele düşer (ölçüldü, 11 Ekim 2026). Kod, oturumu taslağın durduğu
 * tarayıcıda açar. Buradaki testler o yolun kapılarını tutar: doğrulanmamış kod
 * kimseyi içeri almaz, doğrulanan kod bağlantıyla gelenle AYNI yoldan yürür ve
 * kullanılmış bağlantı kimseyi sonsuz bir bekleme ekranında bırakmaz.
 */
vi.mock("@/lib/supabase", async () => ({
  ...(await import("../helpers/web-supabase")).supabaseModuleMock(),
  sendMagicLink: vi.fn(),
  signInWithGoogle: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock("@/lib/posthog", () => ({ posthog: { capture: vi.fn() } }));

const EMAIL = "biri@example.com";
const checkbox = () => query<HTMLButtonElement>('[role="checkbox"]');
const emailInput = () => query<HTMLInputElement>('input[type="email"]');
const codeInput = () => query<HTMLInputElement>('input[autocomplete="one-time-code"]');
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent ?? "");
const resendButton = () => button("yeniden gönderin");

const entry = (title: string) => ({ title, creator: "", source: "manual" as const, workId: "" });
const completeDraft = () => ({
  books: Array.from({ length: 6 }, (_, i) => entry(`K${i}`)),
  movies: [],
  music: [],
});

beforeEach(() => {
  localStorage.clear();
  useWebSupabase(fakeSupabase().client);
  vi.mocked(sendMagicLink).mockResolvedValue({ error: null } as Awaited<ReturnType<typeof sendMagicLink>>);
  vi.mocked(verifyEmailCode).mockResolvedValue("ok");
});

afterEach(async () => {
  await unmountAll();
  window.history.replaceState(null, "", "/");
});

/** Giriş penceresinde (ilk rapor yolunda rızayı da verip) bağlantıyı ister; "kod" ekranında durur. */
async function modalAtCodeStep(context?: "report" | "login") {
  await mount(<EmailOptInModal open onOpenChange={() => {}} context={context} />, { route: "/start" });
  // Kutu yalnızca ilk rapor yolunda durur; dönen kullanıcının rızasını girişten sonraki kapı sorar.
  if (context !== "login") await click(checkbox());
  await click(button("Email ile Devam Et"));
  await type(emailInput(), `  ${EMAIL} `);
  await click(button("Devam Et"));
}

describe("EmailOptInModal — e-postadaki kod", () => {
  it("bağlantı istendikten sonra kod alanı AYNI ekranda durur", async () => {
    await modalAtCodeStep();

    expect(codeInput().value).toBe("");
    expect(hasButton("Kodu Onayla")).toBe(true);
    expect(verifyEmailCode).not.toHaveBeenCalled();
    expect(currentPath()).toBe("/start");
  });

  it("kod eksikken doğrulama İSTENMEZ — düğmeyle de Enter'la da", async () => {
    await modalAtCodeStep();
    await type(codeInput(), "12345");

    await click(button("Kodu Onayla"));
    await press(codeInput(), "Enter");

    expect(verifyEmailCode).not.toHaveBeenCalled();
    expect(currentPath()).toBe("/start");
  });

  // Oturum bu sekmede açılır; sonrası bağlantıyla gelenle aynı yoldan yürür (AuthCallback).
  it("kod doğrulanınca /auth/callback'e gidilir ve giriş yolu 'email_code' diye işaretlenir", async () => {
    await modalAtCodeStep();
    await type(codeInput(), "730257");

    await click(button("Kodu Onayla"));

    expect(verifyEmailCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "730257");
    expect(currentPath()).toBe("/auth/callback");
    expect(localStorage.getItem("lens_auth_method")).toBe("email_code");
  });

  it("Enter da doğrular", async () => {
    await modalAtCodeStep();
    await type(codeInput(), "730257");

    await press(codeInput(), "Enter");

    expect(verifyEmailCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "730257");
    expect(currentPath()).toBe("/auth/callback");
  });

  // E-postadan kopyalanan kod çoğu zaman "730 257" ya da "730-257" gelir.
  it("yapıştırılan koddaki boşluk, tire ve harfler ayıklanır", async () => {
    await modalAtCodeStep();
    await type(codeInput(), " 730-257 kod");

    expect(codeInput().value).toBe("730257");
    await click(button("Kodu Onayla"));
    expect(verifyEmailCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "730257");
  });

  it.each(["rejected", "failed"] as const)(
    "%s dönen kod kimseyi İÇERİ ALMAZ: yönlendirme yok, köprüler yerinde, neden söylenir",
    async (result) => {
      vi.mocked(verifyEmailCode).mockResolvedValue(result);
      await modalAtCodeStep();
      await type(codeInput(), "000000");

      await click(button("Kodu Onayla"));

      expect(currentPath()).toBe("/start");
      expect(localStorage.getItem("lens_auth_method")).toBe("magic_link");
      expect(localStorage.getItem("lens_pending_consent")).not.toBeNull();
      expect(alerts()).toHaveLength(1);
      // Aynı ekranda yeniden denenebilir.
      expect(button("Kodu Onayla").disabled).toBe(false);
    },
  );

  it("reddedilen kodun uyarısı yeni kod yazılınca kaybolur", async () => {
    vi.mocked(verifyEmailCode).mockResolvedValue("rejected");
    await modalAtCodeStep();
    await type(codeInput(), "000000");
    await click(button("Kodu Onayla"));
    expect(alerts()).toHaveLength(1);

    await type(codeInput(), "0000001");

    expect(alerts()).toHaveLength(0);
  });

  it("doğrulama sürerken ikinci kez GÖNDERİLEMEZ", async () => {
    vi.mocked(verifyEmailCode).mockReturnValue(new Promise(() => {}));
    await modalAtCodeStep();
    await type(codeInput(), "730257");

    await click(button("Kodu Onayla"));
    await press(codeInput(), "Enter");

    expect(verifyEmailCode).toHaveBeenCalledTimes(1);
    expect(button("Doğrulanıyor...").disabled).toBe(true);
  });

  // Giriş başlatan çağrı ebeveyn bileşende (pencere ya da /login) kalır; yeni e-posta aynı yere döner.
  it("yeniden gönderim AYNI adrese, AYNI dönüş adresiyle gider ve eski kodu ekrandan siler", async () => {
    await modalAtCodeStep();
    await type(codeInput(), "730257");

    await click(resendButton());

    const target = [EMAIL, `${window.location.origin}/auth/callback`];
    expect(vi.mocked(sendMagicLink).mock.calls).toEqual([target, target]);
    expect(codeInput().value).toBe("");
    expect(query('[role="status"]').textContent).toContain("Yeni e-posta gönderildi");
    expect(verifyEmailCode).not.toHaveBeenCalled();
  });

  it("yeniden gönderim sıklık sınırına takılırsa (429) söylenir; yazılan kod durur", async () => {
    await modalAtCodeStep();
    await type(codeInput(), "730257");
    vi.mocked(sendMagicLink).mockResolvedValue({ error: { status: 429 } } as Awaited<ReturnType<typeof sendMagicLink>>);

    await click(resendButton());

    expect(alerts()).toEqual([expect.stringContaining("Az önce bir e-posta gönderdik")]);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(codeInput().value).toBe("730257");
  });

  it("yeniden gönderim başka bir hatayla dönerse 'gönderildi' DENMEZ", async () => {
    await modalAtCodeStep();
    vi.mocked(sendMagicLink).mockResolvedValue({ error: { status: 500 } } as Awaited<ReturnType<typeof sendMagicLink>>);

    await click(resendButton());

    expect(alerts()).toEqual([expect.stringContaining("E-posta gönderilemedi")]);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("ana sayfadaki giriş penceresinde (context=login) de kod alanı vardır", async () => {
    await modalAtCodeStep("login");
    await type(codeInput(), "730257");

    await click(button("Kodu Onayla"));

    expect(currentPath()).toBe("/auth/callback");
  });
});

describe("Login — /login", () => {
  async function loginAtCodeStep() {
    await mount(<Login />, { route: "/login" });
    await type(emailInput(), EMAIL);
    await click(button("Giriş Bağlantısı Gönder"));
  }

  it("kod doğrulanınca /auth/callback'e gidilir", async () => {
    await loginAtCodeStep();
    await type(codeInput(), "730257");

    await click(button("Kodu Onayla"));

    expect(verifyEmailCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "730257");
    expect(currentPath()).toBe("/auth/callback");
  });

  it("reddedilen kod /login'de bırakır", async () => {
    vi.mocked(verifyEmailCode).mockResolvedValue("rejected");
    await loginAtCodeStep();
    await type(codeInput(), "000000");

    await click(button("Kodu Onayla"));

    expect(currentPath()).toBe("/login");
    expect(alerts()).toHaveLength(1);
  });

  it("yeniden gönderim ilk gönderimle aynı dönüş adresini kullanır", async () => {
    await loginAtCodeStep();

    await click(resendButton());

    const target = [EMAIL, `${window.location.origin}/auth/callback?intent=reports`];
    expect(vi.mocked(sendMagicLink).mock.calls).toEqual([target, target]);
  });
});

describe("AuthCallback — giriş dönüşü", () => {
  const REJECTED = "Bu giriş bağlantısı artık geçerli değil.";
  // Supabase'in kullanılmış / süresi dolmuş bağlantıda dönüş adresine eklediği parametreler.
  const USED_LINK = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

  const signedIn = () => useWebSupabase(fakeSupabase({ user: { id: "user-1" } }).client);
  const signedOut = () => useWebSupabase(fakeSupabase({ user: null }).client);
  const open = () => mount(<AuthCallback />, { route: "/auth/callback" });

  it("oturum + eksiksiz taslak → /generating", async () => {
    signedIn();
    writePendingReport(completeDraft());

    await open();

    expect(currentPath()).toBe("/generating");
  });

  it("oturum var, taslak yok → /dashboard", async () => {
    signedIn();
    await open();
    expect(currentPath()).toBe("/dashboard");
  });

  it("kodla girişi 'email_code' yoluyla sayar ve işareti temizler", async () => {
    signedIn();
    localStorage.setItem("lens_auth_method", "email_code");

    await open();

    expect(posthog.capture).toHaveBeenCalledExactlyOnceWith("auth_completed", { method: "email_code" });
    expect(localStorage.getItem("lens_auth_method")).toBeNull();
  });

  // Eskiden sonsuza dek "Oturum açılıyor..." diyordu. Kodu yazıp sonra bağlantıya
  // dokunan (ya da bağlantıyı ikinci kez açan) herkes buraya düşer.
  it("kullanılmış bağlantı + oturum yok → BEKLETMEZ: geçersiz olduğunu söyler, yönlendirmez", async () => {
    signedOut();
    window.location.hash = USED_LINK;

    await open();

    expect(pageText()).toContain(REJECTED);
    expect(pageText()).not.toContain("Oturum açılıyor");
    expect(currentPath()).toBe("/auth/callback");
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("hata sorgu parametresiyle gelse de tanınır", async () => {
    signedOut();
    window.history.replaceState(null, "", "/auth/callback?error=access_denied&error_code=otp_expired");

    await open();

    expect(pageText()).toContain(REJECTED);
  });

  it("geçersiz bağlantı ekranı taslağı OLMAYANI giriş sayfasına götürür", async () => {
    signedOut();
    window.location.hash = USED_LINK;
    await open();

    await click(button("Yeniden giriş yap"));

    expect(currentPath()).toBe("/login");
  });

  // Taslak bu tarayıcıdaysa form onu geri yükler; /login'e atmak sinyalleri gözden kaçırırdı.
  it("geçersiz bağlantı ekranı taslağı bu tarayıcıda DURANI formuna götürür", async () => {
    signedOut();
    writePendingReport(completeDraft());
    window.location.hash = USED_LINK;
    await open();

    await click(button("Yeniden giriş yap"));

    expect(currentPath()).toBe("/start");
  });

  // Kodu yazıp içeri giren kişi sonradan bağlantıya da dokunursa dışarıda bırakılmaz.
  it("kullanılmış bağlantı + oturum VAR → hata yok sayılır, yoluna devam eder", async () => {
    signedIn();
    window.location.hash = USED_LINK;

    await open();

    expect(pageText()).not.toContain(REJECTED);
    expect(currentPath()).toBe("/dashboard");
  });

  // Bağlantı henüz işleniyor olabilir (SIGNED_IN birazdan gelir): hata yokken hüküm verilmez.
  it("hata yok + oturum yok → beklemeye devam eder", async () => {
    signedOut();

    await open();

    expect(pageText()).toContain("Oturum açılıyor");
    expect(pageText()).not.toContain(REJECTED);
    expect(currentPath()).toBe("/auth/callback");
  });
});
