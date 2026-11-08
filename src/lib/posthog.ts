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
 *
 * Karar giriş yapan kişinin HESABINA da yazılır ve girişte oradan okunur; o işi
 * `analyticsConsent.ts` yapar, bu dosya Supabase'i bilmez. Kapı yine burada.
 */
const key =import.meta.env.VITE_POSTHOG_KEY as string | undefined;

/** Anahtar yoksa (lokal geliştirme) sorulacak bir izin de yoktur; bant çizilmez. */
export const analyticsConfigured = Boolean(key);

export type AnalyticsConsent = "granted" | "denied" | "unset";
export type AnalyticsDecision = Exclude<AnalyticsConsent, "unset">;

const CONSENT_KEY = "lens_analytics_consent";
const QUEUE_LIMIT = 50;

type Properties = Record<string, unknown>;
type QueuedEvent = { event: string; properties?: Properties; at: Date };

/**
 * Tarayıcıdaki kayıt. Kararın yanında iki bilgi daha durur; ikisi de kararı
 * hesaptaki kayıtla (`analyticsConsent.ts`) uzlaştırmak için:
 *   - `at`: kararın verildiği an. İki cihazda iki ayrı karar varsa EN SON verilen
 *     geçerlidir.
 *   - `synced`: bu karar bir hesaptaki kayda eşit mi. `false`, kararın henüz hiçbir
 *     hesaba yazılmadığı demek (girişten önce verildi ya da yazım başarısız oldu);
 *     ilk girişte hesaba yazılır.
 *
 * Önceki sürüm yalnızca "granted" / "denied" yazıyordu. O kayıt `at: 0` ile okunur
 * (hesaptaki her karardan eski) ve henüz hesaba yazılmamış sayılır: deploy anında
 * kararı olan kullanıcı yeniden sorulmaz, kararı ilk girişinde hesabına taşınır.
 */
export type StoredConsent = { value: AnalyticsDecision; at: number; synced: boolean };

const isDecision = (value: unknown): value is AnalyticsDecision => value === "granted" || value === "denied";

// localStorage gizli sekmede ya da site verisi engelliyken fırlatabilir. O durumda
// karar hatırlanmaz ve her ziyarette yeniden sorulur — rıza varsaymaktan iyidir.
function readStored(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (isDecision(raw)) return { value: raw, at: 0, synced: false };
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (!isDecision(parsed?.value)) return null;
    return {
      value: parsed.value,
      at: typeof parsed.at === "number" ? parsed.at : 0,
      synced: parsed.synced === true,
    };
  } catch {
    return null;
  }
}

let stored = readStored();

function persist(next: StoredConsent | null) {
  stored = next;
  try {
    if (next) localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* hatırlanamadı; bu sayfa ömrü boyunca bellekteki karar geçerli */
  }
}

type ConsentState = {
  consent: AnalyticsConsent;
  /** Kullanıcı kararını değiştirmek için bandı elle yeniden açtı. */
  reopened: boolean;
  /** Oturumdaki kişinin hesabındaki karar okunuyor; o ana kadar bant çizilmez. */
  checking: boolean;
};

let state: ConsentState = { consent: stored?.value ?? "unset", reopened: false, checking: false };
const listeners = new Set<() => void>();
const decisionListeners = new Set<(value: AnalyticsDecision) => void>();

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

/**
 * Bant, oturumu açık kişinin hesabındaki karar okunana kadar bekler. Beklemeseydi
 * kararı hesabında duran kişi yeni bir tarayıcıda bandı bir an görür, sonra bant
 * kaybolurdu. Oturumsuz ziyaretçide bekleme, ilk oturum bilgisiyle biter.
 */
export function holdConsentBanner(held: boolean) {
  if (state.checking !== held) setState({ checking: held });
}

/** Kullanıcının bantta ya da Hesabım'da verdiği karar; hesaba yazmak için. */
export function onConsentDecision(listener: (value: AnalyticsDecision) => void) {
  decisionListeners.add(listener);
  return () => {
    decisionListeners.delete(listener);
  };
}

export function getStoredConsent(): StoredConsent | null {
  return stored;
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
    // Oturum kaydı (session replay) ALINMAZ ve bunun yetkilisi burası, PostHog
    // paneli değil. Kayıt projede açık bulundu (11 Ekim 2026'da hâlâ açıktı) ve
    // izin verenin ekranı — raporları dahil — kaydediliyordu. Panel anahtarı
    // deploy'suz, tek tıkla geri açılabilir; bu satır durdukça açılsa da kayıt
    // başlamaz, kaydedici betik indirilmez. Rıza metni ekran kaydından söz
    // ETMİYOR: bu satırı kaldıran, aynı commit'te bandı ve Hesabım'daki kartı
    // günceller, yazı alanlarının maskesini de (`session_recording.maskAllInputs`)
    // yeniden sabitler.
    disable_session_recording: true,
  });
  started = true;
}

/** Kapıyı yeni karara göre açar ya da kapatır. Bekleyen kuyruk her durumda boşalır. */
function switchTo(next: AnalyticsConsent) {
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
}

/** Kullanıcının kararı: bandın iki düğmesi ve Hesabım'daki anahtar. */
export function setAnalyticsConsent(next: AnalyticsDecision) {
  if (state.consent === next) {
    setState({ reopened: false });
    return;
  }

  persist({ value: next, at: Date.now(), synced: false });
  switchTo(next);
  setState({ consent: next, reopened: false });
  decisionListeners.forEach((listener) => listener(next));
}

/**
 * Hesapta kayıtlı kararı bu tarayıcıda uygular. Karar başka bir cihazda verilmiş
 * olabilir; zaman damgası sunucunun damgasıdır.
 */
export function adoptAccountConsent(value: AnalyticsDecision, at: number) {
  persist({ value, at, synced: true });
  if (state.consent === value) return;
  switchTo(value);
  setState({ consent: value });
}

/** Tarayıcıdaki karar `value` olarak hesaba yazıldı. */
export function markConsentSynced(value: AnalyticsDecision) {
  // Yazım sürerken verilen yeni bir karar, eskisinin yazımıyla "yazıldı" sayılmasın.
  if (stored && stored.value === value && !stored.synced) persist({ ...stored, synced: true });
}

/**
 * Bu tarayıcıdaki karar BAŞKA BİR HESABA ait (aynı cihazda iki kişi). Karar
 * unutulur ve oturumdaki kişiye kendi kararı sorulur: birinin verdiği izin,
 * ötekinin hesabına rıza olarak yazılmamalı.
 */
export function forgetConsent() {
  persist(null);
  if (state.consent === "unset") return;
  switchTo("unset");
  setState({ consent: "unset" });
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
