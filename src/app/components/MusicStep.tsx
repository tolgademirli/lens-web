import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { Music, Plus, X } from "lucide-react";
import { StepLayout } from "./StepLayout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { EmailOptInModal } from "./EmailOptInModal";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentUser } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { ImportFlow } from "./ImportFlow";
import { QuickImportHero } from "./QuickImportHero";
import { CategoryHandoff, markImportUsed } from "./CategoryHandoff";
import type { WorkSource } from "@/lib/types";

export function MusicStep() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<string[]>([]);
  const [sources, setSources] = useState<WorkSource[]>([]);
  const [workIds, setWorkIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"manual" | "import">("manual");
  const [currentInput, setCurrentInput] = useState("");
  const [showEmailModal, setShowEmailModal] = useState(false);

  const listEndRef = useRef<HTMLDivElement>(null);

  const minEntries = 3;
  const maxEntries = 8;
  const canProceed = entries.length >= minEntries;
  const canAddMore = entries.length < maxEntries;

  useEffect(() => {
    if (entries.length > 0) {
      listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [entries]);

  const handleAdd = () => {
    if (currentInput.trim() && canAddMore) {
      setEntries([...entries, currentInput.trim()]);
      setSources([...sources, "manual"]);
      setWorkIds([...workIds, ""]);
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

  const handleImported = (
    imported: string[],
    importedSources: WorkSource[],
    importedIds: string[]
  ) => {
    setEntries([...entries, ...imported].slice(0, maxEntries));
    setSources([...sources, ...importedSources].slice(0, maxEntries));
    setWorkIds([...workIds, ...importedIds].slice(0, maxEntries));
    markImportUsed("Müzik");
    setMode("manual");
  };

  const handleNext = async () => {
    if (canProceed) {
      sessionStorage.setItem("music", JSON.stringify(entries));
      sessionStorage.setItem("music_sources", JSON.stringify(sources));
      sessionStorage.setItem("music_work_ids", JSON.stringify(workIds));

      // Consolidated pending report for post-OAuth restore (survives full-page redirects)
      const books = JSON.parse(sessionStorage.getItem("books") ?? "[]") as string[];
      const movies = JSON.parse(sessionStorage.getItem("movies") ?? "[]") as string[];
      const readSources = (key: string) => {
        try {
          return JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
        } catch {
          return [];
        }
      };
      localStorage.setItem(
        "lens_pending_report",
        JSON.stringify({
          books,
          movies,
          music: entries,
          // Redirect sessionStorage'ı sıfırlıyor; source'lar da köprüden geçmeli.
          sources: {
            books: readSources("books_sources"),
            movies: readSources("movies_sources"),
            music: sources,
          },
          workIds: {
            books: readSources("books_work_ids"),
            movies: readSources("movies_work_ids"),
            music: workIds,
          },
          savedAt: Date.now(),
        })
      );

      posthog.capture("form_step_completed", { step: 3 });

      const user = await getCurrentUser();
      if (user) {
        navigate("/generating");
      } else {
        posthog.capture("auth_gate_shown");
        setShowEmailModal(true);
      }
    }
  };

  return (
    <>
    <StepLayout
      step={3}
      totalSteps={3}
      icon={<Music className="w-8 h-8 text-white" />}
      title="Favori Müzik"
      subtitle="Son zamanlarda içini dolduran şarkıları yaz — sadece sanatçı adı da yeterli."
      hint={mode === "import" ? null : undefined}
    >
      {mode === "import" ? (
        <ImportFlow
          type="song"
          categoryLabel="Müzik"
          sourceChips={["Spotify Wrapped", "çalma listesi", "Apple Music", "düz metin"]}
          textPlaceholder={"Müzik listeni buraya yapıştır...\nörn: Adamlar\nBLOK3\nLa vie en rose - Edith Piaf"}
          existingCount={entries.length}
          onConfirm={handleImported}
          onCancel={() => setMode("manual")}
        />
      ) : (
      <>
      <CategoryHandoff hint="Son adım: müzik. Spotify Wrapped ekranını da aynı şekilde atabilirsin." />
      <QuickImportHero
        hint="Spotify Wrapped ekranın ya da çalma listen — görüntüyü at, biz okuyup dolduralım."
        onClick={() => {
          posthog.capture("source_path_selected", { type: "song", path: "import" });
          setMode("import");
        }}
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
                placeholder="örn: Adamlar"
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
              ✅ {entries.length} kayıt eklendi. Raporu oluşturabilir veya {maxEntries - entries.length} tane daha ekleyebilirsin.
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
          onClick={() => navigate("/movies")}
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
          Raporu Oluştur
        </Button>
      </div>
      </>
      )}
    </StepLayout>
    <EmailOptInModal
      open={showEmailModal}
      onOpenChange={setShowEmailModal}
    />
    </>
  );
}
