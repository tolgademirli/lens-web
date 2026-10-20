/**
 * Tarayıcı ortamı (jsdom) testlerinin ortak kurulumu.
 *
 * jsdom bir tarayıcı değil: Radix bileşenlerinin dokunduğu birkaç API'si yok.
 * Buradaki sahteler DAVRANIŞ taklit etmez, yalnızca "tanımsız" hatasını önler —
 * bir test bunlardan birinin gerçekten çalışmasına dayanıyorsa jsdom'da sınanamaz.
 */

// React'in `act` uyarılarını açar: durum güncellemesi `act` dışında kalırsa test söyler.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
