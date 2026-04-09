import { motion } from "motion/react";
import { useInView } from "./useInView";
import type { TextureData } from "@/lib/types";

interface TextureSectionProps {
  data: TextureData;
}

export function TextureSection({ data }: TextureSectionProps) {
  const { ref, isInView } = useInView();

  return (
    <section
      ref={ref}
      className="min-h-screen flex items-center justify-center py-20 px-6 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 relative overflow-hidden"
    >
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/20 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl w-full grid md:grid-cols-2 gap-12 items-center relative z-10">
        {/* Left: Text */}
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="space-y-6"
        >
          <div>
            <p className="text-blue-300 uppercase tracking-wider text-sm mb-2">Bölüm 2</p>
            <h2 className="text-3xl md:text-5xl font-serif text-blue-100 mb-4">Doku Analizi</h2>
            <p className="text-blue-200/60 italic text-base md:text-lg">Senin Dünyan Nasıl Hissettiriyor?</p>
          </div>

          {data.descriptions.map((paragraph, i) => (
            <p key={i} className="text-slate-200 text-base md:text-lg leading-relaxed">
              {paragraph}
            </p>
          ))}
        </motion.div>

        {/* Right: Color Palette */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-8 md:mt-12"
        >
          <h3 className="text-lg md:text-xl font-serif text-blue-200 mb-4 md:mb-6 text-center">Senin Renk Paletin</h3>
          <div className="grid grid-cols-3 gap-3 md:gap-6">
            {data.colors.map((color, index) => (
              <motion.div
                key={color.name}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={isInView ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.5, delay: 0.8 + index * 0.1 }}
                className="flex flex-col items-center"
              >
                <div
                  className="w-16 h-16 md:w-24 md:h-24 rounded-2xl shadow-lg mb-2 md:mb-3"
                  style={{ backgroundColor: color.hex }}
                />
                <p className="text-slate-300 text-xs md:text-sm font-medium">{color.name}</p>
                <p className="text-slate-500 text-[10px] md:text-xs">{color.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}