import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles, BookOpen, Film, Music } from "lucide-react";
import { analyzeAndCreateReport, AnalyzeError } from "@/lib/supabase";
import {
  readPendingReport,
  clearPendingReport,
  pendingReportIsComplete,
} from "@/lib/pendingReport";
import {
  clearSessionDraft,
  draftTotal,
  readSessionDraft,
  type TasteDraft,
} from "@/lib/tasteDraft";
import { MIN_TOTAL_ENTRIES } from "@/lib/formLimits";
import { flushLibraryStash } from "@/lib/userWorks";
import { Button } from "./ui/button";
import { posthog } from "@/lib/posthog";
import type { WorkEntry } from "@/lib/types";

function abandonAndGoToDashboard(nav: (path: string) => void) {
  clearSessionDraft();
  clearPendingReport();
  nav("/dashboard");
}

/**
 * Girişten sonra havuza yazılan eserlerin id'lerini, import'tan gelen sinyallere
 * sırayla yerleştirir. Sıra güvenilir: ImportFlow seçilenleri liste sırasında
 * ekliyor, form da aynı sırayla taslağa yazıyor.
 */
function fillImportedIds(entries: WorkEntry[], flushed: string[]): WorkEntry[] {
  let next = 0;
  return entries.map((entry) => {
    const imported = entry.source === "screenshot" || entry.source === "paste";
    if (!imported || entry.workId || next >= flushed.length) return entry;
    return { ...entry, workId: flushed[next++] };
  });
}

type ErrorKind = "auth" | "quota" | "generic";

function errorKind(err: unknown): ErrorKind {
  if (err instanceof AnalyzeError) {
    if (err.status === 401) return "auth";
    if (err.status === 429) return "quota";
  }
  return "generic";
}

export function GeneratingReport() {
  const navigate = useNavigate();
  const [error, setError] = useState<{ kind: ErrorKind; message: string } | null>(null);

  useEffect(() => {
    // Birincil kaynak: sessionStorage (aynı sekme, doğrudan giriş yolu).
    // Yedek: OAuth öncesi yazılan konsolide kayıt (max 60 dk).
    //
    // Kategori kategori KARIŞTIRMA: eşik artık toplamda olduğundan, taze bir
    // kategoriyi bayat bir kategoriyle birleştirmek sessizce yanlış rapor üretir.
    // Karışık durum zaten doğamaz — ikisi de aynı gönderim anında yazılıyor.
    const session = readSessionDraft();
    const pending = readPendingReport();
    let draft: TasteDraft | null =
      draftTotal(session) >= MIN_TOTAL_ENTRIES
        ? session
        : pendingReportIsComplete(pending)
        ? pending
        : null;

    if (!draft) {
      // Taslağı olan kullanıcıyı pazarlama sayfasına atma — formuna geri koy.
      navigate("/start", { replace: true });
      return;
    }

    posthog.capture("report_generation_started", {
      total: draftTotal(draft),
      books: draft.books.length,
      movies: draft.movies.length,
      music: draft.music.length,
    });

    void (async () => {
      // Anonim akışta onaylanan eserler localStorage'da bekliyordu. Artık oturum
      // var: önce havuza yaz, rapora girenlerin id'lerini geri al ki analyze
      // aynı eseri ikinci kez oluşturmasın.
      try {
        const flushed = await flushLibraryStash();
        draft = {
          books: fillImportedIds(draft.books, flushed.book),
          movies: fillImportedIds(draft.movies, flushed.film),
          music: fillImportedIds(draft.music, flushed.song),
        };
      } catch (err) {
        console.error("[generating] Bekleyen kütüphane yazılamadı:", err);
      }

      analyzeAndCreateReport(draft)
      .then((reportId) => {
        posthog.capture("report_generation_completed");
        // Clear everything only on success
        clearSessionDraft();
        clearPendingReport();
        navigate("/report/" + reportId);
      })
      .catch((err: unknown) => {
        const kind = errorKind(err);
        posthog.capture("report_generation_failed", { error_type: kind });
        if (kind === "quota") posthog.capture("quota_hit");
        // Keep lens_pending_report so the user can retry
        const message =
          err instanceof Error ? err.message : "Bir hata oluştu. Lütfen tekrar deneyin.";
        setError({ kind, message });
      });
    })();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          {error.kind === "auth" ? (
            <>
              <p className="text-white text-lg">Giriş yapman gerekiyor.</p>
              <p className="text-purple-200 text-sm">{error.message}</p>
              <Button
                onClick={() => navigate("/start")}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl px-8"
              >
                Geri dön ve giriş yap
              </Button>
              <Button
                onClick={() => abandonAndGoToDashboard(navigate)}
                variant="ghost"
                className="text-purple-300/60 hover:text-purple-200 text-sm"
              >
                Vazgeç, panele dön
              </Button>
            </>
          ) : error.kind === "quota" ? (
            <>
              <p className="text-white text-lg">Günlük limit doldu.</p>
              <p className="text-purple-200 text-sm">{error.message}</p>
              <Button
                onClick={() => abandonAndGoToDashboard(navigate)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl px-8"
              >
                Panele dön
              </Button>
            </>
          ) : (
            <>
              <p className="text-red-400 text-lg">Bir hata oluştu.</p>
              <p className="text-slate-400 text-sm">{error.message}</p>
              <Button
                onClick={() => navigate("/start")}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl px-8"
              >
                Tekrar dene
              </Button>
              <Button
                onClick={() => abandonAndGoToDashboard(navigate)}
                variant="ghost"
                className="text-purple-300/60 hover:text-purple-200 text-sm"
              >
                Vazgeç, panele dön
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-2xl w-full text-center"
      >
        <motion.div
          animate={{
            rotate: 360,
            scale: [1, 1.2, 1],
          }}
          transition={{
            rotate: { duration: 2, repeat: Infinity, ease: "linear" },
            scale: { duration: 1, repeat: Infinity, ease: "easeInOut" },
          }}
          className="inline-flex items-center justify-center w-24 h-24 mb-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-2xl"
        >
          <Sparkles className="w-12 h-12 text-white" />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-3xl mb-4 text-white"
        >
          Estetik Kimliğin Oluşturuluyor...
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-purple-200 mb-12"
        >
          Tercihlerin analiz ediliyor ve kişiselleştirilmiş raporun hazırlanıyor
        </motion.p>

        {/* Animated Icons */}
        <div className="flex justify-center gap-8 mb-12">
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
          >
            <BookOpen className="w-8 h-8 text-purple-400" />
          </motion.div>
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
          >
            <Film className="w-8 h-8 text-pink-400" />
          </motion.div>
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 1 }}
          >
            <Music className="w-8 h-8 text-purple-400" />
          </motion.div>
        </div>

        {/* Indeterminate Progress Bar */}
        <div className="max-w-md mx-auto">
          <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full w-1/2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
              animate={{ x: ["0%", "200%", "0%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
