import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  analyticsConfigured,
  getConsentState,
  openConsentBanner,
  setAnalyticsConsent,
  subscribeConsent,
} from "@/lib/posthog";

/**
 * Bandın o anki yüksekliği, `:root` üzerinde. Bant ekranın altına YAPIŞIK bir
 * katman; altında kalan birincil aksiyonlar (ana sayfadaki "Kimliğini Keşfet",
 * /start'taki yapışkan gönder çubuğu) bu değişkenle kendilerini bandın üstüne
 * taşır. Bant kapalıyken 0px.
 *
 * Neden var: ilk sürümde bant ana sayfanın tam CTA'sının üstüne oturuyordu.
 * Karar vermeden düğmeye ulaşılamayan bir ekran, "yanıtlamadan da kullanılabilir"
 * sözünü fiilen bozar — ve cevabı zorlanan rıza, rıza değildir.
 */
const HEIGHT_VAR = "--consent-banner-h";

/**
 * Analitik izni bandı. Karar verilene kadar ya da kullanıcı kararını değiştirmek
 * için yeniden açtığında görünür; kapının kendisi `src/lib/posthog.ts`.
 *
 * Modal DEĞİL: yanıtlamadan da Lens kullanılabilir. Yanıt gelene kadar hiçbir şey
 * gönderilmediği için beklemek kimseye zarar vermez; onboarding'in önüne cevabı
 * zorunlu bir soru koymak ise ilk ekranda kullanıcı kaybettirir.
 *
 * İKİ DÜĞME AYNI GÖRÜNÜR ve bu bir tasarım kararı değil, rızanın geçerlilik
 * şartı: reddetmek kabul etmek kadar kolay olmalı. "İzin ver"i renklendirip
 * diğerini soluk bir bağlantıya çevirme — o desen rızayı sakatlar.
 *
 * İKİ KATMAN: ilk katman kısa ama eksiksiz (ne ölçülüyor, çerez, nereye gidiyor,
 * gönüllü olduğu); "Ayrıntılar" ikinci katmanı açar. Metni uzatıp tek katmana
 * dökme — uzun bant ekranı kaplıyor ve yukarıdaki sorunu geri getiriyor.
 *
 * METİN POSTHOG PROJE AYARLARINI ANLATIR ve onlarla birlikte değişmek zorunda:
 * oturum kaydı (session replay) projede AÇIK olduğu için "ekran kaydı" burada ve
 * Hesabım'daki kartta yazıyor. Kayıt kapatılırsa cümle çıkar; yeni bir veri türü
 * açılırsa (ör. yazı alanlarının maskesi kaldırılırsa) eklenir. Söylenmeyen bir
 * şeye verilen rıza, rıza değildir.
 *
 * z-40: diyaloglar (z-50) bandın üstünde kalır, giriş penceresi onu örter.
 */
export function AnalyticsConsentBanner() {
  const { consent, reopened } = useSyncExternalStore(subscribeConsent, getConsentState);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const visible = analyticsConfigured && (consent === "unset" || reopened);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.setProperty(HEIGHT_VAR, "0px");
      return;
    }
    const apply = () => root.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
    apply();
    // Yükseklik sabit değil: "Ayrıntılar" açılır, pencere daralınca metin kırılır.
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty(HEIGHT_VAR, "0px");
    };
  }, [visible]);

  if (!visible) return null;

  const choice =
    "rounded-xl border border-slate-600 bg-slate-800 px-5 py-2.5 text-sm text-white transition-colors hover:bg-slate-700";

  return (
    <div ref={ref} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
      <section
        aria-label="Analitik izni"
        className="pointer-events-auto mx-auto max-w-4xl rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur sm:p-5"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-base sm:text-lg">Kullanımı ölçmeme izin verir misin?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300 sm:text-sm">
              Lens'i iyileştirmek için uğradığın ekranları, dokunduğun yerleri ve oturumunun
              ekran kaydını tutmak istiyorum. İzin verirsen bir çerez yazılır ve kayıtlar
              yurt dışındaki PostHog sunucularına gider; vermesen de Lens aynı çalışır.{" "}
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="text-slate-200 underline underline-offset-2 hover:text-white"
              >
                {expanded ? "Ayrıntıları gizle" : "Ayrıntılar"}
              </button>
            </p>
            {expanded && (
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                Ekran kaydı ekranda gördüklerini — raporların ve eser listen dahil — kapsar;
                yazı alanlarına girdiklerin gizlenir. Giriş yaptıysan kayıtlar hesabınla
                eşleşir. Kararını ana sayfanın altındaki “Analitik tercihi” bağlantısından ya
                da panelde Hesabım sekmesinden istediğin an değiştirebilirsin.
              </p>
            )}
            {consent !== "unset" && (
              <p className="mt-2 text-xs text-slate-400">
                {consent === "granted"
                  ? "Şu an izin vermiş durumdasın."
                  : "Şu an izin vermemiş durumdasın."}
              </p>
            )}
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3">
            <button type="button" className={choice} onClick={() => setAnalyticsConsent("denied")}>
              İzin verme
            </button>
            <button type="button" className={choice} onClick={() => setAnalyticsConsent("granted")}>
              İzin ver
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Bandı yeniden açan bağlantı. Rıza, verildiği kadar kolay geri alınabilmeli. */
export function AnalyticsPreferenceLink({ className }: { className?: string }) {
  if (!analyticsConfigured) return null;
  return (
    <button type="button" onClick={openConsentBanner} className={className}>
      Analitik tercihi
    </button>
  );
}
