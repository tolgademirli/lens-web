import { motion } from "motion/react";
import { ReactNode } from "react";
import { Progress } from "./ui/progress";

interface StepLayoutProps {
  step: number;
  totalSteps: number;
  icon: ReactNode;
  title: string;
  subtitle: string;
  /**
   * Kart üstündeki ipucu şeridi. Verilmezse varsayılan giriş sınırı metni çıkar;
   * `null` verilirse şerit hiç gösterilmez (import akışının kendi başlığı var).
   */
  hint?: ReactNode;
  children: ReactNode;
}

export function StepLayout({
  step, totalSteps, icon, title, subtitle, hint, children,
}: StepLayoutProps) {
  const progress = (step / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-3xl w-full"
      >
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-purple-200">Adım {step} / {totalSteps}</span>
            <span className="text-sm text-purple-200">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-slate-700" />
        </div>

        {/* Main Card */}
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-3xl shadow-2xl p-8 md:p-12 border border-purple-500/20">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
              {icon}
            </div>
            <div>
              <h2 className="text-3xl mb-1 text-white">{title}</h2>
              <p className="text-purple-200">{subtitle}</p>
            </div>
          </div>

          {hint !== null && (
            <div className="bg-purple-900/30 border border-purple-500/30 rounded-2xl p-6 mb-8">
              {hint ?? (
                <p className="text-sm text-purple-100">
                  <strong>En az 3, en fazla 8</strong> giriş ekleyebilirsin.
                </p>
              )}
            </div>
          )}

          {children}
        </div>
      </motion.div>
    </div>
  );
}
