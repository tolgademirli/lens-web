import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTROLLER, LEGAL_UPDATED, PROCESSORS, TRANSFER_COUNTRIES } from "@/lib/legal";
import { CookiesPage, PrivacyPage, TermsPage } from "@/pages/Legal";
import { mount, pageText, query, unmountAll } from "../helpers/render";

/**
 * Hukuki metin sayfaları — YAYINDAKİ hâlleriyle. Metnin koda uyup uymadığını
 * `tests/guards/kvkk.test.ts` kaynaktan sınar; burada sayfanın gerçekten ne
 * çizdiğine bakılır: taslak şeridi var mı, yer tutucu kalmış mı, tablo eksik mi.
 */
vi.mock("posthog-js", () => ({ default: { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() } }));
vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

afterEach(async () => {
  await unmountAll();
});

const pages = [
  ["/privacy", "Aydınlatma Metni", PrivacyPage],
  ["/cookies", "Çerez Politikası", CookiesPage],
  ["/terms", "Kullanım Koşulları", TermsPage],
] as const;

describe.each(pages)("%s", (route, title, Page) => {
  it("başlığıyla çizilir ve son güncelleme tarihini gösterir", async () => {
    await mount(<Page />, { route });
    expect(query("h1").textContent).toBe(title);
    expect(pageText()).toContain(`Son güncelleme: ${LEGAL_UPDATED}`);
  });

  // Kimliği belli olmayan bir veri sorumlusunun aydınlatma metni aydınlatma sayılmaz.
  it("TASLAK şeridi ve doldurulmamış yer tutucu taşımaz", async () => {
    await mount(<Page />, { route });
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(pageText()).not.toMatch(/Taslak:/);
    expect(pageText()).not.toMatch(/\[[^\]]*(veri sorumlusu|başvuru e-postası)[^\]]*\]/);
  });

  it("diğer iki metne bağlantı verir", async () => {
    await mount(<Page />, { route });
    for (const [other] of pages) expect(document.querySelector(`nav a[href="${other}"]`)).not.toBeNull();
  });

  // Premium anahtarı kapalıyken arayüz paket kelimelerini hiç kurmuyor; metinler de kurmaz.
  it("ekrana 'ücret / paket / premium' dili basmaz", async () => {
    await mount(<Page />, { route });
    expect(pageText().match(/\S*(premium|ücret|paket)\S*/giu) ?? []).toEqual([]);
  });
});

describe("Aydınlatma Metni", () => {
  it("veri sorumlusunu adıyla ve başvuru e-postasıyla gösterir", async () => {
    await mount(<PrivacyPage />, { route: "/privacy" });
    expect(CONTROLLER.name).not.toBe("");
    expect(pageText()).toContain(CONTROLLER.name);
    expect(query<HTMLAnchorElement>(`a[href="mailto:${CONTROLLER.email}"]`).textContent).toBe(CONTROLLER.email);
  });

  // Adres bilerek boş (yazılacak tek adres ev adresi olurdu); boşken satırı ÇİZİLMEZ.
  it("adres boşken boş bir 'Adres' satırı çizmez", async () => {
    await mount(<PrivacyPage />, { route: "/privacy" });
    const labels = [...document.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels.includes("Adres")).toBe(Boolean(CONTROLLER.address));
    expect(labels).toEqual(expect.arrayContaining(["Veri sorumlusu", "Başvuru"]));
  });

  it("verinin gittiği HER sağlayıcıyı ülkesiyle birlikte listeler", async () => {
    await mount(<PrivacyPage />, { route: "/privacy" });
    const text = pageText();
    for (const processor of PROCESSORS) {
      expect(text, processor.name).toContain(processor.name);
      expect(text, processor.name).toContain(processor.purpose);
    }
    expect(text).toContain(TRANSFER_COUNTRIES);
  });

  it("saklama sürelerini ve hesap silmeyi söyler", async () => {
    await mount(<PrivacyPage />, { route: "/privacy" });
    const text = pageText();
    expect(text).toContain("Günlük kullanım sayacındaki IP adresi 7 gün sonra silinir.");
    expect(text).toContain("60 dakika sonra geçersizleşir");
    expect(text).toContain("Ekran görüntüleri ve yapıştırdığın metinler saklanmaz.");
    expect(text).toContain("hesabını silene kadar");
  });
});

