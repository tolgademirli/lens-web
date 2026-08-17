import { useEffect, useState } from "react";
import { CreditCard, Lock, Mail, MonitorPlay } from "lucide-react";
import { DashboardShell } from "@/app/components/DashboardShell";
import { Switch } from "@/app/components/ui/switch";
import {
  fetchPreferences,
  setPlatforms,
  setWeeklyPicksEnabled,
  DEFAULT_PREFERENCES,
} from "@/lib/preferences";
import {
  fetchPlatformOptions,
  isAllPlatforms,
  WATCH_DATA_CREDIT,
  type PlatformOption,
} from "@/lib/platforms";
import { posthog } from "@/lib/posthog";
import type { UserPlan } from "@/lib/types";

/**
 * /account — "Hesabım". Paket ve öneri tercihleri TEK sayfada.
 *
 * Neden ayrı sayfa ve neden panelin içinde: tercihler eskiden panelin dışındaki
 * /settings'te duruyordu; kullanıcı ayarı değiştirip panele dönmek için geri
 * tuşuna basıyordu. Paket bilgisi de geldiğinde ikisi aynı soruyu cevaplıyor
 * ("Lens bana ne veriyor, ben neyi seçtim"), o yüzden aynı yerdeler.
 *
 * ÖDEME AKIŞI HENÜZ YOK. Paket kartındaki aksiyonlar bilerek işlevsiz; `plan`
 * kolonunu client zaten yazamıyor (guard_user_preferences_plan trigger'ı yutar),
 * yani buraya bir "premium yap" düğmesi koymak sahte bir söz olurdu. Ödeme akışı
 * (US-08) geldiğinde yazılacak yer burası.
 */
