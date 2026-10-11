import { motion } from "motion/react";
import { Link } from "react-router";

export function FooterSection() {
  return (
    <section className="flex flex-col items-center justify-center py-10 px-6 bg-black">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        viewport={{ once: true }}
        className="text-center space-y-3"
      >
        <p className="text-slate-400 text-sm">
          Estetik Kimlik Raporu
        </p>
        <p className="text-slate-500 text-xs">
          Lens ile oluşturuldu
        </p>
        <p className="text-slate-600 text-xs">
          2026
        </p>
        {/* Paylaşılan rapor, Lens'i ilk kez gören ziyaretçinin indiği sayfa:
            metinlere buradan da ulaşılabilmeli. */}
        <nav aria-label="Hukuki metinler" className="flex justify-center gap-4 pt-2 text-xs text-slate-400">
          <Link to="/privacy" className="underline-offset-2 hover:text-white hover:underline">Gizlilik</Link>
          <Link to="/terms" className="underline-offset-2 hover:text-white hover:underline">Koşullar</Link>
          <Link to="/cookies" className="underline-offset-2 hover:text-white hover:underline">Çerezler</Link>
        </nav>
      </motion.div>
    </section>
  );
}