/**
 * HER CÜMLE TAM CÜMLEDİR — metnin sahibinin açık isteği (11 Ekim 2026). İlk sürüm
 * arayüz diliyle yazılmıştı: "Hesabın. Giriş yaptığın e-posta adresi.", "Hukuki
 * sebep: meşru menfaat.", "Ayrıntısı Çerez Politikası'nda.", "Hayır." — hukuki
 * metinde bunlar yarım kalmış cümle gibi okundu.
 *
 * Bu bir dilbilgisi denetimi DEĞİL; o sürümde görülen kalıpları yakalar. Yeni bir
 * yarım cümle biçimi görülürse buraya kalıbı eklenir.
 */
describe.each(pages)("%s — her cümle tam cümledir", (route, _title, Page) => {
  /** Metin taşıyan en küçük bloklar: paragraflar ve içinde paragraf olmayan maddeler. */
  const blocks = () =>
    [...document.querySelectorAll("main p, main li")]
      .filter((el) => !el.querySelector("p, li") && !el.className.includes("font-mono"))
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      // Sayfa altındaki tarih bir künye satırı, cümle değil.
      .filter((text) => !text.startsWith("Son güncelleme:"));

  // "10. maddesi", "m.5/2-c" gibi noktalar cümle bitirmez: ardından boşluk + büyük harf aranır.
  const sentences = () => blocks().flatMap((block) => block.split(/(?<=\.)\s+(?=[A-ZÇĞİÖŞÜ“])/u));

  it("metin blokları bulunur (tarama boş kalmasın)", async () => {
    await mount(<Page />, { route });
    expect(blocks().length).toBeGreaterThanOrEqual(10);
    expect(sentences().length).toBeGreaterThan(blocks().length);
  });

  it("her paragraf ve madde noktayla biter", async () => {
    await mount(<Page />, { route });
    expect(blocks().filter((block) => !block.endsWith("."))).toEqual([]);
  });

  // "Hayır." · "7 gün." · "Hesabın."
  it("iki kelimelik ya da daha kısa cümle yoktur", async () => {
    await mount(<Page />, { route });
    expect(sentences().filter((sentence) => sentence.split(" ").length < 3)).toEqual([]);
  });

  // "Hukuki sebep: meşru menfaat." · "Giden veri: Lens'te tutulan her şey."
  it("hiçbir cümle 'etiket: parça' biçiminde kurulmaz", async () => {
    await mount(<Page />, { route });
    expect(sentences().filter((sentence) => /^[^,;.]{1,45}: /u.test(sentence))).toEqual([]);
  });

  // "Ayrıntısı Çerez Politikası'nda." · "Kutunun güvenliği sende." · "…hesabını silene kadar."
  it("hiçbir cümle yüklemi düşmüş hâlde (bulunma eki ya da edatla) bitmez", async () => {
    await mount(<Page />, { route });
    // `\b` yok: JS'te sözcük sınırı Türkçe harf tanımaz; boşluk aranır.
    expect(sentences().filter((sentence) => /('n?d[ae]|\s(sende|kadar|için|gibi|ile))\.$/u.test(sentence))).toEqual([]);
  });

  // "Hesabım → Verilerim" bir yol tarifi, cümle değil; cümleyle yazılır.
  it("ok işaretiyle yol tarifi yoktur", async () => {
    await mount(<Page />, { route });
    expect(pageText()).not.toContain("→");
  });
});

describe("Çerez Politikası", () => {
  it("tarayıcıda tutulan kayıtların dördünü de anahtarlarıyla listeler", async () => {
    await mount(<CookiesPage />, { route: "/cookies" });
    const text = pageText();
    for (const key of ["lens_analytics_consent", "lens_pending_report", "lens_pending_library", "lens_auth_method", "lens_pending_consent"]) {
      expect(text, key).toContain(key);
    }
  });

  it("analitik çerezini izne bağlı ayrı bir bölümde anlatır", async () => {
    await mount(<CookiesPage />, { route: "/cookies" });
    const text = pageText();
    expect([...document.querySelectorAll("h2")].map((h2) => h2.textContent)).toContain("Kullanım ölçümü çerezi");
    expect(text).toContain("Bu araç yalnızca sen izin verirsen çalışır.");
    expect(text).toContain("ph_…_posthog");
    expect(text).not.toMatch(/ekran kayd/i);
  });
});
