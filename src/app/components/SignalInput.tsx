import { Plus, Upload } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface SignalInputProps {
  value: string;
  placeholder: string;
  /** Kategoriye özel yardım metni — ne yazılabileceğini örnekler. */
  help: string;
  /** Kategori tavana ulaştıysa giriş ve import kapanır. */
  full: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
  onImport: () => void;
}

export function SignalInput({
  value, placeholder, help, full, onChange, onAdd, onImport,
}: SignalInputProps) {
  if (full) {
    return (
      <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-4 text-center">
        <p className="text-sm text-emerald-200">
          Bu kategori dolu. Diğer sekmelerden devam edebilirsin.
        </p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex gap-3">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          // Placeholder yazılan metinden bir tık küçük ve daha sönük: aynı punto
          // ve netlikte olunca alan zaten doluymuş gibi görünüyordu. Yine de
          // okunur sınırın üstünde — purple-300/70 kart üstünde 4.79:1
          // (eski purple-300/50 yalnızca 3.17:1'di).
          className="flex-1 h-14 text-lg rounded-xl border-2 bg-slate-700/50 border-purple-500/30 text-white placeholder:text-base placeholder:text-purple-300/70 focus:border-purple-400 focus:bg-slate-700"
        />
        <Button
          onClick={onAdd}
          disabled={!value.trim()}
          aria-label="Sinyali ekle"
          className="h-14 w-14 rounded-xl bg-purple-500 hover:bg-purple-600 disabled:bg-slate-600 disabled:opacity-60"
        >
          <Plus className="w-6 h-6" />
        </Button>
      </div>

      <p className="text-sm text-purple-300 mt-3">{help}</p>

      <button
        onClick={onImport}
        className="flex items-center gap-2 mt-4 text-sm text-purple-200 hover:text-white underline underline-offset-4 decoration-purple-500/40 hover:decoration-purple-400 transition-colors"
      >
        <Upload className="w-4 h-4" />
        Ekran görüntüsü ya da liste yapıştır
      </button>
    </motion.div>
  );
}
