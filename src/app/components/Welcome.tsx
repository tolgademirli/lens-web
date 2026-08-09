import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { EmailOptInModal } from "./EmailOptInModal";
import { posthog } from "@/lib/posthog";
import { CATEGORIES } from "./categories";

/**
 * Giriş sayfası. Ortalanmış kompozisyon, gradyan zemin ve sparkle markı kasıtlı:
 * burası bir "marka anı", form değil. /start'ın düz koyu yüzeyi ise çalışma
 * ekranı — iki dilin farklı olması bilinçli, tutarlılık adına buranın sakinliği
 * feda edilmiyor.
 */
export function Welcome() {
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    posthog.capture("landing_viewed");
  }, []);

  // Kategori şeridi /start'ın sekmeleriyle aynı kaynaktan okunur; etiket ya da
  // ikon orada değişirse burası kendiliğinden takip eder.
  const iconTone = ["text-purple-400", "text-pink-400", "text-purple-400"];

  return (
    <>
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
            Son zamanlarda sende iz bırakan birkaç şeyi söyle, gerisini ben tamamlarım.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex flex-wrap justify-center gap-6 mb-12"
        >
          {CATEGORIES.map((cfg, i) => (
            <div key={cfg.key} className="flex items-center gap-2 text-gray-300">
              <cfg.icon className={`w-5 h-5 ${iconTone[i]}`} strokeWidth={1.75} aria-hidden />
              <span>{cfg.label}</span>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="space-y-4"
        >
          <Button
            onClick={() => navigate("/start")}
            size="lg"
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-12 py-6 text-lg rounded-full shadow-2xl hover:shadow-purple-500/50 transition-all"
          >
            Kimliğini Keşfet
          </Button>
          <div>
            {/* purple-300/70 gradyanın en açık yerinde 3.79:1 ile AA altındaydı;
                tam opak purple-200 ile 7.99:1. */}
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-purple-200 hover:text-white text-sm transition-colors"
            >
              Zaten hesabın var mı? <span className="font-semibold">Giriş yap →</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </div>
    <EmailOptInModal open={showAuthModal} onOpenChange={setShowAuthModal} context="login" />
    </>
  );
}
