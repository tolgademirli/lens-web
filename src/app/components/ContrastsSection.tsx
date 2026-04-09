import { motion } from "motion/react";
import { useInView } from "./useInView";
import { useState, useRef, useEffect } from "react";
import type { ContrastItem } from "@/lib/types";

const LEFT_GRADIENTS = [
  "from-rose-600 to-amber-600",
  "from-amber-700 to-yellow-700",
  "from-orange-700 to-red-700",
];
const RIGHT_GRADIENTS = [
  "from-blue-900 to-cyan-900",
  "from-indigo-800 to-purple-800",
  "from-teal-800 to-blue-800",
];
const EXPLANATION_COLORS = ["text-amber-300", "text-purple-300", "text-cyan-300"];

interface ContrastsSectionProps {
  data: ContrastItem[];
}

interface ContrastCardProps {
  contrast: ContrastItem;
  index: number;
  isInView: boolean;
  delay?: number;
  mobile?: boolean;
}

function ContrastCard({ contrast, index, isInView, delay = 0, mobile = false }: ContrastCardProps) {
  const leftGrad = LEFT_GRADIENTS[index % LEFT_GRADIENTS.length];
  const rightGrad = RIGHT_GRADIENTS[index % RIGHT_GRADIENTS.length];
  const explColor = EXPLANATION_COLORS[index % EXPLANATION_COLORS.length];
  const padding = mobile ? "p-4" : "p-6";
  const titleSize = mobile ? "text-xl" : "text-2xl md:text-3xl";
  const dotSize = mobile ? "w-3 h-3" : "w-4 h-4";

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.8, delay }}
      className={`${mobile ? "flex-shrink-0 w-[90vw] snap-center" : ""} rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col`}
    >
      <div className="grid grid-cols-2 relative flex-1">
        {/* Left */}
        <div className={`bg-gradient-to-br ${leftGrad} ${padding} relative`}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative z-10">
            <div className="mb-4">
              <div className={`${dotSize} rounded-full bg-white/60 mb-3 animate-pulse`} />
              <h3 className={`${titleSize} font-serif text-white mb-2`}>
                {contrast.left.title}
              </h3>
              {contrast.left.subtitle && (
                <p className="text-white/80 text-sm md:text-base mb-1">{contrast.left.subtitle}</p>
              )}
            </div>
            <p className="text-white/90 leading-relaxed text-sm">{contrast.left.description}</p>
            {contrast.left.footnote && (
              <p className="text-white/60 text-xs italic mt-2">{contrast.left.footnote}</p>
            )}
          </div>
        </div>

        {/* Right */}
        <div className={`bg-gradient-to-br ${rightGrad} ${padding} relative`}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative z-10">
            <div className="mb-4">
              <div className={`${dotSize} rounded-full bg-white/60 mb-3 animate-pulse`} />
              <h3 className={`${titleSize} font-serif text-white mb-2`}>
                {contrast.right.title}
              </h3>
              {contrast.right.subtitle && (
                <p className="text-white/80 text-sm md:text-base mb-1">{contrast.right.subtitle}</p>
              )}
            </div>
            <p className="text-white/90 leading-relaxed text-sm">{contrast.right.description}</p>
            {contrast.right.footnote && (
              <p className="text-white/60 text-xs italic mt-2">{contrast.right.footnote}</p>
            )}
          </div>
        </div>

        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30 -translate-x-1/2" />
      </div>

      <div className="bg-slate-900/90 backdrop-blur-sm p-5 border-t border-white/10">
        <h4 className={`text-base md:text-lg font-serif ${explColor} mb-2`}>
          {contrast.explanation.title}
        </h4>
        <p className="text-slate-200 leading-relaxed text-sm">{contrast.explanation.text}</p>
      </div>
    </motion.div>
  );
}

export function ContrastsSection({ data }: ContrastsSectionProps) {
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
      className="min-h-screen flex items-center justify-center py-20 px-6 bg-gradient-to-br from-rose-950 via-pink-950 to-purple-950 relative overflow-hidden"
    >
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
      </div>

      <div className="max-w-7xl w-full relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <p className="text-pink-300 uppercase tracking-wider text-sm mb-2">Bölüm 4</p>
          <h2 className="text-3xl md:text-5xl font-serif text-pink-100 mb-4">Kontrastlar</h2>
          <p className="text-pink-200/60 italic text-base md:text-lg">Zıtlıkların Dansı</p>
        </motion.div>

        {/* Desktop Grid */}
        <div className={`hidden lg:grid gap-6 items-stretch ${data.length === 1 ? "lg:grid-cols-1 max-w-2xl mx-auto" : "lg:grid-cols-2"}`}>
          {data.map((contrast, index) => (
            <ContrastCard
              key={index}
              contrast={contrast}
              index={index}
              isInView={isInView}
              delay={0.2 + index * 0.2}
            />
          ))}
        </div>

        {/* Mobile Carousel */}
        <div className="lg:hidden">
          <div
            ref={scrollRef}
            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 -mx-6 px-6"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {data.map((contrast, index) => (
              <ContrastCard
                key={index}
                contrast={contrast}
                index={index}
                isInView={isInView}
                delay={0.2 + index * 0.2}
                mobile
              />
            ))}
          </div>

          <div className="flex justify-center gap-2 mt-6">
            {data.map((_, index) => (
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
                  activeIndex === index ? "w-8 bg-pink-400" : "w-2 bg-pink-400/30"
                }`}
                aria-label={`Go to contrast ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
