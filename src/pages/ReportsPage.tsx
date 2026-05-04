import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "motion/react";
import { Sparkles, Plus, ArrowRight, Calendar, LogOut, User } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { getCurrentUser, fetchUserReports, supabase } from "@/lib/supabase";
import type { Report } from "@/lib/types";

export function ReportsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setUserEmail(user.email ?? "");
      const data = await fetchUserReports();
      setReports(data);
      setLoading(false);
    }
    init();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const formatDate = (dateStr: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500"
        >
          <Sparkles className="w-8 h-8 text-white" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Navbar */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-10 backdrop-blur-md bg-slate-900/60 border-b border-white/5"
      >
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-semibold tracking-wide text-sm">LENS</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-purple-300/70 text-sm">
              <User className="w-3.5 h-3.5" />
              <span>{userEmail}</span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-slate-400 hover:text-purple-300 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Çıkış Yap</span>
            </button>
          </div>
        </div>
      </motion.header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Page title + new report */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-end justify-between mb-8"
        >
          <div>
            <h1 className="text-3xl font-serif text-white">Raporlarım</h1>
            <p className="text-purple-300/60 text-sm mt-1">{reports.length} rapor</p>
          </div>
          <Button
            onClick={() => navigate("/books")}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-full text-sm px-5 shadow-lg shadow-purple-900/40"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Yeni Rapor
          </Button>
        </motion.div>

        {reports.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-col items-center justify-center text-center py-24 space-y-5"
          >
            <div className="w-20 h-20 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-purple-400" />
            </div>
            <div className="space-y-1.5">
              <p className="text-white text-lg font-medium">Henüz raporunuz yok</p>
              <p className="text-purple-300/60 text-sm max-w-xs">
                Favori eserlerinizi girerek estetik kimliğinizi keşfetmeye başlayın.
              </p>
            </div>
            <Button
              onClick={() => navigate("/books")}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-full px-8 mt-2"
            >
              İlk Raporunu Oluştur
            </Button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="space-y-3"
          >
            {reports.map((report, i) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.06 }}
              >
                <Link
                  to={`/rapor/${report.id}`}
                  className="group flex items-center justify-between bg-slate-800/70 hover:bg-slate-800 border border-white/5 hover:border-purple-500/30 backdrop-blur-sm rounded-2xl p-6 transition-all duration-200 hover:shadow-lg hover:shadow-purple-900/30"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 group-hover:bg-purple-500/20 transition-colors">
                      <Sparkles className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-base leading-snug truncate">
                        {report.hero.archetype}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 text-purple-300/60 text-xs">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(report.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 ml-4 w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:bg-purple-500 group-hover:border-purple-500 transition-all duration-200">
                    <ArrowRight className="w-4 h-4 text-purple-400 group-hover:text-white transition-colors" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
