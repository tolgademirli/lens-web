import { Zap, ChevronRight } from "lucide-react";

interface QuickImportHeroProps {
  /** "Goodreads rafın, Letterboxd listen..." gibi kategoriye özel ipucu. */
  hint: string;
  onClick: () => void;
}

/**
 * Kategori ekranının üstündeki hero hızlı yol (brief §2a).
 * Manuel giriş ikame edilmiyor — bu ikinci yol, hemen altında "veya tek tek yaz" duruyor.
 */
export function QuickImportHero({ hint, onClick }: QuickImportHeroProps) {
  return (
    <div className="mb-6">
      <button
        onClick={onClick}
        className="w-full text-left rounded-2xl border border-purple-400/40 bg-gradient-to-br from-purple-900/60 to-slate-800/60 hover:border-purple-400 transition-colors p-5 group"
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-200 font-medium">
            15 SANİYE
          </span>
          <span className="text-[11px] text-purple-300">önerilen</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-white text-lg flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-purple-300" /> Yükle / Yapıştır
            </p>
            <p className="text-sm text-purple-200">{hint}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-purple-300 group-hover:text-white transition-colors shrink-0" />
        </div>
      </button>

      <div className="flex items-center gap-3 mt-6">
        <div className="flex-1 h-px bg-purple-500/20" />
        <span className="text-[11px] uppercase tracking-wider text-purple-300">
          veya tek tek yaz
        </span>
        <div className="flex-1 h-px bg-purple-500/20" />
      </div>
    </div>
  );
}
