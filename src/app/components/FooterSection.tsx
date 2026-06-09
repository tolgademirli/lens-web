import { motion } from "motion/react";
import { Link } from "react-router";

export function FooterSection() {
  return (
    <section className="min-h-[60vh] flex flex-col items-center justify-center py-20 px-6 bg-gradient-to-b from-slate-950 to-black">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="text-center space-y-8"
      >
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
            to="/dashboard"
            className="text-slate-400 hover:text-purple-300 text-sm transition-colors"
          >
            Ana Sayfa
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
