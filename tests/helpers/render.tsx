import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";

/**
 * Bileşen testleri için en küçük araç takımı — yeni bağımlılık yok, yalnızca
 * react-dom. Kapsamı bilerek dar: bu depoda bileşen testi yalnızca KAPILAR için
 * yazılır (rıza kutusu, giriş kapısı gibi "şu olmadan bu başlamaz" kuralları).
 * Görünüm, düzen ve metin tonu burada sınanmaz.
 *
 *   await mount(<Login />, { route: "/login" });
 *   await click(button("Google ile Devam Et"));
 *   expect(signInWithGoogle).not.toHaveBeenCalled();
 *
 * Radix diyalogları `document.body`'ye taşındığı için aramalar bütün belgede yapılır.
 */
const mounted: { root: Root; container: HTMLElement }[] = [];

/**
 * Her `unmountAll` bir dönemi kapatır. Zaman aşımına düşmüş bir testin geç kalan
 * `mount`'u sonraki testin ekranına çizim bırakmasın diye: çizim bittiğinde dönem
 * değişmişse o ağaç hemen sökülür.
 */
let epoch = 0;

/** Bileşeni bir yönlendirici içinde çizer; o anki yol `currentPath()` ile okunur. */
export async function mount(ui: ReactElement, options: { route?: string } = {}): Promise<HTMLElement> {
  const startedIn = epoch;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[options.route ?? "/"]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await settle();

  if (epoch !== startedIn) {
    await act(async () => root.unmount());
    container.remove();
    throw new Error("mount: bu çizim, testi bittikten sonra tamamlandı (test zaman aşımına düşmüş olabilir).");
  }
  return container;
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location" hidden data-path={pathname} />;
}

export const currentPath = () =>
  document.querySelector('[data-testid="location"]')?.getAttribute("data-path") ?? null;

/** Her testten sonra çağrılır: ağaç sökülür, belge temizlenir. */
export async function unmountAll(): Promise<void> {
  epoch += 1;
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
}

/** Bekleyen söz ve etkileri (useEffect içindeki sorgular dahil) tamamlar. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const norm = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** Ekranda görünen bütün metin (boşlukları tekleştirilmiş). */
export const pageText = () => norm(document.body.textContent);

/** Metni TAM eşleşen düğme. Bulamazsa ekrandaki düğmeleri sayarak hata verir. */
export function button(text: string): HTMLButtonElement {
  const all = [...document.querySelectorAll("button")];
  const found = all.find((el) => norm(el.textContent) === text);
  if (!found) {
    throw new Error(`"${text}" düğmesi yok. Ekrandakiler: ${all.map((el) => `"${norm(el.textContent)}"`).join(", ")}`);
  }
  return found;
}

export const hasButton = (text: string) =>
  [...document.querySelectorAll("button")].some((el) => norm(el.textContent) === text);

export function query<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`"${selector}" bulunamadı.`);
  return found;
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

/** Kontrollü bir girişe yazı yazar (React `value` atamasını kendi izlediği için yerel ayarlayıcıyla). */
export async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function press(target: Element | Document, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await settle();
}
