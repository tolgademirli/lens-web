import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles, BookOpen, Film, Music } from "lucide-react";
import { analyzeAndCreateReport, AnalyzeError } from "@/lib/supabase";
import { readPendingReport, clearPendingReport } from "@/lib/pendingReport";
import { flushLibraryStash } from "@/lib/userWorks";
import { Button } from "./ui/button";
import { posthog } from "@/lib/posthog";

function abandonAndGoToDashboard(nav: (path: string) => void) {
  sessionStorage.removeItem("books");
  sessionStorage.removeItem("movies");
  sessionStorage.removeItem("music");
  clearPendingReport();
  nav("/dashboard");
}

/**
 * Girişten sonra havuza yazılan eserlerin id'lerini, import'tan gelen girişlere
 * sırayla yerleştirir. Sıra güvenilir: ImportFlow seçilenleri liste sırasında
 * ekliyor, adım da aynı sırayla girişlere yazıyor.
 */
function fillImportedIds(sources: string[], ids: string[], flushed: string[]) {
  let next = 0;
  for (let i = 0; i < sources.length && next < flushed.length; i++) {
    const imported = sources[i] === "screenshot" || sources[i] === "paste";
    if (imported && !ids[i]) ids[i] = flushed[next++];
  }
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
    // Primary source: individual sessionStorage keys (direct logged-in path)
    let books = JSON.parse(sessionStorage.getItem("books") ?? "[]") as string[];
    let movies = JSON.parse(sessionStorage.getItem("movies") ?? "[]") as string[];
    let music = JSON.parse(sessionStorage.getItem("music") ?? "[]") as string[];

    // Edinim yolları (screenshot / paste / manual), girişlerle aynı sırada.
    const readSources = (key: string) => {
      try {
        return JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
      } catch {
        return [];
      }
    };
    const sources = {
      books: readSources("books_sources"),
      movies: readSources("movies_sources"),
      music: readSources("music_sources"),
    };
    // Havuzda zaten oluşturulmuş kayıtların id'leri (import yolundan gelenler).
    const workIds = {
      books: readSources("books_work_ids"),
      movies: readSources("movies_work_ids"),
      music: readSources("music_work_ids"),
    };

    // Fallback: consolidated pending report saved before OAuth redirect (max 60 dk).
    // Girişler oradan geliyorsa source'lar da oradan gelmeli — yoksa hepsi 'form'a düşer.
    if (books.length < 3 || movies.length < 3 || music.length < 3) {
      const pending = readPendingReport();
      if (pending) {
        if (pending.books.length >= 3) {
          books = pending.books;
          sources.books = pending.sources?.books ?? [];
          workIds.books = pending.workIds?.books ?? [];
        }
        if (pending.movies.length >= 3) {
          movies = pending.movies;
          sources.movies = pending.sources?.movies ?? [];
          workIds.movies = pending.workIds?.movies ?? [];
        }
        if (pending.music.length >= 3) {
          music = pending.music;
          sources.music = pending.sources?.music ?? [];
          workIds.music = pending.workIds?.music ?? [];
        }
      }
    }

    if (books.length < 3 || movies.length < 3 || music.length < 3) {
      navigate("/");
      return;
    }

    posthog.capture("report_generation_started");

    void (async () => {
      // Anonim akışta onaylanan eserler localStorage'da bekliyordu. Artık oturum
      // var: önce havuza yaz, rapora girenlerin id'lerini geri al ki analyze
      // aynı eseri ikinci kez oluşturmasın.
      try {
        const flushed = await flushLibraryStash();
        fillImportedIds(sources.books, workIds.books, flushed.book);
        fillImportedIds(sources.movies, workIds.movies, flushed.film);
        fillImportedIds(sources.music, workIds.music, flushed.song);
      } catch (err) {
        console.error("[generating] Bekleyen kütüphane yazılamadı:", err);
      }

      analyzeAndCreateReport(books, movies, music, sources, workIds)
      .then((reportId) => {
        posthog.capture("report_generation_completed");
        // Clear everything only on success
        sessionStorage.removeItem("books");
        sessionStorage.removeItem("movies");
        sessionStorage.removeItem("music");
        sessionStorage.removeItem("books_sources");
        sessionStorage.removeItem("movies_sources");
        sessionStorage.removeItem("music_sources");
        sessionStorage.removeItem("books_work_ids");
        sessionStorage.removeItem("movies_work_ids");
        sessionStorage.removeItem("music_work_ids");
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
                onClick={() => navigate("/music")}
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
                onClick={() => navigate("/music")}
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
