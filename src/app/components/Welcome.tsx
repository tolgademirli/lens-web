import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { BookOpen, Film, Music, Sparkles } from "lucide-react";
import { Button } from "./ui/button";

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-2xl w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="inline-flex items-center justify-center w-24 h-24 mb-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-2xl"
        >
          <Sparkles className="w-12 h-12 text-white" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-6xl font-light tracking-[0.2em] mb-4 text-white"
        >
          LENS
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="space-y-4 mb-12"
        >
          <h2 className="text-2xl text-purple-200">Estetik Kimlik Raporu</h2>
          <p className="text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
            Favori eserlerinizi girerek kişisel estetik kimliğinizi keşfedelim.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex flex-wrap justify-center gap-6 mb-12"
        >
          <div className="flex items-center gap-2 text-gray-300">
            <BookOpen className="w-5 h-5 text-purple-400" />
            <span>Kitaplar</span>
          </div>
          <div className="flex items-center gap-2 text-gray-300">
            <Film className="w-5 h-5 text-pink-400" />
            <span>Filmler</span>
          </div>
          <div className="flex items-center gap-2 text-gray-300">
            <Music className="w-5 h-5 text-purple-400" />
            <span>Şarkılar</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="space-y-4"
        >
          <Button
            onClick={() => navigate("/books")}
            size="lg"
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-12 py-6 text-lg rounded-full shadow-2xl hover:shadow-purple-500/50 transition-all"
          >
            Başlayalım
          </Button>
          <div>
            <button
              onClick={() => navigate("/login")}
              className="text-purple-300 hover:text-white text-sm transition-colors"
            >
              Zaten hesabınız var mı? Giriş Yap →
            </button>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
