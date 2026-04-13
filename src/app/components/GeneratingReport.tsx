import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles, BookOpen, Film, Music } from "lucide-react";
import { analyzeAndCreateReport } from "@/lib/supabase";
import { Button } from "./ui/button";

export function GeneratingReport() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const books = JSON.parse(sessionStorage.getItem("books") ?? "[]") as string[];
    const movies = JSON.parse(sessionStorage.getItem("movies") ?? "[]") as string[];
    const music = JSON.parse(sessionStorage.getItem("music") ?? "[]") as string[];

    if (books.length < 3 || movies.length < 3 || music.length < 3) {
      navigate("/");
      return;
    }

    analyzeAndCreateReport(books, movies, music)
      .then((reportId) => {
        sessionStorage.removeItem("books");
        sessionStorage.removeItem("movies");
        sessionStorage.removeItem("music");
        navigate("/rapor/" + reportId);
      })
      .catch((err: Error) => setError(err?.message ?? "Bilinmeyen hata"));
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <p className="text-red-400 text-lg">Bir hata oluştu.</p>
          <p className="text-slate-400 text-sm">{error}</p>
          <Button
            onClick={() => navigate("/")}
            variant="ghost"
            className="text-purple-200 hover:text-white"
          >
            Ana sayfaya dön
          </Button>
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
