import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "motion/react";
import { Sparkles, ChevronRight, Plus } from "lucide-react";
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-2"
        >
          <h1 className="text-2xl font-serif text-white">Raporlarım</h1>
          <Button
            onClick={() => navigate("/")}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-full text-sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            Yeni Rapor
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center gap-3 mb-8"
        >
          <span className="text-purple-300 text-sm">{userEmail}</span>
          <span className="text-slate-600">·</span>
          <button
            onClick={handleSignOut}
            className="text-slate-400 hover:text-purple-300 text-sm transition-colors"
          >
            Çıkış Yap
          </button>
        </motion.div>

        {reports.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-center py-20 space-y-4"
          >
            <Sparkles className="w-12 h-12 text-purple-500 mx-auto" />
            <p className="text-purple-200 text-lg">Henüz raporunuz yok.</p>
            <Button
              onClick={() => navigate("/")}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-full px-8"
            >
              İlk Raporunu Oluştur
            </Button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="space-y-3"
          >
            {reports.map((report, i) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="bg-slate-800/90 backdrop-blur-sm rounded-2xl p-5 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <p className="text-white font-serif text-lg">{report.hero.archetype}</p>
                  <p className="text-purple-300 text-sm">{formatDate(report.created_at)}</p>
                </div>
                <Link
                  to={`/rapor/${report.id}`}
                  className="flex items-center gap-1 text-sm text-purple-300 hover:text-white transition-colors shrink-0 ml-4"
                >
                  Raporu Gör
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
