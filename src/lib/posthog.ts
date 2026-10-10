import posthogJs from "posthog-js";
import type { WorkSource, WorkType } from "./types";

/**
 * PostHog'a giden HER ŞEYİN tek kapısı — ve kapı varsayılan olarak KAPALI.
 *
 * Analitik çerezi açık rıza ister (Kurul'un Çerez Rehberi) ve veri yurt dışına
 * gidiyor. Bu yüzden kullanıcı "İzin ver" demeden:
 *   - `init` ÇAĞRILMAZ. Opt-out modunda bile init, uzak ayarları çekmek için
 *     PostHog'a istek atar; o istek IP'yi rızadan önce yurt dışına taşır.
 *   - tarayıcıya hiçbir şey yazılmaz (kararın kendisi hariç — tercihi hatırlamak
 *     zorunlu bir kayıttır, rıza gerektirmez).
 *
 * `posthog-js`'i başka bir dosyadan doğrudan import ETME: kapının etrafından
 * dolaşan tek bir `capture`, rızasız veri göndermek demektir.
 *
 * Karar verilene kadar olaylar BELLEKTE bekler (cihazdan çıkmaz, diske yazılmaz).
 * İzin gelirse kendi zaman damgalarıyla gönderilir, gelmezse atılır. Kuyruk
 * olmasaydı `landing_viewed` ve `form_started` izin veren kullanıcıda bile hep
 * kaybolurdu — karar o olaylardan birkaç saniye SONRA veriliyor — ve huninin
 * tepesi ölçülemezdi.
 */
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

/** Anahtar yoksa (lokal geliştirme) sorulacak bir izin de yoktur; bant çizilmez. */
export const analyticsConfigured = Boolean(key);

export type AnalyticsConsent = "granted" | "denied" | "unset";

const CONSENT_KEY = "lens_analytics_consent";
const QUEUE_LIMIT = 50;

type Properties = Record<string, unknown>;
type QueuedEvent = { event: string; properties?: Properties; at: Date };

// localStorage gizli sekmede ya da site verisi engelliyken fırlatabilir. O durumda
// karar hatırlanmaz ve her ziyarette yeniden sorulur — rıza varsaymaktan iyidir.
function readConsent(): AnalyticsConsent {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw === "granted" || raw === "denied" ? raw : "unset";
  } catch {
    return "unset";
  }
}

function writeConsent(value: "granted" | "denied") {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* hatırlanamadı; bu sayfa ömrü boyunca bellekteki karar geçerli */
  }
}

type ConsentState = {
  consent: AnalyticsConsent;
  /** Kullanıcı kararını değiştirmek için bandı elle yeniden açtı. */
  reopened: boolean;
};

let state: ConsentState = { consent: readConsent(), reopened: false };
const listeners = new Set<() => void>();

function setState(next: Partial<ConsentState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

/** `useSyncExternalStore` çifti — bkz. AnalyticsConsent.tsx. */
export function subscribeConsent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConsentState(): ConsentState {
  return state;
}

/** Rıza, verildiği kadar kolay geri alınabilmeli: bant her an yeniden açılabilir. */
export function openConsentBanner() {
  setState({ reopened: true });
}

let started = false;
// Oturumdaki kullanıcı. Rıza girişten SONRA verilirse kimlik o an bağlanır;
// o yüzden kapı kapalıyken de hatırlanır (yalnızca bellekte).
let identity: string | null = null;
let queue: QueuedEvent[] = [];

function start() {
  if (started || !key) return;
  posthogJs.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST as string,
    autocapture: false,
    capture_pageview: true,
    // Rıza geri alındığında (`opt_out_capturing`) PostHog'un çerezi ve
    // localStorage kaydı da silinsin; varsayılanda yalnızca gönderim durur.
    opt_out_persistence_by_default: true,
  });
  started = true;
}

export function setAnalyticsConsent(next: "granted" | "denied") {
  const previous = state.consent;
  if (previous === next) {
    setState({ reopened: false });
    return;
  }

  writeConsent(next);

  if (next === "granted") {
    start();
    if (started) {
      // `$opt_in` olayı rızanın kaydıdır: ne zaman verildiği PostHog'da durur.
      posthogJs.opt_in_capturing();
      if (identity) posthogJs.identify(identity);
      for (const queued of queue) {
        posthogJs.capture(queued.event, queued.properties, { timestamp: queued.at });
      }
    }
  } else if (started) {
    posthogJs.opt_out_capturing();
  }

  queue = [];
  setState({ consent: next, reopened: false });
}

/**
 * Rıza kapısından ÖNCEKİ sürüm PostHog'u sormadan başlatıyordu; o günlerden kalan
 * çerez ve localStorage kaydı eski ziyaretçilerin tarayıcısında duruyor. İzin
 * verilmediği sürece orada kalmamalı.
 *
 * Kütüphaneye yaptırmıyoruz: silmek için önce `init` gerekir, o da PostHog'a
 * istek atar. Çerez hangi alan adıyla yazıldıysa ancak onunla silinir ve PostHog
 * varsayılanda üst alan adını kullanıyor (`.lensestetik.com`); hangisi olduğunu
 * tahmin etmek yerine bütün son ekler denenir, tarayıcı geçersiz olanı yok sayar.
 */
function purgeStoredAnalytics() {
  if (!key) return;
  const name = `ph_${key}_posthog`;
  try {
    localStorage.removeItem(name);
  } catch {
    /* erişilemiyorsa silinecek bir şey de yazılamamıştır */
  }
  const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  document.cookie = expired;
  const labels = window.location.hostname.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    document.cookie = `${expired}; domain=.${labels.slice(i).join(".")}`;
  }
}

// Önceki ziyarette izin verilmişse sayfa açılır açılmaz başlar.
if (state.consent === "granted") start();
else purgeStoredAnalytics();

/**
 * Bileşenlerin kullandığı yüz. İmzalar posthog-js ile aynı tutuldu ki çağıran
 * taraf kapının varlığını bilmek zorunda kalmasın.
 */
export const posthog = {
  capture(event: string, properties?: Properties) {
    if (!key || state.consent === "denied") return;
    if (state.consent === "unset") {
      if (queue.length < QUEUE_LIMIT) queue.push({ event, properties, at: new Date() });
      return;
    }
    posthogJs.capture(event, properties);
  },

  identify(userId: string) {
    identity = userId;
    if (started && state.consent === "granted") posthogJs.identify(userId);
  },

  reset() {
    identity = null;
    if (started) posthogJs.reset();
  },
};

/**
 * Edinim yolu event'i. `source` property'si user_works.source ile AYNI sözlükten
 * gelir: 'screenshot' | 'paste' | 'manual' | 'form'. Şemsiye bir 'import' değeri
 * yoktur — hangi yoldan girildiği tek tek bilinir.
 *
 * Değer burada hesaplanmaz: çağıran, eserlerle birlikte kütüphaneye yazılan
 * source dizisini olduğu gibi geçer. Böylece event ile user_works tek kaynaktan
 * türer ve ayrışamaz. Aynı yol birden çok eserde tekrarlanırsa tek event düşer.
 */
export function captureSourcePath(type: WorkType, sources: WorkSource[]) {
  for (const source of Array.from(new Set(sources))) {
    posthog.capture("source_path_selected", { type, source });
  }
}
