import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Calendar, Plus, Sparkles } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { DashboardShell } from "@/app/components/DashboardShell";
import { DiscoveryCard } from "@/app/components/DiscoveryCard";
import {
  fetchCurrentWeeklyPick,
  fetchDailyDiscovery,
  fetchUserReports,
} from "@/lib/supabase";
import { fetchActiveFeedback, signalsUntilProfile } from "@/lib/feedback";
import { fetchPlan } from "@/lib/entitlements";
import { dailyDiscoveryCards, feedbackForCard, weeklyPickCards } from "@/lib/discovery";
import { posthog } from "@/lib/posthog";
import type { DailyDiscovery, DiscoveryFeedback, WeeklyPick } from "@/lib/types";

export function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasReports, setHasReports] = useState(false);
  const [discovery, setDiscovery] = useState<DailyDiscovery | null>(null);
  const [weeklyPick, setWeeklyPick] = useState<WeeklyPick | null>(null);
  const [feedback, setFeedback] = useState<DiscoveryFeedback[]>([]);

  const reloadFeedback = async () => setFeedback(await fetchActiveFeedback());

  useEffect(() => {
    async function init() {
      const reports = await fetchUserReports();
      setHasReports(reports.length > 0);

      if (reports.length > 0) {
        const [daily, pick, signals, plan] = await Promise.all([
          fetchDailyDiscovery(),
          fetchCurrentWeeklyPick(),
          fetchActiveFeedback(),
          fetchPlan(),
        ]);
        setDiscovery(daily);
        setWeeklyPick(pick);
        setFeedback(signals);
        if (daily) posthog.capture("daily_discovery_viewed");
        // plan gerçek kaynaktan (user_preferences.plan) gelir — event için ayrı
        // bir varsayım hesaplama, ikisi ayrışır.
        if (daily?.profile_refreshed) posthog.capture("taste_profile_refreshed", { plan });
      }

      setLoading(false);
    }
    init();
  }, []);

  const formatTodayTr = () =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Istanbul",
    }).format(new Date());

  const formatWeekTr = (week: string) =>
    new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(new Date(week));

  if (!loading && !hasReports) {
    return (
      <DashboardShell>
        <div className="rounded-3xl border border-purple-500/20 bg-slate-800/50 px-6 py-16 text-center">
          <div className="mx-auto mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full border-2 border-purple-500/50 bg-purple-500/20">
            <Sparkles className="h-10 w-10 text-purple-300" />
          </div>
          <h3 className="mb-3 text-2xl text-white">Günlük keşiflerin seni bekliyor</h3>
          <p className="mx-auto mb-8 max-w-md text-purple-200">
            İlk estetik kimlik raporunu oluştur, sana özel günlük keşifler burada başlasın.
          </p>
          <Button
            onClick={() => navigate("/start")}
            className="gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-6 text-lg text-white shadow-2xl hover:from-purple-600 hover:to-pink-600"
          >
            <Plus className="h-5 w-5" />
            İlk Raporumu Oluştur
          </Button>
        </div>
      </DashboardShell>
    );
  }

  /*
    Sayaç CANLI sinyal listesinden türer, keşif yanıtındaki anlık görüntüden değil:
    `discovery.signals_until_profile` sayfa yüklenirken bir kez hesaplanır ve
    kullanıcı dokundukça değişmez. Önceden `?? ` ile yazılmıştı ve sunucu her zaman
    bir sayı döndürdüğü için istemci hesabı hiç çalışmıyordu — sayaç yükleme
    anındaki değerde donuyor, geri alınca da geri çıkmıyordu.
  */
  const remaining = signalsUntilProfile(feedback);

  return (
    <DashboardShell loading={loading}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-10"
      >
        <section>
          <SectionHeader
            Icon={Sparkles}
            title="Bugünün Keşfi"
            subtitle={`${formatTodayTr()} · estetik kimliğine göre seçildi`}
          />

          {/*
            İlerleme kullanıcıya GÖRÜNMELİ: hissedilmezse ne kalır ne dönüşür.
            Eşik dolmadan önce sayaç, dolduktan sonra haftalık ayarın işareti.
          */}
          {discovery?.profile_refreshed ? (
            <p className="mb-4 text-sm text-emerald-300/90">
              ✦ Bu haftanın ayarı yapıldı — geri bildirimlerin önerileri yeniden ağırlıklandırdı.
            </p>
          ) : remaining > 0 ? (
            /* "N geri bildirim daha" demiyoruz: sayaç dokunuş değil AĞIRLIK sayar
               (bir "bitirdim" yanıtı beş rezonans kadar eder), o yüzden sayı bire bir
               dokunuşa karşılık gelmiyordu ve iki dokunuşta sıfırlanınca yanlış
               görünüyordu. "Adım" bu sözü vermiyor. */
            <p className="mb-4 text-sm text-purple-300/70">
              Profilini güncellememe {remaining} adım kaldı — bitirdiğin eserler bu sayıyı
              en hızlı düşürür.
            </p>
          ) : (
            <p className="mb-4 text-sm text-purple-300/70">
              Her keşfe verdiğin geri bildirim yarınki seçkileri şekillendirir.
            </p>
          )}

          {discovery ? (
            /* auto-rows-fr: kartlar satır boyunca aynı yükseklikte kalır. */
            <div className="grid auto-rows-fr gap-4 md:grid-cols-3">
              {dailyDiscoveryCards(discovery).map((card) => (
                <DiscoveryCard
                  key={card.key}
                  workType={card.workType}
                  title={card.title}
                  creator={card.creator}
                  reason={card.reason}
                  origin="daily_discovery"
                  dailyDiscoveryId={discovery.id ?? null}
                  slot={card.slot}
                  feedback={feedbackForCard(feedback, discovery.id, card.slot)}
                  onChange={reloadFeedback}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-purple-500/25 bg-slate-800/30 px-6 py-10 text-center text-sm text-purple-200/80">
              Bugünün keşfi hazırlanamadı. Biraz sonra tekrar dene.
            </p>
          )}
        </section>

        {weeklyPick && weeklyPick.films?.length > 0 && (
          <section>
            <SectionHeader
              Icon={Calendar}
              title="Bu Haftanın Film & Dizi Seçkisi"
              subtitle={`${formatWeekTr(weeklyPick.week)} haftası · artık maili beklemeden burada`}
            />
            <div className="grid auto-rows-fr gap-4 md:grid-cols-3">
              {weeklyPickCards(weeklyPick).map((card) => (
                <DiscoveryCard
                  key={card.key}
                  workType={card.workType}
                  title={card.title}
                  creator={card.creator}
                  reason={card.reason}
                  origin="weekly_pick"
                  weeklyPickId={weeklyPick.id}
                  slot={card.slot}
                  feedback={feedbackForCard(feedback, weeklyPick.id, card.slot)}
                  onChange={reloadFeedback}
                />
              ))}
            </div>
          </section>
        )}
      </motion.div>
    </DashboardShell>
  );
}

function SectionHeader({
  Icon,
  title,
  subtitle,
}: {
  Icon: typeof Sparkles;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/20">
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <div className="min-w-0">
        <h2 className="font-serif text-xl text-white">{title}</h2>
        <p className="text-sm text-purple-300/70">{subtitle}</p>
      </div>
    </div>
  );
}
