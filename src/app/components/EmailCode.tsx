import { useId, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { verifyEmailCode } from "@/lib/supabase";

// Supabase'in izin verdiği aralık. Uzunluk panelden ayarlanıyor ve buradan
// okunamıyor; o yüzden tek bir sayıya bağlanılmadı ve metinde "6 haneli" denmedi.
const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;

type Phase = "idle" | "verifying" | "rejected" | "failed";
type Resend = "idle" | "sending" | "sent" | "throttled" | "failed";

/**
 * Giriş e-postasındaki kodun yazıldığı alan — bağlantının İSTENDİĞİ ekranda durur.
 *
 * NEDEN VAR: bağlantı çoğu zaman başka bir tarayıcıda açılır (Instagram ve
 * LinkedIn'in uygulama içi tarayıcısından gelen ziyaretçide her zaman). Oturum
 * orada açılır; yazılan sinyaller ve aktarım rızası burada kalır, kullanıcı boş
 * bir panele düşer ve rıza yeniden sorulur. Kod, oturumu taslağın durduğu
 * tarayıcıda açar. İki giriş ekranında da AYNI bileşen durur.
 *
 * Kod kendiliğinden gönderilmez (uzunluğu bilmiyoruz); düğme ya da Enter ister.
 *
 * Yeniden gönderimi EBEVEYN yapar (`onResend`): giriş başlatan çağrılar rıza
 * kutusunu taşıyan bileşenlerde kalır (bkz. tests/guards/kvkk.test.ts).
 */
export function EmailCodeField({
  email,
  onVerified,
  onResend,
  hint,
}: {
  email: string;
  /** Oturum BU tarayıcıda açıldı. */
  onVerified: () => void;
  /** Aynı adrese yeni e-posta ister; `sendMagicLink`'in sonucunu döner. */
  onResend: () => Promise<{ error: { status?: number } | null }>;
  /** Alanın altındaki açıklama — bağlama göre değişir (rapor / yalnızca giriş). */
  hint: string;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [resend, setResend] = useState<Resend>("idle");

  const complete = code.length >= MIN_CODE_LENGTH;
  const verifying = phase === "verifying";

  async function handleVerify() {
    if (!complete || verifying) return;
    setPhase("verifying");
    const result = await verifyEmailCode(email, code);
    if (result === "ok") {
      // "verifying"de kalır: yönlendirme bitene kadar ikinci kez basılamasın.
      onVerified();
      return;
    }
    setPhase(result);
  }

  async function handleResend() {
    if (resend === "sending" || verifying) return;
    setResend("sending");
    try {
      const { error } = await onResend();
      if (!error) {
        // Yeni e-posta eski kodu geçersiz kılar; ekranda eskisi kalmasın.
        setCode("");
        setPhase("idle");
        setResend("sent");
      } else {
        setResend(error.status === 429 ? "throttled" : "failed");
      }
    } catch {
      setResend("failed");
    }
  }

  return (
    <div className="space-y-3 text-left">
      <label htmlFor={id} className="block text-sm font-normal text-purple-100">
        E-postadaki kod
      </label>
      <div className="flex gap-3">
        <Input
          id={id}
          value={code}
          // Yapıştırılan "730 257" ya da "730-257" de geçsin: yalnızca rakamlar kalır.
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, MAX_CODE_LENGTH));
            if (phase !== "idle") setPhase("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleVerify();
            }
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          placeholder="Kod"
          disabled={verifying}
          aria-invalid={phase === "rejected"}
          className="h-14 flex-1 rounded-xl border-2 border-purple-500/30 bg-slate-700/50 text-center text-xl tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-purple-300/50 focus:border-purple-400 focus:bg-slate-700"
        />
        <Button
          onClick={() => void handleVerify()}
          disabled={!complete || verifying}
          size="lg"
          className="h-14 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-6 text-white hover:from-purple-600 hover:to-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {verifying ? "Doğrulanıyor..." : "Kodu Onayla"}
        </Button>
      </div>

      {phase === "rejected" && (
        <p role="alert" className="text-sm text-red-300">
          Bu kod geçersiz ya da süresi dolmuş. Bağlantıya dokunduysanız kod da kullanılmış
          sayılır — yeni bir e-posta isteyebilirsiniz.
        </p>
      )}
      {phase === "failed" && (
        <p role="alert" className="text-sm text-red-300">
          Kod şu an doğrulanamadı. Bağlantınızı kontrol edip biraz sonra tekrar deneyin.
        </p>
      )}

      <p className="text-xs leading-relaxed text-purple-200">{hint}</p>

      <p className="text-sm text-slate-400">
        Email gelmedi mi? Spam klasörünü kontrol edin ya da{" "}
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={resend === "sending" || verifying}
          // text-sm + font-normal: temadaki düğme tabanı daha büyük ve kalın; cümlenin
          // ortasında bağırıyordu.
          className="text-sm font-normal text-purple-200 underline underline-offset-2 hover:text-white disabled:opacity-50"
        >
          {resend === "sending" ? "gönderiliyor..." : "yeniden gönderin"}
        </button>
        .
      </p>

      {resend === "sent" && (
        <p role="status" className="text-sm text-emerald-300">
          Yeni e-posta gönderildi. Önceki e-postadaki kod ve bağlantı artık geçersiz.
        </p>
      )}
      {resend === "throttled" && (
        <p role="alert" className="text-sm text-red-300">
          Az önce bir e-posta gönderdik. Biraz bekleyip tekrar deneyin.
        </p>
      )}
      {resend === "failed" && (
        <p role="alert" className="text-sm text-red-300">
          E-posta gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.
        </p>
      )}
    </div>
  );
}
