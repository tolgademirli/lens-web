import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { HeroData } from "@/lib/types";

interface HeroSectionProps {
  data: HeroData;
}

export function HeroSection({ data }: HeroSectionProps) {
  const scrollToNext = () => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: 'smooth'
    });
  };

  return (
    <section className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-950">
      {/* Animated background elements */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2 }}
      >
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </motion.div>

      <div className="relative z-10 text-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          <p className="text-purple-300 uppercase tracking-[0.3em] text-xs md:text-sm mb-6 font-medium">
            Estetik Arketip
          </p>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl lg:text-9xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-pink-200 to-indigo-200 mb-6"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          {data.archetype}
        </motion.h1>

        <motion.p
          className="text-purple-200/70 text-base md:text-xl max-w-2xl mx-auto mb-12 leading-relaxed"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9 }}
        >
          {data.summary}
        </motion.p>

        <motion.button
          onClick={scrollToNext}
          className="group flex flex-col items-center gap-2 mx-auto text-purple-300 hover:text-purple-200 transition-colors"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
        >
          <span className="text-xs md:text-sm uppercase tracking-wider">Keşfet</span>
          <ChevronDown className="w-6 h-6 animate-bounce" />
        </motion.button>
      </div>
    </section>
  );
}