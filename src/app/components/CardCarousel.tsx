import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Aynı kart listesini masaüstünde ızgara, mobilde yana kaydırmalı carousel olarak
 * gösterir. Rapor sayfasındaki `ShadowSection` yönteminin panele taşınmış hâli:
 * snap-x + snap-mandatory ile kart kart duran yatay kaydırma, altında nokta
 * göstergeleri, kenarlara taşan (`-mx-4 px-4`) kaydırma alanı.
 *
 * Farkı: kartlar TEK KEZ render edilir. ShadowSection iki ayrı ağaç tutar
 * (`hidden md:grid` + `md:hidden`); orada kartlar durumsuz olduğu için sorun
 * değil, ama `DiscoveryCard`'ın kendi panel durumu var — ikiye kopyalansaydı iki
 * bağımsız kart durumu doğardı. Burada liste tek, kırılıma göre yalnızca düzen
 * değişir.
 */
interface CardCarouselProps {
  children: ReactNode;
  /** Masaüstü ızgarasındaki sütun sayısı. */
  columns?: 2 | 3;
}

export function CardCarousel({ children, columns = 3 }: CardCarouselProps) {
  const items = Children.toArray(children);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  /*
    Aktif kart, kap merkezine en yakın kartın merkezinden bulunur —
    `scrollLeft / offsetWidth` değil: kart genişliği (85vw + boşluk) kap
    genişliğine eşit olmadığı için o oran kartlar ilerledikçe kayıyor.
  */
  const syncActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const center = box.left + box.width / 2;

    let nearest = 0;
    let smallest = Infinity;
    Array.from(el.children).forEach((child, index) => {
      const rect = child.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - center);
      if (distance < smallest) {
        smallest = distance;
        nearest = index;
      }
    });
    setActiveIndex(nearest);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncActiveIndex();
    el.addEventListener("scroll", syncActiveIndex, { passive: true });
    window.addEventListener("resize", syncActiveIndex);
    return () => {
      el.removeEventListener("scroll", syncActiveIndex);
      window.removeEventListener("resize", syncActiveIndex);
    };
  }, [syncActiveIndex, items.length]);

  const scrollToIndex = (index: number) => {
    const el = scrollRef.current;
    const child = el?.children[index];
    if (!el || !child) return;
    const box = el.getBoundingClientRect();
    const rect = child.getBoundingClientRect();
    // Kaydırma farkla yapılır (scrollBy): kapın iç dolgusu ve kenarlardaki
    // taşma hesaba katılmadan mutlak scrollLeft hesaplamak kartı yanlış merkezler.
    el.scrollBy({ left: rect.left + rect.width / 2 - (box.left + box.width / 2), behavior: "smooth" });
  };

  return (
    <div>
      <div
        ref={scrollRef}
        className={`scrollbar-hide -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 md:mx-0 md:grid md:auto-rows-fr md:overflow-visible md:px-0 ${
          columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3"
        }`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {/* Sarmalayıcı, kartın kendi key'ini devralır: index'e düşseydi liste
            sırası değiştiğinde kartların yerel durumu yanlış karta yapışırdı. */}
        {items.map((item, index) => (
          <div
            key={isValidElement(item) && item.key != null ? item.key : index}
            className="w-[85vw] shrink-0 snap-center md:w-auto"
          >
            {item}
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <div className="mt-4 flex justify-center gap-2 md:hidden">
          {items.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => scrollToIndex(index)}
              aria-label={`${index + 1}. karta git`}
              className={`h-2 rounded-full transition-all ${
                activeIndex === index ? "w-8 bg-purple-400" : "w-2 bg-purple-400/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
