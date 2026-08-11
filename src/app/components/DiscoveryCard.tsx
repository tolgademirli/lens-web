import { useState, type ReactNode } from "react";
import { BookOpen, Bookmark, Check, Film, Music, ThumbsDown } from "lucide-react";
import {
  REASON_LABELS,
  confirmationText,
  recordFeedback,
  retractFeedback,
  SIGNAL_TYPE,
  type FeedbackTarget,
} from "@/lib/feedback";
import { posthog } from "@/lib/posthog";
import type {
  DiscoveryFeedback,
  FeedbackDecision,
  FeedbackOrigin,
  FeedbackReason,
  WorkType,
} from "@/lib/types";

/** Kategori yüzü. "Film & Dizi" yalnızca görünen metindir — WorkType 'film' kalır. */
const CATEGORY: Record<WorkType, { label: string; Icon: typeof BookOpen; accent: string }> = {
  book: { label: "Kitap", Icon: BookOpen, accent: "text-purple-200 bg-purple-500/25" },
  film: { label: "Film & Dizi", Icon: Film, accent: "text-pink-200 bg-pink-500/25" },
  song: { label: "Müzik", Icon: Music, accent: "text-indigo-200 bg-indigo-500/25" },
};

interface DiscoveryCardProps {
  workType: WorkType;
  title: string;
  creator: string;
  /** Kartta italik görünen kısa gerekçe. */
  reason?: string;
  origin: FeedbackOrigin;
  dailyDiscoveryId?: string | null;
  weeklyPickId?: string | null;
  slot?: string | null;
  /** Bu eser için mevcut aktif sinyal; yoksa null. */
  feedback: DiscoveryFeedback | null;
  /** Sinyal değişti — üst bileşen listesini tazelesin. */
  onChange: () => void;
}

/** Buton satırının yerini alan alt sorular. Kart yüksekliği bu yüzden sabit. */
type Panel = "buttons" | "reason" | "known";

