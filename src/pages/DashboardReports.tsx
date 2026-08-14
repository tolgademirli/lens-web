import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Calendar, ChevronRight, Globe2, Image as ImageIcon, Lock } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { DashboardShell } from "@/app/components/DashboardShell";
import { PosterShare } from "@/app/components/PosterShare";
import { fetchUserReports, updateReportVisibility } from "@/lib/supabase";
import type { Report } from "@/lib/types";

export function DashboardReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [posterFor, setPosterFor] = useState<Report | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      setReports(await fetchUserReports());
      setLoading(false);
    }
    init();
  }, []);

  /** Listeyi yeniden çekmeden tek satırın gizliliğini günceller. */
  function applyVisibility(reportId: string, isPublic: boolean) {
    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, is_public: isPublic } : r))
    );
    setPosterFor((prev) => (prev && prev.id === reportId ? { ...prev, is_public: isPublic } : prev));
  }

  async function makePrivate(report: Report) {
    setBusyId(report.id);
    const ok = await updateReportVisibility(report.id, false);
    setBusyId(null);
    if (ok) applyVisibility(report.id, false);
  }

  const formatDate = (dateStr: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));

  return (
    <DashboardShell loading={loading}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-5"
      >
        <div>
          <h2 className="font-serif text-2xl text-white">Raporların</h2>
          <p className="mt-1 text-sm text-purple-300/70">
            Estetik kimliğinin zaman içindeki kalıcı fotoğrafları.
          </p>
        </div>

        {reports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-purple-500/25 bg-slate-800/30 px-6 py-12 text-center">
            <p className="text-sm text-purple-200/80">
              Henüz bir raporun yok. "Yeni Rapor" ile ilkini oluşturabilirsin.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report, index) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.06, duration: 0.4 }}
                className="group rounded-2xl border border-purple-500/20 bg-slate-800/60 p-6 backdrop-blur-sm transition-all hover:border-purple-500/40"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-lg text-white transition-colors group-hover:text-purple-200">
                        {report.hero.archetype}
                      </h3>
                      {report.is_public ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                            <Globe2 className="h-3 w-3" /> Paylaşıma Açık
                          </span>
                          {/* Paylaşım kararı geri alınabilmeli — kullanıcı bu
                              kararı posterden vermiş olabilir, listede de dönebilsin. */}
                          <button
                            onClick={() => void makePrivate(report)}
                            disabled={busyId === report.id}
                            className="text-xs text-slate-400 underline underline-offset-2 transition-colors hover:text-slate-200 disabled:opacity-50"
                          >
                            Tekrar özel yap
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-600/40 bg-slate-700/60 px-2 py-0.5 text-xs text-slate-400">
                          <Lock className="h-3 w-3" /> Özel
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-purple-300">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">{formatDate(report.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      onClick={() => setPosterFor(report)}
                      className="gap-2 rounded-xl border border-slate-600/50 bg-slate-700/40 text-slate-200 transition-all hover:border-slate-500 hover:bg-slate-700/70 hover:text-white"
                    >
                      <ImageIcon className="h-5 w-5" />
                      <span className="hidden sm:inline">Poster</span>
                    </Button>

                    <Link to={`/report/${report.id}`}>
                      <Button className="gap-2 rounded-xl border border-purple-500/30 bg-purple-500/20 text-purple-100 transition-all hover:border-purple-400/50 hover:bg-purple-500/30 hover:text-white">
                        <span className="hidden sm:inline">Raporu Gör</span>
                        <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Poster modalı — rapor sayfasındakiyle AYNI bileşen. Gizlilik onayı da
          onun içinde, iki giriş noktası için ayrı ayrı yazılmıyor. */}
      <Dialog open={!!posterFor} onOpenChange={(open) => !open && setPosterFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border border-purple-500/25 bg-slate-900 text-white">
          <DialogHeader>
            <DialogTitle className="font-serif text-white">
              {posterFor?.hero.archetype}
            </DialogTitle>
          </DialogHeader>
          {posterFor && (
            <PosterShare
              key={posterFor.id}
              report={posterFor}
              isPublic={posterFor.is_public}
              onVisibilityChange={(isPublic) => applyVisibility(posterFor.id, isPublic)}
              compact
            />
          )}
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
