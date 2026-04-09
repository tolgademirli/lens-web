import { motion } from "motion/react";
import { useInView } from "./useInView";
import { useState, useRef, useEffect } from "react";
import type { ThreadItem } from "@/lib/types";

const GRADIENTS = [
  "from-slate-800/60 to-purple-900/60",
  "from-purple-900/60 to-indigo-900/60",
  "from-indigo-900/60 to-blue-900/60",
  "from-blue-900/60 to-cyan-900/60",
  "from-cyan-900/60 to-teal-900/60",
];

interface ThreadsSectionProps {
  data: ThreadItem[];
}

export function ThreadsSection({ data }: ThreadsSectionProps) {
  const threads = data.map((t, i) => ({
    ...t,
    gradient: GRADIENTS[i % GRADIENTS.length],
  }));
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

  return (
    <section
      ref={ref}
      className="min-h-screen flex items-center justify-center py-20 px-6 bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 relative overflow-hidden"
    >
      {/* Mystical background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 right-1/3 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse" />
      </div>

      <div className="max-w-7xl w-full relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <p className="text-purple-300 uppercase tracking-wider text-sm mb-2">Bölüm 3</p>
          <h2 className="text-3xl md:text-5xl font-serif text-purple-100 mb-4">Görünmez İpler</h2>
          <p className="text-purple-200/60 italic text-base md:text-lg">Ortak Tematik Doku</p>
        </motion.div>

        {/* Desktop Grid */}
        <div className="hidden md:grid md:grid-cols-3 gap-6">
          {threads.map((thread, index) => (
            <motion.div
              key={thread.title}
              initial={{ opacity: 0, y: 50 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.2 }}
              className={`bg-gradient-to-br ${thread.gradient} backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-white/10 hover:border-white/20 transition-all hover:scale-105`}
            >
              <h3 className="text-xl md:text-2xl font-serif text-white mb-4">
                {thread.title}
              </h3>
              <p className="text-slate-200 leading-relaxed text-sm md:text-base">
                {thread.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Mobile Carousel */}
        <div className="md:hidden">
          <div
            ref={scrollRef}
            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 -mx-6 px-6"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {threads.map((thread, index) => (
              <motion.div
                key={thread.title}
                initial={{ opacity: 0, y: 50 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className={`flex-shrink-0 w-[85vw] snap-center bg-gradient-to-br ${thread.gradient} backdrop-blur-sm rounded-2xl p-6 border border-white/10`}
              >
                <h3 className="text-xl font-serif text-white mb-4">
                  {thread.title}
                </h3>
                <p className="text-slate-200 leading-relaxed text-sm">
                  {thread.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Dots Indicator */}
          <div className="flex justify-center gap-2 mt-6">
            {threads.map((_, index) => (
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
                  activeIndex === index
                    ? "w-8 bg-purple-400"
                    : "w-2 bg-purple-400/30"
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