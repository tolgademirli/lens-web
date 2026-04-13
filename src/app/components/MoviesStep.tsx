import { useState } from "react";
import { useNavigate } from "react-router";
import { Film, Plus, X } from "lucide-react";
import { StepLayout } from "./StepLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { motion, AnimatePresence } from "motion/react";

export function MoviesStep() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState("");

  const minEntries = 3;
  const maxEntries = 5;
  const canProceed = entries.length >= minEntries;
  const canAddMore = entries.length < maxEntries;

  const handleAdd = () => {
    if (currentInput.trim() && canAddMore) {
      setEntries([...entries, currentInput.trim()]);
      setCurrentInput("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    if (canProceed) {
      sessionStorage.setItem("movies", JSON.stringify(entries));
      navigate("/music");
    }
  };

  return (
    <StepLayout
      step={2}
      totalSteps={3}
      icon={<Film className="w-8 h-8 text-white" />}
      title="Favori Filmler"
      subtitle="Son günlerde aklından çıkmayan film ve/veya yönetmenleri yaz."
    >
      <div className="space-y-4 mb-8">
        <AnimatePresence>
          {entries.map((entry, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3 p-4 bg-slate-700/50 rounded-xl group hover:bg-slate-700 transition-colors border border-pink-500/20"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-pink-500 text-white text-sm font-medium">
                {index + 1}
              </span>
              <span className="flex-1 text-purple-50">{entry}</span>
              <button
                onClick={() => handleRemove(index)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-slate-600 rounded-lg"
              >
                <X className="w-4 h-4 text-purple-200" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {canAddMore && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="flex-1">
              <Input
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="örn: David Fincher; Matrix; Köstebek - Martin Scorsese"
                className="h-14 text-lg rounded-xl border-2 bg-slate-700/50 border-pink-500/30 text-white placeholder:text-pink-300/50 focus:border-pink-400 focus:bg-slate-700"
              />
            </div>
            <Button
              onClick={handleAdd}
              disabled={!currentInput.trim()}
              className="h-14 w-14 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-gray-300"
            >
              <Plus className="w-6 h-6" />
            </Button>
          </motion.div>
        )}

        {entries.length > 0 && entries.length < minEntries && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-amber-900/30 border border-amber-500/30 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-amber-200">
              En az {minEntries - entries.length} film daha eklemelisin
            </p>
          </motion.div>
        )}

        {entries.length === minEntries && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-emerald-700 font-medium">
              ✅ {entries.length} film eklendi.
            </p>
          </motion.div>
        )}

        {entries.length > minEntries && entries.length < maxEntries && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-emerald-200">
              ✅ {entries.length} film eklendi. Devam edebilir veya {maxEntries - entries.length} tane daha ekleyebilirsin.
            </p>
          </motion.div>
        )}

        {entries.length === maxEntries && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-emerald-700 font-medium">
              ✅ {entries.length} film eklendi. Maksimum sayıya ulaştın!
            </p>
          </motion.div>
        )}
      </div>

      <div className="flex justify-between items-center pt-6 border-t border-pink-500/20">
        <Button
          variant="ghost"
          onClick={() => navigate("/books")}
          className="text-purple-200 hover:text-white hover:bg-slate-700"
        >
          Geri
        </Button>
        <Button
          onClick={handleNext}
          disabled={!canProceed}
          size="lg"
          className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-8 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          İleri
        </Button>
      </div>
    </StepLayout>
  );
}