export function DiscoveryCard({
  workType,
  title,
  creator,
  reason,
  origin,
  dailyDiscoveryId,
  weeklyPickId,
  slot,
  feedback,
  onChange,
}: DiscoveryCardProps) {
  const [panel, setPanel] = useState<Panel>("buttons");
  const [busy, setBusy] = useState(false);

  const { label, Icon, accent } = CATEGORY[workType];
  const decision = feedback?.decision ?? null;

  /**
   * "İlgimi çekti" ile sağ üstteki bookmark TEK EYLEMDİR. İkisi ayrı durum tutmaz:
   * `saved` burada türetilir, ayrı bir state olarak yaşamaz — aksi halde biri
   * güncellenip diğeri unutulurdu.
   */
  const saved = decision === "interested";
  const isKnown = decision?.startsWith("known") ?? false;

  const target: FeedbackTarget = {
    workType,
    title,
    creator,
    origin,
    dailyDiscoveryId,
    weeklyPickId,
    slot,
  };

  /**
   * Sinyali uygular. Mevcut bir sinyal varsa önce geri alınır: alt soru yanıtı
   * (neden / sevdim) aynı sinyalin TAMAMLANMASIDIR, yeni bir çelişki değil —
   * çakışma kaydı gerçek fikir değişikliklerine ayrılmalı.
   */
  const apply = async (
    next: FeedbackDecision,
    why?: FeedbackReason | null,
    /** Yazımdan sonra hangi panel görünsün — alt soru açan kararlar için "reason"/"known". */
    thenPanel: Panel = "buttons",
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      if (feedback) await retractFeedback(feedback.id);
      const id = await recordFeedback(target, next, why);
      if (id) {
        posthog.capture("discovery_feedback_given", {
          decision: next,
          signal_type: SIGNAL_TYPE[next],
          reason: why ?? null,
          origin,
          work_type: workType,
        });
      }
      setPanel(thenPanel);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  /** Seçili butona ikinci dokunuş seçimi kaldırır ve kaydı siler. */
  const undo = async () => {
    if (busy || !feedback) return;
    setBusy(true);
    try {
      await retractFeedback(feedback.id);
      posthog.capture("discovery_feedback_retracted", { origin, work_type: workType });
      setPanel("buttons");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const handleInterested = () => (saved ? undo() : apply("interested"));

  const handleNotInterested = () => {
    if (decision === "not_interested") return undo();
    // Sinyali HEMEN yaz: neden opsiyoneldir, kullanıcı seçmeden ayrılsa da
    // geri bildirimi kaybolmamalı. Panel yazımdan SONRA açılır — açıp sonra
    // yazsaydık apply'ın kendi setPanel'i alt soruyu hemen kapatırdı.
    apply("not_interested", null, "reason");
  };

  /**
   * "Bunu biliyorum" TEK BAŞINA kaydedilmez — yalnızca alt soruyu açar.
   *
   * "İlgimi çekmedi"den farkı bu: o tek başına tamamlanmış bir sinyaldir (yön
   * bellidir, neden yalnızca ayrıntıdır). "Bunu biliyorum" ise bir bilgi durumu
   * bildirir, zevk bildirmez — yönü yoktur. Tek başına yazılsaydı 3x ağırlıkla
   * eşiği doldurup motora hiçbir yön bilgisi vermezdi; iki dokunuşta profil
   * "hazır" sayılır ama içi boş olurdu.
   */
  const handleKnown = () => {
    if (isKnown) return undo();
    setPanel("known");
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-purple-500/30 bg-slate-800/60 p-5 backdrop-blur-sm">
      {/* Başlık bloğu */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-sm text-purple-300/80">{label}</span>
        </div>

        {/* Bookmark — "İlgimi çekti" ile aynı handler, aynı durum. */}
        <button
          type="button"
          onClick={handleInterested}
          disabled={busy}
          aria-pressed={saved}
          aria-label={saved ? "Listemden çıkar" : "Listeme ekle"}
          className={`rounded-lg p-1.5 transition-colors ${
            saved
              ? "bg-purple-500/25 text-purple-200"
              : "text-purple-300/50 hover:bg-slate-700/50 hover:text-purple-200"
          }`}
        >
          <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-white">{title}</p>}
        {creator && <p className="mt-0.5 text-sm text-purple-200/70">{creator}</p>}
        {reason && (
          <p className="mt-2 text-sm italic leading-relaxed text-purple-300/70">{reason}</p>
        )}
      </div>

      {/*
        YERİNE-KOYMA. Alt sorular buton satırının YERİNE gelir; altına eklenmez ve
        popover olarak açılmaz. Sabit min yükseklik + auto-rows-fr grid: kart
        yüksekliği geri bildirim öncesi ve sonrasında değişmez, satırdaki komşu
        kartlar kaymaz. Önceki iki iterasyonda grid hizası bu yüzden bozulmuştu.
      */}
      <div className="mt-4 flex min-h-[124px] flex-col justify-end border-t border-purple-500/15 pt-3">
        {panel === "reason" ? (
          <SubPanel title="Nedeni? (opsiyonel)" onSkip={() => setPanel("buttons")}>
            <div className="grid grid-cols-2 gap-2">
              {REASON_LABELS.map((r) => (
                <Chip
                  key={r.value}
                  label={r.label}
                  onClick={() => apply("not_interested", r.value)}
                  disabled={busy}
                />
              ))}
            </div>
          </SubPanel>
        ) : panel === "known" ? (
          /* "Geç" değil "Vazgeç": burada atlanacak bir kayıt yok, henüz hiçbir şey
             yazılmadı. Yanıtlardan biri seçilmeden sinyal doğmaz. */
          <SubPanel title="Peki nasıldı?" skipLabel="Vazgeç" onSkip={() => setPanel("buttons")}>
            <div className="flex flex-wrap gap-2">
              <Chip label="Sevdim" onClick={() => apply("known_liked")} disabled={busy} />
              <Chip label="Sevmedim" onClick={() => apply("known_disliked")} disabled={busy} />
              <Chip label="Kararsızım" onClick={() => apply("known_neutral")} disabled={busy} />
            </div>
          </SubPanel>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Action
                label="İlgimi çekti"
                Icon={Bookmark}
                active={saved}
                onClick={handleInterested}
                disabled={busy}
              />
              <Action
                label="İlgimi çekmedi"
                Icon={ThumbsDown}
                active={decision === "not_interested"}
                onClick={handleNotInterested}
                disabled={busy}
              />
              <Action
                label="Bunu biliyorum"
                Icon={Check}
                active={isKnown}
                onClick={handleKnown}
                disabled={busy}
              />
            </div>

            {/*
              Onay satırı. Metinler tek satıra sığacak kadar kısa tutulur ve
              truncate YOKTUR — kesilen bir onay metni "geri al" bağlantısını
              erişilemez hale getirir.
            */}
            {feedback && (
              <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                <span className="whitespace-nowrap text-emerald-300/90">
                  ✦ {confirmationText(feedback.decision, feedback.reason)}
                </span>
                <button
                  type="button"
                  onClick={undo}
                  disabled={busy}
                  className="whitespace-nowrap text-purple-300/70 underline underline-offset-2 transition-colors hover:text-purple-200"
                >
                  Geri al
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SubPanel({
  title,
  onSkip,
  skipLabel = "Geç",
  children,
}: {
  title: string;
  onSkip: () => void;
  /** "Geç" = kayıt zaten var, ayrıntı atlanıyor. "Vazgeç" = henüz kayıt yok. */
  skipLabel?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs text-purple-300/70">{title}</span>
        <button
          type="button"
          onClick={onSkip}
          className="whitespace-nowrap text-xs text-purple-300/70 transition-colors hover:text-purple-200"
        >
          {skipLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

function Action({
  label,
  Icon,
  active,
  onClick,
  disabled,
}: {
  label: string;
  Icon: typeof BookOpen;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-60 ${
        active
          ? "border-transparent bg-gradient-to-r from-purple-500 to-pink-500 text-white"
          : "border-purple-500/30 text-purple-100 hover:border-purple-400/50 hover:bg-slate-700/50"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Chip({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-purple-500/30 px-3 py-1.5 text-xs text-purple-100 transition-colors hover:border-purple-400/50 hover:bg-slate-700/50 disabled:opacity-60"
    >
      {label}
    </button>
  );
}
