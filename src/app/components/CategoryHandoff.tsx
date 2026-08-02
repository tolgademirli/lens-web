import { useState } from "react";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";

const FLAG = "lens_import_used";

/** Bir kategoride import kullanıldığını işaretler — sonraki adım pattern'i öğretsin. */
export function markImportUsed(previousLabel: string) {
  sessionStorage.setItem(FLAG, previousLabel);
}

interface CategoryHandoffProps {
  /** "Aynı şekilde Letterboxd ekranını atabilirsin." gibi kategoriye özel ipucu. */
  hint: string;
}

/**
 * Kategori geçişi (brief §8.8). Yalnızca bir önceki adımda import kullanıldıysa
 * çıkar — amacı hızlı yolun burada da işe yaradığını öğretmek.
 */
export function CategoryHandoff({ hint }: CategoryHandoffProps) {
  const [previousLabel] = useState(() => sessionStorage.getItem(FLAG));
  const [dismissed, setDismissed] = useState(false);

  if (!previousLabel || dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 mb-6 p-4 rounded-2xl bg-emerald-900/25 border border-emerald-500/30"
    >
      <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-emerald-500/25 border border-emerald-400/50 flex items-center justify-center">
        <Check className="w-3.5 h-3.5 text-emerald-200" />
      </span>
      <p className="flex-1 text-sm text-emerald-100">
        <strong className="font-medium">{previousLabel} hazır.</strong> {hint}
      </p>
      <button
        onClick={() => {
          sessionStorage.removeItem(FLAG);
          setDismissed(true);
        }}
        aria-label="Kapat"
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-emerald-200/70 hover:text-white hover:bg-emerald-500/20"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
