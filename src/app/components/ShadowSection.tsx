import { motion } from "motion/react";
import { useInView } from "./useInView";
import { Book, Film, Music } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { ShadowItem } from "@/lib/types";

const TYPE_CONFIG = {
  Kitap: {
    icon: Book,
    gradient: "from-emerald-900/60 to-teal-900/60",
    iconBgStyle: { backgroundColor: "rgba(20,184,166,0.15)", borderColor: "rgba(45,212,191,0.3)" },
    iconStyle: { color: "#5eead4" },
    labelStyle: { color: "#5eead4" },
  },
  Film: {
    icon: Film,
    gradient: "from-violet-900/60 to-purple-900/60",
    iconBgStyle: { backgroundColor: "rgba(139,92,246,0.15)", borderColor: "rgba(167,139,250,0.3)" },
    iconStyle: { color: "#c4b5fd" },
    labelStyle: { color: "#c4b5fd" },
  },
  Müzik: {
    icon: Music,
    gradient: "from-amber-900/60 to-orange-900/60",
    iconBgStyle: { backgroundColor: "rgba(245,158,11,0.15)", borderColor: "rgba(252,211,77,0.3)" },
    iconStyle: { color: "#fcd34d" },
    labelStyle: { color: "#fcd34d" },
  },
} as const;

interface ShadowSectionProps {
  data: ShadowItem[];
}

export function ShadowSection({ data }: ShadowSectionProps) {
  const { ref, isInView } = useInView();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollLeft = scrollContainer.scrollLeft;
      const cardWidth = scrollContainer.offsetWidth;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveIndex(index);
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, []);

  const recommendations = data.map((item) => {
    const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG["Kitap"];
    const displayTitle = item.title
      ? `${item.title} — ${item.author_or_artist}`
      : item.author_or_artist;
    return { ...item, ...config, displayTitle };
  });

  return (
    <section
      ref={ref}
      className="min-h-screen flex items-center justify-center py-20 px-6 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 relative overflow-hidden"
    >
      <div className="absolute inset-0">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl w-full relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <p className="text-indigo-300 uppercase tracking-wider text-sm mb-2">Bölüm 5</p>
          <h2 className="text-3xl md:text-5xl font-serif text-indigo-100 mb-4">Gölge Yanım</h2>
          <p className="text-indigo-200/60 italic text-base md:text-lg">Henüz Keşfedilmemiş Estetik Bölgeler</p>
        </motion.div>

        {/* Desktop Grid */}
        <div className="hidden md:grid md:grid-cols-3 gap-6">
          {recommendations.map((rec, index) => {
            const Icon = rec.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 50 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className={`group bg-gradient-to-br ${rec.gradient} backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/10 hover:border-white/30 transition-all cursor-pointer hover:scale-105 hover:shadow-2xl`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 rounded-full border group-hover:scale-110 transition-transform" style={rec.iconBgStyle}>
                    <Icon className="w-6 h-6" style={rec.iconStyle} />
                  </div>
                  <span className="text-sm uppercase tracking-wider" style={rec.labelStyle}>
                    {rec.type}
                  </span>
                </div>

                <h3 className="text-xl md:text-2xl font-serif text-white mb-3">
                  {rec.displayTitle}
                </h3>

                {rec.year && (
                  <p className="text-slate-400 text-sm mb-3">{rec.year}</p>
                )}

                <p className="text-slate-200 leading-relaxed text-sm">{rec.description}</p>

                <div className="mt-6 pt-4 border-t border-white/10">
                  <span className="text-white/60 text-xs uppercase tracking-wider group-hover:text-white/80 transition-colors">
                    Keşfet →
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Mobile Carousel */}
        <div className="md:hidden">
          <div
            ref={scrollRef}
            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 -mx-6 px-6"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {recommendations.map((rec, index) => {
              const Icon = rec.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 50 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: index * 0.2 }}
                  className={`flex-shrink-0 w-[85vw] snap-center bg-gradient-to-br ${rec.gradient} backdrop-blur-sm rounded-2xl p-6 border border-white/10`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-full border" style={rec.iconBgStyle}>
                      <Icon className="w-6 h-6" style={rec.iconStyle} />
                    </div>
                    <span className="text-sm uppercase tracking-wider" style={rec.labelStyle}>
                      {rec.type}
                    </span>
                  </div>

                  <h3 className="text-xl font-serif text-white mb-3">{rec.displayTitle}</h3>

                  {rec.year && (
                    <p className="text-slate-400 text-sm mb-3">{rec.year}</p>
                  )}

                  <p className="text-slate-200 leading-relaxed text-sm">{rec.description}</p>

                  <div className="mt-6 pt-4 border-t border-white/10">
                    <span className="text-white/60 text-xs uppercase tracking-wider">Keşfet →</span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="flex justify-center gap-2 mt-6">
            {recommendations.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  const scrollContainer = scrollRef.current;
                  if (scrollContainer) {
                    scrollContainer.scrollTo({
                      left: scrollContainer.offsetWidth * index,
                      behavior: "smooth",
                    });
                  }
                }}
                className={`h-2 rounded-full transition-all ${
                  activeIndex === index ? "w-8 bg-indigo-400" : "w-2 bg-indigo-400/30"
                }`}
                aria-label={`Go to card ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
