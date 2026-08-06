import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowLeft, Film, Sparkles, User } from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { getCurrentUser } from "@/lib/supabase";
import { fetchPreferences, setWeeklyPicksEnabled, DEFAULT_PREFERENCES } from "@/lib/preferences";
import { posthog } from "@/lib/posthog";

export function Settings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [weeklyPicks, setWeeklyPicks] = useState(DEFAULT_PREFERENCES.weekly_picks_enabled);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setUserEmail(user.email ?? "");
      const prefs = await fetchPreferences();
      setWeeklyPicks(prefs.weekly_picks_enabled);
      setLoading(false);
    }
    init();
  }, [navigate]);

  // Optimistic: toggle anında döner, yazım başarısızsa eski değere geri alınır.
  const handleWeeklyPicksChange = async (next: boolean) => {
    const previous = weeklyPicks;
    setWeeklyPicks(next);
    setSaveFailed(false);

    const ok = await setWeeklyPicksEnabled(next);
    if (!ok) {
      setWeeklyPicks(previous);
      setSaveFailed(true);
      return;
    }

    // Yalnızca kapatma sinyal — açık kalmak varsayılan durum.
    if (!next) posthog.capture("weekly_pick_optout");
  };

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
      {/* Header */}
      <div className="border-b border-purple-500/20 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-4 flex items-center gap-4">
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
      </div>

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
          <h2 className="text-xl text-white font-serif">Ayarlar</h2>

          <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-purple-500/20 p-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-10 h-10 shrink-0 rounded-lg bg-pink-500/20 flex items-center justify-center">
                  <Film className="w-5 h-5 text-pink-200" />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="weekly-picks"
                    className="text-white block cursor-pointer"
                  >
                    Haftalık film önerileri al
                  </label>
                  <p className="text-purple-300/70 text-sm mt-1 leading-relaxed">
                    Estetik kimliğine yakın düşen birkaç filmi haftada bir e-posta
                    olarak gönderiyoruz. İstemediğinde buradan kapatabilirsin.
                  </p>
                </div>
              </div>

              <Switch
                id="weekly-picks"
                checked={weeklyPicks}
                onCheckedChange={handleWeeklyPicksChange}
                className="mt-1 shrink-0 data-[state=checked]:bg-purple-500 data-[state=unchecked]:bg-slate-600"
              />
            </div>

            {saveFailed && (
              <p className="text-red-400 text-sm mt-4">
                Ayar kaydedilemedi. Bağlantını kontrol edip tekrar dene.
              </p>
            )}
          </div>

          <button
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-1.5 text-purple-300/60 hover:text-purple-200 text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Panele Dön
          </button>
        </motion.div>
      </div>
    </div>
  );
}
