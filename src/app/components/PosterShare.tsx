import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Image as ImageIcon, Link2, Share2 } from "lucide-react";
import { supabase, updateReportVisibility } from "@/lib/supabase";
import type { Report } from "@/lib/types";
import { posthog } from "@/lib/posthog";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/app/components/ui/dialog";

type PosterFormat = "story" | "feed";

const FORMATS: { id: PosterFormat; label: string; hint: string; ratio: string }[] = [
  { id: "story", label: "Story", hint: "1080 × 1920", ratio: "9 / 16" },
  { id: "feed", label: "Feed", hint: "1080 × 1350", ratio: "4 / 5" },
];

interface PosterShareProps {
  report: Report;
  isPublic: boolean;
  /** Rapor paylaşım için açıldığında üst bileşen kendi durumunu günceller. */
  onVisibilityChange: (isPublic: boolean) => void;
  /** Modal içinde kullanılırken üst boşluk/başlık tekrarlanmasın. */
  compact?: boolean;
}

/**
 * Poster önizlemesi ve paylaşım aksiyonları.
 *
 * Aynı bileşen hem rapor sayfasının sonunda hem de rapor listesindeki modalda
 * çalışıyor — paylaşım akışı tek yerde tanımlı olsun diye. Gizlilik onayı da
 * burada yaşıyor; iki giriş noktasının onayı ayrı ayrı doğru uygulaması
 * gerekseydi biri er ya da geç unuturdu.
 *
 * Poster `<img src>` ile DEĞİL `fetch` ile alınıyor. Sebep iki: özel raporun
 * önizlemesi için `Authorization` başlığı gerekiyor (JWT'yi query string'e
 * koymamak için) ve dönen Blob üç işi birden görüyor — önizleme,
 * `navigator.share({files})` ve indirme. Tek istek, üç kullanım.
 */
