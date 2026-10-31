/**
 * Lens'in işareti ("Kırılan Işık"): düşen ışın mercekte kırılıp altın ışın olarak
 * çıkar ve ikisi L harfini kurar. Gece zemini tek renk şeması; sitede logo gereken
 * her yer bunu kullanır, renk ya da çizim bileşenlere kopyalanmaz.
 *
 * Boyutu ve köşeyi çağıran `className` ile verir ("h-16 w-16 rounded-full"). İşaret
 * zeminin %74'ünü kaplar: daire kırpmada altın nokta kenara değmez.
 *
 * Çizim `public/favicon.svg` ile, Google ve Instagram'a yüklenen PNG'lerle aynıdır.
 * Bu işareti DÖNDÜRME: harf taşıyor ve dönerken okunmuyor, bekleme ekranlarında nefes
 * alır.
 */
export function LensMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-[#0a111c] ring-1 ring-white/10 ${className}`}
    >
      <svg viewBox="0 0 120 120" fill="none" className="h-[74%] w-[74%]" aria-hidden="true">
        <g transform="translate(-8 6)">
          <path d="M40 14V66" stroke="#efe9dc" strokeWidth="8" strokeLinecap="round" />
          <path d="M60 88H100" stroke="#cfae72" strokeWidth="8" strokeLinecap="round" />
          <circle cx="104" cy="88" r="9" fill="#cfae72" />
          <path
            d="M0 -26C14 -10 14 10 0 26C-14 10 -14 -10 0 -26Z"
            fill="#efe9dc"
            transform="translate(44 84) rotate(-45)"
          />
        </g>
      </svg>
    </span>
  );
}
