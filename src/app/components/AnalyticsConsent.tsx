import { useSyncExternalStore } from "react";
import {
  analyticsConfigured,
  getConsentState,
  openConsentBanner,
  setAnalyticsConsent,
  subscribeConsent,
} from "@/lib/posthog";

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
 * z-40: diyaloglar (z-50) bandın üstünde kalır, giriş penceresi onu örter.
 */
export function AnalyticsConsentBanner() {
  const { consent, reopened } = useSyncExternalStore(subscribeConsent, getConsentState);

  if (!analyticsConfigured) return null;
  if (consent !== "unset" && !reopened) return null;

  const choice =
    "rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white transition-colors hover:bg-slate-700";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
      <section
        aria-label="Analitik izni"
        className="pointer-events-auto mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/95 p-5 text-white shadow-2xl backdrop-blur"
      >
        <h2 className="font-serif text-lg">Kullanımı ölçmeme izin verir misin?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Lens'in nerede işe yaradığını, nerede tökezlediğini görebilmek için bir ölçüm
          aracı (PostHog) kullanmak istiyorum. İzin verirsen tarayıcına bir çerez
          yazılır; hangi ekranlara uğradığın ve neye dokunduğun, giriş yaptıysan
          hesabınla eşleşerek PostHog'un yurt dışındaki sunucularına gider. İzin
          vermezsen hiçbir şey ölçülmez ve Lens aynı şekilde çalışır.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {consent === "unset"
            ? "Kararını ana sayfanın ya da panelin altındaki “Analitik tercihi” bağlantısından istediğin an değiştirebilirsin."
            : consent === "granted"
              ? "Şu an izin vermiş durumdasın."
              : "Şu an izin vermemiş durumdasın."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" className={choice} onClick={() => setAnalyticsConsent("denied")}>
            İzin verme
          </button>
          <button type="button" className={choice} onClick={() => setAnalyticsConsent("granted")}>
            İzin ver
          </button>
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