export function PosterShare({ report, isPublic, onVisibilityChange, compact }: PosterShareProps) {
  const [format, setFormat] = useState<PosterFormat>("story");
  const [previews, setPreviews] = useState<Partial<Record<PosterFormat, string>>>({});
  const [loadingFormat, setLoadingFormat] = useState<PosterFormat | null>("story");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  const blobs = useRef(new Map<PosterFormat, Blob>());
  const objectUrls = useRef<string[]>([]);
  const pendingAction = useRef<null | (() => Promise<void>)>(null);
  /** Önizleme açıldı ama hiç paylaşılmadı mı? Unmount'ta bunu bildiriyoruz. */
  const completed = useRef(false);
  /** Unmount temizliği kapanış anındaki biçimi bilsin diye ayrı tutuluyor. */
  const currentFormat = useRef<PosterFormat>("story");

  const archetype = report.hero?.archetype ?? "";
  const shareUrl = `${window.location.origin}/report/${report.id}`;
  const shareText = `Ben ${archetype} çıktım. Sen hangisisin? lensestetik.com`;

  // navigator.canShare dosya desteğini yalnızca gerçek bir File ile söyler.
  useEffect(() => {
    try {
      const probe = new File([new Blob(["x"])], "probe.png", { type: "image/png" });
      setCanShareFiles(!!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    posthog.capture("poster_preview_opened", { report_id: report.id, format: "story" });
    return () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
      if (!completed.current) {
        // İkincil sinyal: önizleme açıldı, hiçbir paylaş butonuna basılmadan
        // kapatıldı. Asıl terk sinyali OS paylaşım sayfasındaki iptal —
        // aşağıda `stage: "os_sheet"` olarak ayrı geliyor.
        posthog.capture("poster_share_abandoned", {
          format: currentFormat.current,
          stage: "preview",
        });
      }
    };
    // Yalnızca mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPoster = useCallback(
    async (target: PosterFormat): Promise<Blob | null> => {
      const cached = blobs.current.get(target);
      if (cached) return cached;

      setLoadingFormat(target);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch(`/api/poster/${report.id}?format=${target}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`poster ${res.status}`);

        const blob = await res.blob();
        blobs.current.set(target, blob);

        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        setPreviews((prev) => ({ ...prev, [target]: url }));
        return blob;
      } catch (err) {
        console.error("[poster] alınamadı:", err);
        setError("Poster hazırlanamadı. Sayfayı yenileyip tekrar dener misin?");
        return null;
      } finally {
        setLoadingFormat(null);
      }
    },
    [report.id]
  );

  useEffect(() => {
    if (!previews[format]) void loadPoster(format);
  }, [format, previews, loadPoster]);

  function switchFormat(next: PosterFormat) {
    if (next === format) return;
    posthog.capture("poster_format_switched", { from: format, to: next });
    currentFormat.current = next;
    setFormat(next);
  }

  /**
   * Paylaşım/indirme/kopyalama aksiyonlarının tamamı buradan geçer.
   *
   * Rapor özelse aksiyon ÇALIŞTIRILMAZ; önce onay diyaloğu açılır. Onay
   * olmadan `is_public` asla true olmaz — "paylaşınca otomatik açılır" sessiz
   * davranışı bilerek kaldırıldı.
   */
  async function gated(action: () => Promise<void>) {
    if (isPublic) {
      await action();
      return;
    }
    pendingAction.current = action;
    setConfirmOpen(true);
  }

  async function confirmAndRun() {
    setConfirmOpen(false);
    setBusy(true);
    const ok = await updateReportVisibility(report.id, true);
    setBusy(false);
    if (!ok) {
      setError("Rapor açılamadı. Tekrar dener misin?");
      return;
    }
    posthog.capture("privacy_opened_for_share", { report_id: report.id });
    onVisibilityChange(true);
    const action = pendingAction.current;
    pendingAction.current = null;
    await action?.();
  }

  function download(blob: Blob, target: PosterFormat) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lens-${slug(archetype)}-${target}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    completed.current = true;
    posthog.capture("poster_share_completed", { format: target, method: "download" });
  }

  async function share(target: PosterFormat) {
    setBusy(true);
    const blob = (await loadPoster(target)) ?? null;
    setBusy(false);
    if (!blob) return;

    if (!canShareFiles) {
      download(blob, target);
      return;
    }

    const file = new File([blob], `lens-${slug(archetype)}-${target}.png`, { type: "image/png" });
    try {
      await navigator.share({ files: [file], text: shareText });
      completed.current = true;
      posthog.capture("poster_share_completed", { format: target, method: "webshare" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // ASIL terk sinyali burası. Mobilde kullanıcı OS paylaşım sayfasını
        // açıp vazgeçtiğinde sayfa unmount OLMUYOR — arka planda duruyor ve
        // kullanıcı geri dönüyor. Sadece unmount'a bakılsaydı bu hiç
        // ateşlenmez, "paylaşmadan çıkma oranı" sistematik olarak düşük
        // görünürdü; tam da ölçmek istediğimiz sürtünme görünmez olurdu.
        posthog.capture("poster_share_abandoned", { format: target, stage: "os_sheet" });
        return;
      }
      console.error("[poster] paylaşım başarısız, indirmeye düşülüyor:", err);
      download(blob, target);
    }
  }

  async function copy(what: "link" | "text") {
    const value = what === "link" ? shareUrl : shareText;
    if (!(await writeToClipboard(value))) {
      setError("Panoya kopyalanamadı. Metni elle seçip kopyalayabilirsin.");
      return;
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
    if (what === "link") {
      completed.current = true;
      posthog.capture("poster_link_copied", { report_id: report.id });
    }
  }

  const activeFormat = FORMATS.find((f) => f.id === format)!;
  const previewUrl = previews[format];

  return (
    <div className={compact ? "space-y-5" : "space-y-6"}>
      {/* Format sekmeleri */}
      <div
        className="grid grid-cols-2 gap-1 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-1"
        role="tablist"
        aria-label="Poster biçimi"
      >
        {FORMATS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={format === f.id}
            onClick={() => switchFormat(f.id)}
            className={`min-h-11 rounded-xl px-3 text-sm font-medium transition-colors ${
              format === f.id
                ? "bg-purple-500/25 text-purple-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.label}
            <span className="ml-2 hidden text-xs text-slate-500 sm:inline">{f.hint}</span>
          </button>
        ))}
      </div>

      {/* Önizleme */}
      <div
        className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border border-purple-500/20 bg-slate-900"
        style={{ aspectRatio: activeFormat.ratio }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${archetype} — ${activeFormat.label} posteri`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {loadingFormat ? (
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            ) : (
              <ImageIcon className="h-8 w-8 text-slate-700" />
            )}
          </div>
        )}
      </div>

      {error && <p className="text-center text-sm text-rose-300">{error}</p>}

      {/* Aksiyonlar */}
      <div className="space-y-3">
        {FORMATS.map((f) => (
          <Button
            key={f.id}
            onClick={() => {
              // Tıklama, onay diyaloğundan ÖNCE sayılır. Onaydan sonra
              // sayılsaydı "özel raporda paylaşmaya kalkıp vazgeçenler"
              // hiç görünmezdi — ölçmek istediğimiz sürtünme tam da orada.
              posthog.capture("poster_share_clicked", { format: f.id });
              void gated(() => share(f.id));
            }}
            disabled={busy}
            className="w-full min-h-12 rounded-2xl border-0 bg-gradient-to-r from-purple-600 to-pink-600 text-sm font-medium tracking-wide text-white hover:from-purple-700 hover:to-pink-700"
          >
            {canShareFiles ? (
              <Share2 className="mr-2 h-4 w-4" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {canShareFiles ? `${f.label} olarak paylaş` : `${f.label} görselini indir`}
          </Button>
        ))}

        {canShareFiles && (
          <Button
            variant="ghost"
            onClick={() =>
              void gated(async () => {
                const blob = await loadPoster(format);
                if (blob) download(blob, format);
              })
            }
            disabled={busy}
            className="w-full min-h-11 rounded-2xl border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Download className="mr-2 h-4 w-4" />
            Görseli indir
          </Button>
        )}

        <Button
          variant="ghost"
          onClick={() => void gated(() => copy("link"))}
          disabled={busy}
          className="w-full min-h-11 rounded-2xl text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          {copied === "link" ? (
            <Check className="mr-2 h-4 w-4 text-emerald-400" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" />
          )}
          {copied === "link" ? "Bağlantı kopyalandı" : "Bağlantıyı kopyala"}
        </Button>
      </div>

      {!canShareFiles && (
        <p className="text-center text-xs leading-relaxed text-slate-500">
          Tarayıcın doğrudan paylaşımı desteklemiyor. Görseli indirip Instagram'dan
          paylaşabilirsin.
        </p>
      )}

      {/* Hazır metin */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-sm leading-relaxed text-slate-300">{shareText}</p>
        <button
          onClick={() => void copy("text")}
          className="inline-flex items-center gap-2 text-xs text-slate-400 underline underline-offset-2 transition-colors hover:text-slate-200"
        >
          {copied === "text" ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied === "text" ? "Metin kopyalandı" : "Metni kopyala"}
        </button>
      </div>

      {/* Gizlilik onayı — atlanamaz */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm border border-slate-700 bg-slate-900 text-white">
          <DialogHeader>
            <DialogTitle className="font-serif text-white">Bu rapor şu an özel</DialogTitle>
            <DialogDescription className="text-slate-400">
              Paylaşınca bağlantısı olan herkes görebilecek. Devam edilsin mi?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-3">
            <Button
              variant="ghost"
              className="text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={() => {
                pendingAction.current = null;
                setConfirmOpen(false);
              }}
            >
              Vazgeç
            </Button>
            <Button
              className="border-0 bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700"
              onClick={() => void confirmAndRun()}
            >
              Paylaş ve herkese aç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Panoya yazar; başaramazsa `false` döner.
 *
 * `navigator.clipboard` GÜVENLİ BAĞLAM gerektiriyor — telefondan LAN üzerinden
 * (http://192.168.x.x) açıldığında `undefined` oluyor ve doğrudan çağırmak
 * hata fırlatıyordu. Aynı durum `navigator.share` için de geçerli; orada
 * `canShare` kontrolü zaten var, burada da olması gerekiyordu.
 *
 * Yedek yol eski `execCommand("copy")`: kullanımdan kalkmış ama güvensiz
 * bağlamda çalışan tek seçenek.
 */
async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Aşağıdaki yedek yola düşülür.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Dosya adı için sadeleştirme. Poster endpoint'indeki `slugify` ile aynı iş. */
function slug(s: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
  };
  return (
    s
      .toLocaleLowerCase("tr-TR")
      .replace(/[çğıöşüâîû]/g, (ch) => map[ch] ?? ch)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "lens"
  );
}
