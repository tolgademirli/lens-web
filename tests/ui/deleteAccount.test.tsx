import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountDialog } from "@/app/components/DeleteAccountDialog";
import { deleteAccount } from "@/lib/account";
import { button, click, currentPath, hasButton, mount, pageText, press, query, unmountAll } from "../helpers/render";

/**
 * "Hesabımı sil" — geri alınamaz bir işlemin kapısı. Silmenin kendisi
 * (`src/lib/account.ts`, `delete-account` edge function'ı) ayrı sınanır; burada
 * onay alınmadan silmenin BAŞLAMADIĞI ve sonucun kullanıcıdan saklanmadığı sınanır.
 */
vi.mock("@/lib/account", () => ({ deleteAccount: vi.fn() }));

const dialog = () => document.querySelector('[role="alertdialog"]');
const confirmBox = () => query<HTMLButtonElement>('[role="alertdialog"] [role="checkbox"]');
const DELETE = "Hesabımı kalıcı olarak sil";

async function open() {
  await mount(<DeleteAccountDialog />, { route: "/account" });
  await click(button("Hesabımı sil"));
}

beforeEach(() => {
  vi.mocked(deleteAccount).mockResolvedValue(true);
});

afterEach(async () => {
  await unmountAll();
});

describe("onay", () => {
  it("pencere açılınca hiçbir şey silinmez ve neyin silineceği söylenir", async () => {
    await open();

    expect(dialog()).not.toBeNull();
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(pageText()).toContain("Bu işlem geri alınamaz.");
    for (const item of ["Raporların", "geri bildirimler", "e-posta adresin"]) expect(pageText()).toContain(item);
  });

  it("onay kutusu İŞARETSİZ gelir ve silme düğmesi o zamana kadar pasiftir", async () => {
    await open();

    expect(confirmBox().getAttribute("aria-checked")).toBe("false");
    expect(button(DELETE).disabled).toBe(true);

    await click(button(DELETE));
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  // "SİL yaz" değil: Türkçe klavyede I/İ ayrımı yüzünden doğru yazan kullanıcı reddedilirdi.
  it("onay bir işaret kutusudur; yazı yazdırılmaz", async () => {
    await open();
    expect(dialog()!.querySelector("input:not([type=checkbox]):not([aria-hidden]), textarea")).toBeNull();
    expect(pageText()).toContain("Geri alınamayacağını anladım.");
  });

  it("kutu işaretlenince silme başlar", async () => {
    await open();
    await click(confirmBox());
    expect(button(DELETE).disabled).toBe(false);

    await click(button(DELETE));

    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("'Vazgeç' hiçbir şey silmeden kapatır; yeniden açıldığında onay SIFIRLANMIŞTIR", async () => {
    await open();
    await click(confirmBox());

    await click(button("Vazgeç"));
    expect(dialog()).toBeNull();
    expect(deleteAccount).not.toHaveBeenCalled();

    await click(button("Hesabımı sil"));
    expect(confirmBox().getAttribute("aria-checked")).toBe("false");
    expect(button(DELETE).disabled).toBe(true);
  });
});

describe("sonuç", () => {
  it("başarıda silindiğini söyler ve ana sayfaya götürür", async () => {
    await open();
    await click(confirmBox());

    await click(button(DELETE));

    expect(pageText()).toContain("Hesabın silindi");
    expect(hasButton(DELETE)).toBe(false);

    await click(button("Tamam"));
    expect(currentPath()).toBe("/");
  });

  // Silindikten sonra panelde kalınamaz — gösterilecek bir hesap yok.
  it("silindikten sonra pencere Esc ile kapatılırsa da ana sayfaya gidilir", async () => {
    await open();
    await click(confirmBox());
    await click(button(DELETE));

    await press(document, "Escape");

    expect(currentPath()).toBe("/");
  });

  it("başarısız olursa pencere AÇIK kalır, hata söylenir ve yeniden denenebilir", async () => {
    vi.mocked(deleteAccount).mockResolvedValueOnce(false);
    await open();
    await click(confirmBox());

    await click(button(DELETE));

    expect(dialog()).not.toBeNull();
    expect(pageText()).toContain("Hesabın silinemedi.");
    expect(currentPath()).toBe("/account");

    await click(button(DELETE));
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(pageText()).toContain("Hesabın silindi");
  });

  // Sonucu göremeyen kullanıcı hesabının silinip silinmediğini bilemez.
  it("istek yoldayken pencere kapatılamaz ve ikinci kez gönderilemez", async () => {
    let finish!: (ok: boolean) => void;
    vi.mocked(deleteAccount).mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    await open();
    await click(confirmBox());

    await click(button(DELETE));

    expect(button("Siliniyor...").disabled).toBe(true);
    expect(button("Vazgeç").disabled).toBe(true);

    await press(document, "Escape");
    await click(button("Siliniyor..."));
    expect(dialog()).not.toBeNull();
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    finish(true);
    await click(document.body);
    expect(pageText()).toContain("Hesabın silindi");
  });
});
