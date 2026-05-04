import { motion } from "motion/react";
import { Share2, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export function FooterSection() {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Estetik Kimlik Raporum",
          text: "Estetik Kimlik Raporu",
          url: url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Share cancelled or failed silently
    }
  };

  return (
    <section className="min-h-[60vh] flex flex-col items-center justify-center py-20 px-6 bg-gradient-to-b from-slate-950 to-black">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="text-center space-y-8"
      >
        {/* Share Button */}
        <button
          onClick={handleShare}
          className="group inline-flex items-center gap-3 px-8 py-4 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          {copied ? (
            <>
              <Check className="w-5 h-5" />
              <span>Kopyalandı!</span>
            </>
          ) : (
            <>
              <Share2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              <span>Raporu Paylaş</span>
            </>
          )}
        </button>

        {/* Navigation */}
        <div className="flex items-center gap-6 justify-center">
          <Link
            to="/books"
            className="text-slate-400 hover:text-purple-300 text-sm transition-colors"
          >
            Yeni Rapor Oluştur
          </Link>
          <span className="text-slate-700">·</span>
          <Link
            to="/reports"
            className="text-slate-400 hover:text-purple-300 text-sm transition-colors"
          >
            Raporlarım
          </Link>
        </div>

        {/* Divider */}
        <div className="w-64 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent mx-auto" />

        {/* Footer text */}
        <div className="space-y-3">
          <p className="text-slate-400 text-sm">
            Estetik Kimlik Raporu
          </p>
          <p className="text-slate-500 text-xs">
            Lens ile oluşturuldu
          </p>
          <p className="text-slate-600 text-xs">
            2026
          </p>
        </div>
      </motion.div>
    </section>
  );
}
