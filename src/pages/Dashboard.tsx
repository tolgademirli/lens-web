import { useEffect, useState, useRef } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "motion/react";
import { Sparkles, Plus, LogOut, ChevronRight, Calendar, User, BookOpen, Film, Music, Lock, Globe2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { getCurrentUser, fetchUserReports, fetchDailyDiscovery, supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import type { Report, DailyDiscovery } from "@/lib/types";

export function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [dailyDiscovery, setDailyDiscovery] = useState<DailyDiscovery | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);


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

      if (data.length > 0) {
        const discovery = await fetchDailyDiscovery();
        setDailyDiscovery(discovery);
        if (discovery) posthog.capture("daily_discovery_viewed");
      }

      setLoading(false);
    }
    init();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const scrollToCard = (index: number) => {
    if (!scrollRef.current) return;
    const { scrollWidth, offsetWidth } = scrollRef.current;
    const maxScroll = scrollWidth - offsetWidth;
    scrollRef.current.scrollTo({ left: (maxScroll / 2) * index, behavior: "smooth" });
  };

  const formatDate = (dateStr: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));

  const formatTodayTr = () =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Istanbul",
    }).format(new Date());

  const hasReports = reports.length > 0;

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
      {/* Header — sticky */}
      <div className="sticky top-0 z-10 border-b border-purple-500/20 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl text-white tracking-widest font-light">LENS</h1>
                <div className="flex items-center gap-2 text-sm text-purple-200">
                  <User className="w-4 h-4" />
                  <span>{userEmail}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => navigate("/books")}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl gap-2 shadow-lg"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Yeni Rapor</span>
              </Button>
              <Button
                variant="ghost"
                onClick={handleSignOut}
                className="text-purple-200 hover:text-white hover:bg-slate-700/50 rounded-xl gap-2"
              >
                <span className="hidden sm:inline">Çıkış Yap</span>
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="md:flex md:gap-8 md:items-start">

          {/* Sol kolon — Daily Discovery (sticky on desktop) */}
          <div className="md:w-[45%] md:sticky md:top-[81px]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="bg-gradient-to-br from-indigo-900 via-purple-800 to-pink-900 rounded-3xl p-8 shadow-2xl border border-purple-500/20 relative">
                {/* Locked Overlay for users without reports */}
                {!hasReports && (
                  <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md rounded-3xl z-10 flex items-center justify-center">
                    <div className="text-center px-6">
                      <div className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-full bg-purple-500/20 border-2 border-purple-500/50">
                        <Sparkles className="w-10 h-10 text-purple-300" />
                      </div>
                      <h3 className="text-2xl text-white mb-4">Günlük Keşifleriniz Sizi Bekliyor</h3>
                      <p className="text-purple-200 mb-8 max-w-md mx-auto">
                        İlk estetik kimlik raporunuzu oluşturun ve size özel günlük keşiflere erişin
                      </p>
                      <Button
                        onClick={() => navigate("/books")}
                        className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-8 py-6 text-lg rounded-xl gap-2 shadow-2xl"
                      >
                        <Plus className="w-5 h-5" />
                        İlk Raporumu Oluştur
                      </Button>
                    </div>
                  </div>
                )}

                {/* Background decoration — overflow clipped to card boundary */}
                <div className="absolute inset-0 overflow-hidden rounded-3xl opacity-5 pointer-events-none">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-purple-300 rounded-full -translate-y-32 translate-x-32 blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-96 h-96 bg-pink-300 rounded-full translate-y-48 -translate-x-48 blur-3xl" />
                </div>

                <div className="relative">
                  <div className="flex items-center gap-3 mb-6">
                    <Sparkles className="w-8 h-8 text-purple-200" />
                    <div>
                      <h2 className="text-2xl text-white">Bugünün Keşfi</h2>
                      <p className="text-purple-200/80 text-sm">{formatTodayTr()}</p>
                    </div>
                  </div>

                  <p className="text-purple-100/90 mb-6 text-base">
                    Estetik kimliğinize göre bugün için özel olarak seçildi
                  </p>

                  {/* MOBILE: yatay carousel */}
                  <div
                    ref={scrollRef}
                    onScroll={() => {
                      if (!scrollRef.current) return;
                      const { scrollLeft, scrollWidth, offsetWidth } = scrollRef.current;
                      const maxScroll = scrollWidth - offsetWidth;
                      if (maxScroll > 0) setActiveIndex(Math.round((scrollLeft / maxScroll) * 2));
                    }}
                    className="flex md:hidden overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-3 -mx-8 px-8 pb-2"
                  >
                    {/* Kitap */}
                    <div className="flex-shrink-0 w-[82%] snap-center bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/30 flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-purple-200" />
                        </div>
                        <span className="text-purple-300/80 text-sm">Kitap</span>
                      </div>
                      <p className="text-white font-medium">{dailyDiscovery?.book ?? "—"}</p>
                      {dailyDiscovery?.reasons?.book && (
                        <p className="text-purple-300/60 text-xs mt-2 leading-relaxed">{dailyDiscovery.reasons.book}</p>
                      )}
                    </div>

                    {/* Film */}
                    <div className="flex-shrink-0 w-[82%] snap-center bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-pink-500/30">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-lg bg-pink-500/30 flex items-center justify-center">
                          <Film className="w-5 h-5 text-pink-200" />
                        </div>
                        <span className="text-pink-300/80 text-sm">Film</span>
                      </div>
                      <p className="text-white font-medium">{dailyDiscovery?.film ?? "—"}</p>
                      {dailyDiscovery?.reasons?.film && (
                        <p className="text-pink-300/60 text-xs mt-2 leading-relaxed">{dailyDiscovery.reasons.film}</p>
                      )}
                    </div>

                    {/* Müzik */}
                    <div className="flex-shrink-0 w-[82%] snap-center bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-indigo-500/30">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/30 flex items-center justify-center">
                          <Music className="w-5 h-5 text-indigo-200" />
                        </div>
                        <span className="text-indigo-300/80 text-sm">Müzik</span>
                      </div>
                      <p className="text-white font-medium">{dailyDiscovery?.music ?? "—"}</p>
                      {dailyDiscovery?.reasons?.music && (
                        <p className="text-indigo-300/60 text-xs mt-2 leading-relaxed">{dailyDiscovery.reasons.music}</p>
                      )}
                    </div>
                  </div>

                  {/* Dot indicators (mobile only) */}
                  <div className="flex md:hidden justify-center gap-2 mt-4">
                    {[0, 1, 2].map((i) => (
                      <button
                        key={i}
                        onClick={() => scrollToCard(i)}
                        className={`h-2 rounded-full transition-all ${activeIndex === i ? "w-8 bg-purple-400" : "w-2 bg-purple-400/30"}`}
                      />
                    ))}
                  </div>

                  {/* DESKTOP: dikey stack */}
                  <div className="hidden md:flex flex-col gap-3">
                    {/* Kitap */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="bg-slate-800/60 backdrop-blur-sm rounded-xl p-5 border border-purple-500/30"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/30 flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-purple-200" />
                        </div>
                        <span className="text-purple-300/80 text-sm">Kitap</span>
                      </div>
                      <p className="text-white font-medium text-sm">{dailyDiscovery?.book ?? "—"}</p>
                      {dailyDiscovery?.reasons?.book && (
                        <p className="text-purple-300/60 text-xs mt-1.5 leading-relaxed">{dailyDiscovery.reasons.book}</p>
                      )}
                    </motion.div>

                    {/* Film */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="bg-slate-800/60 backdrop-blur-sm rounded-xl p-5 border border-pink-500/30"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-lg bg-pink-500/30 flex items-center justify-center">
                          <Film className="w-4 h-4 text-pink-200" />
                        </div>
                        <span className="text-pink-300/80 text-sm">Film</span>
                      </div>
                      <p className="text-white font-medium text-sm">{dailyDiscovery?.film ?? "—"}</p>
                      {dailyDiscovery?.reasons?.film && (
                        <p className="text-pink-300/60 text-xs mt-1.5 leading-relaxed">{dailyDiscovery.reasons.film}</p>
                      )}
                    </motion.div>

                    {/* Müzik */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="bg-slate-800/60 backdrop-blur-sm rounded-xl p-5 border border-indigo-500/30"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-lg bg-indigo-500/30 flex items-center justify-center">
                          <Music className="w-4 h-4 text-indigo-200" />
                        </div>
                        <span className="text-indigo-300/80 text-sm">Müzik</span>
                      </div>
                      <p className="text-white font-medium text-sm">{dailyDiscovery?.music ?? "—"}</p>
                      {dailyDiscovery?.reasons?.music && (
                        <p className="text-indigo-300/60 text-xs mt-1.5 leading-relaxed">{dailyDiscovery.reasons.music}</p>
                      )}
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Sağ kolon — Geçmiş Raporlarım */}
          {hasReports && (
            <div className="md:flex-1 mt-8 md:mt-0">
              <h3 className="text-xl text-white mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-400" />
                Geçmiş Raporlarım
              </h3>

              <div className="space-y-4 pb-8">
                {reports.map((report, index) => (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1, duration: 0.4 }}
                    className="group bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-purple-500/20 hover:border-purple-500/40 transition-all overflow-hidden hover:shadow-2xl hover:shadow-purple-500/10"
                  >
                    <div className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h3 className="text-lg text-white group-hover:text-purple-200 transition-colors">
                              {report.hero.archetype}
                            </h3>
                            {report.is_public ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                <Globe2 className="w-3 h-3" /> Paylaşıma Açık
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-slate-700/60 text-slate-400 border-slate-600/40">
                                <Lock className="w-3 h-3" /> Özel
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-purple-300">
                            <Calendar className="w-4 h-4" />
                            <span className="text-sm">{formatDate(report.created_at)}</span>
                          </div>
                        </div>

                        <Link to={`/report/${report.id}`} className="shrink-0">
                          <Button className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-100 hover:text-white border border-purple-500/30 hover:border-purple-400/50 rounded-xl gap-2 transition-all">
                            <span>Raporu Gör</span>
                            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
