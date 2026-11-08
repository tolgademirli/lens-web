import { supabase } from "./supabase";
import {
  adoptAccountConsent,
  analyticsConfigured,
  forgetConsent,
  getStoredConsent,
  holdConsentBanner,
  markConsentSynced,
  onConsentDecision,
  type AnalyticsDecision,
} from "./posthog";

/**
 * Analitik kararının HESAPTAKİ kaydı (`analytics_consents`).
 *
 * Bant girişten önce, kim olduğunu bilmeden sorar; karar o yüzden önce tarayıcıda
 * durur (`posthog.ts`). Tarayıcı tek başına yetmiyordu: başka bir cihazda, başka bir
 * tarayıcıda ya da Instagram'ın uygulama içi tarayıcısında kayıt yoktu ve bant her
 * girişte yeniden soruyordu. Yurt dışı aktarım rızasıyla (`transferConsent.ts`) aynı
 * desen: girişten önce verilen karar giriş dönüşünde hesaba yazılır, hesabında kararı
 * olan kişiye bir daha sorulmaz.
 *
 * Kapı `posthog.ts`'te kalır. Bu dosya PostHog'u bilmez; yalnızca kararı hesaba
 * yazar ve hesaptaki kararı kapıya bildirir.
 *
 * Girişte üç durum var (bkz. `reconcile`):
 *   - Hesapta karar yok: tarayıcıdaki karar (varsa) hesaba yazılır. Tarayıcıdaki
 *     karar BAŞKA bir hesaptan geldiyse yazılmaz, unutulur ve kişiye sorulur.
 *   - İkisi aynı: hiçbir şey değişmez.
 *   - İkisi farklı: EN SON verilen geçerli. Hesaptaki daha yeniyse bu tarayıcıya
 *     uygulanır; tarayıcıdaki daha yeniyse ve henüz hiçbir hesaba yazılmamışsa hesaba
 *     yazılır.
 *
 * Bilinen boşluk: tarayıcıda izin varken PostHog sayfa açılır açılmaz başlar ve
 * hesaptaki karar ancak bir istek sonra gelir. Başka cihazda geri alınan izin bu
 * cihazda o kısa süre boyunca geçerli kalır. Kapıyı hesabı beklemeye bağlamak her
 * açılışta ölçümü geciktirirdi; bu değişiklikten önce geri alma hiç taşınmıyordu.
 */
const TABLE = "analytics_consents";
// Kayıt okunamazsa bant sonsuza kadar beklemesin: tarayıcıdaki karar geçerli kalır.
const READ_TIMEOUT_MS = 5000;

type AccountConsent = { decision: AnalyticsDecision; at: number };

/**
 * Postgres kesri 1-6 haneyle yazar ("…:58.28567+00:00"); `Date.parse`'ın her
 * tarayıcıda tanıdığı biçim tam 3 hane. Okunamayan damga 0 sayılır: çatışmada
 * hesaptaki karar değil tarayıcıdaki kazanır, ama karar kaybolmaz.
 */
function parseTimestamp(iso: string): number {
  const at = Date.parse(iso.replace(/\.(\d+)/, (_m, digits: string) => `.${digits.padEnd(3, "0").slice(0, 3)}`));
  return Number.isNaN(at) ? 0 : at;
}

/**
 * Kararı hesaba yazar. Satır üzerine yazılmaz: her karar yeni bir satırdır ve
 * geçerli olan en sonuncusudur. Zaman damgasını sunucu vurur (trigger).
 */
export async function recordAnalyticsConsent(userId: string, decision: AnalyticsDecision): Promise<boolean> {
  const { error } = await supabase.from(TABLE).insert({ user_id: userId, decision });
  if (error) {
    console.error("[analytics-consent] kaydedilemedi:", error);
    return false;
  }
  return true;
}

/** Hesaptaki en son karar. `null` = karar yok, `undefined` = okunamadı. */
async function readAccountConsent(userId: string): Promise<AccountConsent | null | undefined> {
  const read = supabase
    .from(TABLE)
    .select("decision, decided_at")
    .eq("user_id", userId)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        console.error("[analytics-consent] okunamadı:", error);
        return undefined;
      }
      const row = data as { decision: AnalyticsDecision; decided_at: string } | null;
      return row ? { decision: row.decision, at: parseTimestamp(row.decided_at) } : null;
    });
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), READ_TIMEOUT_MS));
  return Promise.race([read, timeout]);
}

async function writeLocal(userId: string, decision: AnalyticsDecision) {
  if (await recordAnalyticsConsent(userId, decision)) markConsentSynced(decision);
}

/** Girişte tarayıcıdaki kararı hesaptakiyle uzlaştırır. */
async function reconcile(userId: string, isCurrent: () => boolean) {
  const account = await readAccountConsent(userId);
  // Okunamadı (fail-open): tarayıcıdaki karar geçerli kalır, bant ona göre çizilir.
  // Günlükte `[analytics-consent]` sıklaşırsa kararlar sessizce hesaba taşınmıyor demektir.
  if (account === undefined || !isCurrent()) return;

  // Tarayıcıdaki karar istek SONRASINDA okunur: o arada verilen karar ezilmesin.
  const local = getStoredConsent();

  if (!account) {
    if (!local) return;
    if (local.synced) forgetConsent();
    else await writeLocal(userId, local.value);
    return;
  }

  if (local && !local.synced && local.value !== account.decision && local.at > account.at) {
    await writeLocal(userId, local.value);
    return;
  }
  adoptAccountConsent(account.decision, account.at);
}

let watching = false;
let currentUser: string | null = null;

/**
 * `main.tsx`'ten bir kez, ilk çizimden ÖNCE çağrılır: bant, oturum bilgisi gelene
 * kadar bekler. Analitik anahtarı yoksa (lokal geliştirme) sorulacak bir karar da
 * yoktur; veritabanına hiç gidilmez.
 */
export function watchAnalyticsConsent() {
  if (!analyticsConfigured || watching) return;
  watching = true;
  holdConsentBanner(true);

  // Oturum açıkken verilen karar o an hesaba yazılır. Yazım başarısızsa karar
  // tarayıcıda "yazılmadı" olarak kalır ve bir sonraki girişte yeniden denenir.
  onConsentDecision((decision) => {
    if (currentUser) void writeLocal(currentUser, decision);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      currentUser = null;
      holdConsentBanner(false);
      return;
    }
    // INITIAL_SESSION: sayfa açık bir oturumla yüklendiğinde SIGNED_IN gelmez.
    if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;

    const userId = session?.user.id ?? null;
    if (!userId) {
      currentUser = null;
      holdConsentBanner(false);
      return;
    }
    // supabase-js sekmeye dönüşte SIGNED_IN'i yineler; aynı kişinin hesabı zaten okundu.
    if (userId === currentUser) return;

    currentUser = userId;
    holdConsentBanner(true);
    const isCurrent = () => currentUser === userId;
    // Geri çağrının İÇİNDE Supabase sorgusu yapılmaz (supabase-js kilidi); bir tur sonra.
    setTimeout(() => {
      void reconcile(userId, isCurrent).finally(() => {
        if (isCurrent()) holdConsentBanner(false);
      });
    }, 0);
  });
}