export function Account() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<UserPlan>(DEFAULT_PREFERENCES.plan);

  // <boolean> AÇIKÇA yazılıyor: DEFAULT_PREFERENCES `as const` olduğu için
  // weekly_picks_enabled'ın tipi `true` (literal) ve useState onu daraltıyordu.
  const [weeklyPicks, setWeeklyPicks] = useState<boolean>(
    DEFAULT_PREFERENCES.weekly_picks_enabled
  );
  const [saveFailed, setSaveFailed] = useState(false);

  // null = "Tümü". Boş dizi tutmuyoruz: DB'de de yasak, iki temsil karışmasın.
  const [platforms, setPlatformsState] = useState<string[] | null>(null);
  const [options, setOptions] = useState<PlatformOption[]>([]);
  const [platformsFailed, setPlatformsFailed] = useState(false);

  const [upgradeNote, setUpgradeNote] = useState(false);

  useEffect(() => {
    async function init() {
      // Oturum denetimi DashboardShell'de; burada tekrar etmiyoruz.
      const [prefs, opts] = await Promise.all([fetchPreferences(), fetchPlatformOptions()]);
      setWeeklyPicks(prefs.weekly_picks_enabled);
      setPlatformsState(prefs.platforms);
      setPlan(prefs.plan);
      setOptions(opts);
      setLoading(false);
    }
    init();
  }, []);

  /**
   * Filtre PREMIUM özelliği. Buradaki kontrol yalnızca ANLATIM içindir — asıl
   * zorlama `lens_weekly_pick_candidates`'ta, ücretsiz pakette `platforms` NULL
   * dönüyor. Kart ücretsiz kullanıcıya da gösteriliyor (kilitli): var olduğunu
   * bilmediği bir özelliği kimse istemez.
   */
  const isPremium = plan === "premium";
  const canFilter = isPremium;

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

  const writePlatforms = async (next: string[] | null) => {
    const previous = platforms;
    setPlatformsState(next);
    setPlatformsFailed(false);

    const ok = await setPlatforms(next ?? []);
    if (!ok) {
      setPlatformsState(previous);
      setPlatformsFailed(true);
      return;
    }
    posthog.capture("weekly_pick_platforms_changed", {
      // Slug listesini event'e koymuyoruz; kaç platform seçildiği yeterli sinyal.
      platform_count: next?.length ?? 0,
      all: next === null,
    });
  };

  const togglePlatform = (slug: string) => {
    if (!canFilter) return;
    const current = platforms ?? [];
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    // Son çip de kaldırıldıysa "Tümü"ne DÖNER — asla boş dizi yazılmaz, çünkü
    // boş dizi "hiçbir platform kabul değil" demek olurdu.
    void writePlatforms(next.length > 0 ? next : null);
  };

  const selectedCount = platforms?.length ?? 0;

  return (
    <DashboardShell loading={loading}>
      <div className="mx-auto max-w-3xl space-y-10">
        <header>
          {/* Başlık sekme adının aynısı — bkz. DashboardReports. */}
          <h2 className="font-serif text-3xl text-white">Hesabım</h2>
          <p className="mt-2 text-purple-300/70">
            Paketin ve öneri tercihlerin tek yerde.
          </p>
        </header>

        {/* ---------------- Paket ---------------- */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-purple-500/20 bg-slate-800/60 p-6 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl text-white">
                  {canFilter ? "Lens Premium" : "Ücretsiz paket"}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-purple-300/70">
                  {canFilter
                    ? "Öneriler her geri bildirimde tazelenir · hafıza penceresi sınırsız · platform filtresi açık"
                    : "Hafıza penceresi 30 gün · profil haftada bir güncellenir"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                  canFilter
                    ? "border-purple-400/40 bg-purple-500/20 text-purple-100"
                    : "border-purple-500/20 bg-slate-700/40 text-purple-200"
                }`}
              >
                {canFilter ? "Premium" : "Ücretsiz"}
              </span>
            </div>

            {!canFilter && (
              <button
                type="button"
                onClick={() => setUpgradeNote(true)}
                className="mt-5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-5 py-2.5 text-white shadow-lg transition-colors hover:from-purple-600 hover:to-pink-600"
              >
                Premium'a geç
              </button>
            )}

            {upgradeNote && (
              // Sahte bir ödeme ekranı açmıyoruz: akış yokken "geç" demek,
              // tutamayacağımız bir söz olurdu.
              <p className="mt-4 rounded-xl border border-purple-500/20 bg-slate-900/40 px-4 py-3 text-sm text-purple-200">
                Premium henüz satışta değil — ödeme akışı açıldığında burada
                göreceksin. Bu arada önerilerin çalışmaya devam ediyor.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-purple-500/20 bg-slate-800/40 p-6 backdrop-blur-sm">
            <p className="text-xs tracking-widest text-purple-300/60">BİLMEN GEREKENLER</p>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-purple-100/90">
              {[
                "Paketin yalnızca ödeme akışıyla değişir — uygulama içinden elle açılamaz.",
                "Ücretsize döndüğünde hiçbir kayıt silinmez; yalnızca hafıza penceresi 30 güne daralır.",
                "Platform tercihin premium bitse de saklanır, tekrar abone olunca kaldığı yerden çalışır.",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-purple-400" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/*
          ÖDEME GEÇMİŞİ paketin hemen ardında, tercihlerden ÖNCE: ikisi de
          "paketim ne durumda" sorusunun parçası, tercihler ise ayrı bir konu.

          Ücretsiz kullanıcıya hiç gösterilmiyor: ödeme akışı olmadığı için o
          kullanıcının ödemesi hiç olamaz, "Henüz ödeme kaydın yok" satırı
          bekleyen bir borç varmış izlenimi verirdi. Ödeme akışı (US-08)
          geldiğinde gerçek satırlar buraya yazılacak.
        */}
        {isPremium && (
          <section className="rounded-2xl border border-purple-500/20 bg-slate-800/40 p-6 backdrop-blur-sm">
            <p className="text-xs tracking-widest text-purple-300/60">ÖDEME GEÇMİŞİ</p>
            <div className="mt-4 flex items-center gap-3 text-sm text-purple-300/70">
              <CreditCard className="h-4 w-4 shrink-0" />
              <span>Henüz ödeme kaydın yok.</span>
            </div>
          </section>
        )}

        {/* ---------------- Tercihler ---------------- */}
        <section className="space-y-4">
          <div>
            <h3 className="font-serif text-2xl text-white">Tercihlerim</h3>
            <p className="mt-1 text-sm text-purple-300/70">
              Önerileri nereden ve ne sıklıkta almak istediğini burada belirlersin.
            </p>
          </div>

          {/* Haftalık seçki e-postası */}
          <div className="rounded-2xl border border-purple-500/20 bg-slate-800/60 p-6 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-6">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/20">
                  <Mail className="h-5 w-5 text-pink-200" />
                </div>
                <div className="min-w-0">
                  <label htmlFor="weekly-picks" className="block cursor-pointer text-white">
                    Haftalık film önerileri
                  </label>
                  <p className="mt-1 text-sm leading-relaxed text-purple-300/70">
                    Sana uygun birkaç filmi haftada bir e-postayla göndereyim.
                    Kapatırsan önerilerin durmaz, yalnızca e-posta gelmez.
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

            <div className="mt-5 border-t border-purple-500/10 pt-4">
              <StatusLine on={weeklyPicks}>
                {weeklyPicks
                  ? "Açık · e-postan cuma akşamı gelir"
                  : "Kapalı · e-posta göndermiyorum"}
              </StatusLine>
            </div>

            {saveFailed && (
              <p className="mt-4 text-sm text-red-400">
                Ayar kaydedilemedi. Bağlantını kontrol edip tekrar dene.
              </p>
            )}
          </div>

          {/*
            Platform tercihi. Sözlük okunamadıysa (options boş) kart HİÇ
            gösterilmez: yarım dolu bir liste kullanıcıya "Netflix desteklenmiyor"
            gibi yanlış bir sonuç çıkarttırır.
          */}
          {options.length > 0 && (
            <div className="rounded-2xl border border-purple-500/20 bg-slate-800/60 p-6 backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                  <MonitorPlay className="h-5 w-5 text-purple-200" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-white">Hangi platformlardan önerilsin</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        canFilter
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                          : "border-purple-400/30 bg-purple-500/15 text-purple-200"
                      }`}
                    >
                      <Lock className="h-3 w-3" />
                      {canFilter ? "Premium · açık" : "Premium"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-purple-300/70">
                    {canFilter
                      ? "Yalnızca seçtiğin servislerdeki yapımları öneririm. İstediğin an değiştirebilirsin."
                      : "Önerileri yalnızca izleyebileceğin servislerle sınırla."}
                  </p>
                </div>
              </div>

              {/*
                Ücretsiz pakette çipler KİLİTLİ ama görünür: kullanıcı neyin
                mümkün olduğunu görsün. Kilit bir güvenlik sınırı DEĞİL.
              */}
              <div className="mt-5 flex flex-wrap gap-2">
                <Chip
                  active={isAllPlatforms(platforms)}
                  disabled={!canFilter}
                  onClick={() => void writePlatforms(null)}
                >
                  Tümü
                </Chip>
                {options.map((option) => (
                  <Chip
                    key={option.slug}
                    active={(platforms ?? []).includes(option.slug)}
                    disabled={!canFilter}
                    onClick={() => togglePlatform(option.slug)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>

              {canFilter ? (
                <div className="mt-5 border-t border-purple-500/10 pt-4">
                  <StatusLine on={selectedCount > 0}>
                    {selectedCount > 0
                      ? `${selectedCount} servis seçili · öneriler bunlarla sınırlı`
                      : "Tümü · öneriler bütün platformlardan geliyor"}
                  </StatusLine>
                </div>
              ) : (
                /* Mobilde ALT ALTA: metinle buton yan yanayken paragrafa kalan
                   dar sütun açıklamayı yedi sekiz satıra bölüyordu. Yan yana
                   düzen yalnızca sm ve üstünde. */
                <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-purple-500/20 bg-slate-900/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
                  <p className="text-sm leading-relaxed text-purple-200 sm:min-w-0 sm:flex-1">
                    Bu filtre premium'a özel. Şimdilik önerilerin tüm platformlardan
                    geliyor; abone olmadığın bir servisteki yapımlar da çıkabilir.
                  </p>
                  <button
                    type="button"
                    onClick={() => setUpgradeNote(true)}
                    className="w-full shrink-0 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm text-white shadow-lg transition-colors hover:from-purple-600 hover:to-pink-600 sm:w-auto"
                  >
                    Premium'a geç
                  </button>
                </div>
              )}

              {platformsFailed && (
                <p className="mt-4 text-sm text-red-400">
                  Platform tercihi kaydedilemedi. Bağlantını kontrol edip tekrar dene.
                </p>
              )}

              {/*
                Künye: sağlayıcının kullanım koşulları zorunlu tutuyor. Yalnızca
                filtre GERÇEKTEN uygulanıyorken gösteriliyor — ücretsiz pakette o
                veri hiç çekilmiyor, "bu bilgi X'ten geliyor" demek yanlış olurdu.
              */}
              {canFilter && (
                <p className="mt-4 text-xs leading-relaxed text-purple-300/40">
                  Nerede izlenir bilgisi{" "}
                  <a
                    href={WATCH_DATA_CREDIT.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline transition-colors hover:text-purple-300/70"
                  >
                    {WATCH_DATA_CREDIT.name}
                  </a>{" "}
                  tarafından sağlanıyor.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

/** Kartın altındaki "şu an ne oluyor" satırı — noktanın rengi durumu söyler. */
function StatusLine({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-purple-300/70">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-slate-500"}`}
      />
      {children}
    </p>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? "border-purple-400 bg-purple-500 text-white"
          : "border-purple-500/20 bg-slate-700/40 text-purple-200"
      } ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-purple-400/50"}`}
    >
      {children}
    </button>
  );
}
