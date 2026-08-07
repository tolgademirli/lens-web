import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { BookOpen, Plus, X } from "lucide-react";
import { StepLayout } from "./StepLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { motion, AnimatePresence } from "motion/react";
import { posthog, captureSourcePath } from "@/lib/posthog";
import { ImportFlow } from "./ImportFlow";
import { QuickImportHero } from "./QuickImportHero";
import { markImportUsed } from "./CategoryHandoff";
import type { WorkSource } from "@/lib/types";

export function BooksStep() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<string[]>([]);
  const [sources, setSources] = useState<WorkSource[]>([]);
  const [workIds, setWorkIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"manual" | "import">("manual");
  const [currentInput, setCurrentInput] = useState("");
  const formStartedRef = useRef(false);
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (entries.length > 0) {
      listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [entries]);

  const minEntries = 3;
  const maxEntries = 8;
  const canProceed = entries.length >= minEntries;
  const canAddMore = entries.length < maxEntries;

  const handleAdd = () => {
    if (currentInput.trim() && canAddMore) {
      // Kaynak tek yerde belirlenir: aynı değişken hem listeye (oradan analyze →
      // user_works.source) hem event'e gider.
      const source: WorkSource = "manual";
      if (!formStartedRef.current) {
        formStartedRef.current = true;
        posthog.capture("form_started");
        // Yol başına bir kez — her giriş için ayrı event düşmesin.
        captureSourcePath("book", [source]);
      }
      setEntries([...entries, currentInput.trim()]);
      setSources([...sources, source]);
      setWorkIds([...workIds, ""]); // elle girilen havuza analyze tarafından yazılır
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
    setSources(sources.filter((_, i) => i !== index));
    setWorkIds(workIds.filter((_, i) => i !== index));
  };

  // Import onayı: çıkarılan girişler mevcut listeye eklenir, üst sınırda kesilir.
  const handleImported = (
    imported: string[],
    importedSources: WorkSource[],
    importedIds: string[]
  ) => {
    setEntries([...entries, ...imported].slice(0, maxEntries));
    setSources([...sources, ...importedSources].slice(0, maxEntries));
    setWorkIds([...workIds, ...importedIds].slice(0, maxEntries));
    // Kütüphaneye yazılan source dizisinin ta kendisi event'e geçer.
    captureSourcePath("book", importedSources);
    markImportUsed("Kitaplar");
    setMode("manual");
  };

  const handleNext = () => {
    if (canProceed) {
      sessionStorage.setItem("books", JSON.stringify(entries));
      sessionStorage.setItem("books_sources", JSON.stringify(sources));
      sessionStorage.setItem("books_work_ids", JSON.stringify(workIds));
      posthog.capture("form_step_completed", { step: 1 });
      navigate("/movies");
    }
  };

  return (
    <StepLayout
      step={1}
      totalSteps={3}
      icon={<BookOpen className="w-8 h-8 text-white" />}
      title="Favori Kitaplar"
      subtitle="Son dönemde seni en çok etkileyen kitapları yaz — sadece yazar adı da yeterli."
      hint={mode === "import" ? null : undefined}
    >
      {mode === "import" ? (
        <ImportFlow
          type="book"
          categoryLabel="Kitap"
          sourceChips={["Goodreads rafı", "StoryGraph", "Instagram", "düz metin"]}
          textPlaceholder={"Kitap listeni buraya yapıştır...\nörn: Dostoyevski - Karamazov Kardeşler\nOrhan Pamuk\nDünya Nimetleri - Gide"}
          existingCount={entries.length}
          onConfirm={handleImported}
          onCancel={() => setMode("manual")}
        />
      ) : (
      <>
      <QuickImportHero
        hint="Goodreads rafın ya da elle yazdığın bir liste — ekran görüntüsünü at, biz okuyup dolduralım."
        // source_path_selected buradan atılmaz: tıklama anında kaynak (ekran
        // görüntüsü mü, yapıştırma mı) henüz belli değil. Event, eserler
        // kütüphaneye yazılırken gerçek source'uyla düşer.
        onClick={() => setMode("import")}
      />
      <div className="space-y-4 mb-8">
        <AnimatePresence>
          {entries.map((entry, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3 p-4 bg-slate-700/50 rounded-xl group hover:bg-slate-700 transition-colors border border-purple-500/20"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500 text-white text-sm font-medium">
                {index + 1}
              </span>
              <span className="flex-1 text-purple-50">{entry}</span>
              <button
                onClick={() => handleRemove(index)}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] hover:bg-slate-600/50 rounded-lg text-purple-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={listEndRef} />

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
                placeholder="örn: Martin Eden"
                className="h-14 text-lg rounded-xl border-2 bg-slate-700/50 border-purple-500/30 text-white placeholder:text-purple-300/50 focus:border-purple-400 focus:bg-slate-700"
              />
            </div>
            <Button
              onClick={handleAdd}
              disabled={!currentInput.trim()}
              className="h-14 w-14 rounded-xl bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300"
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
              En az {minEntries - entries.length} kayıt daha eklemelisin
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
              ✅ {entries.length} kayıt eklendi.
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
              ✅ {entries.length} kayıt eklendi. Devam edebilir veya {maxEntries - entries.length} tane daha ekleyebilirsin.
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
              ✅ {maxEntries}/{maxEntries} — hazırsın.
            </p>
          </motion.div>
        )}
      </div>

      <div className="flex justify-between items-center pt-6 border-t border-purple-500/20">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
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
      </>
      )}
    </StepLayout>
  );
}
