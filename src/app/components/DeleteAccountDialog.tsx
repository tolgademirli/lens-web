import { useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { deleteAccount } from "@/lib/account";

type Phase = "confirm" | "deleting" | "failed" | "done";

/**
 * "Hesabımı sil" — tetikleyicisi ve onayı birlikte.
 *
 * Onay bir işaret kutusuyla alınıyor, "SİL yaz" ile değil: Türkçe klavyede
 * I/İ ayrımı yüzünden "SIL" ile "SİL" farklı dizeler ve doğru yazan kullanıcı
 * reddedilirdi (posterdeki büyük harf dersiyle aynı).
 *
 * Silme düğmesi `AlertDialogAction` DEĞİL, düz `Button`: Action tıklandığı an
 * diyaloğu kapatır, oysa istek sürerken ve hata verdiğinde açık kalması gerek.
 */
export function DeleteAccountDialog({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phase, setPhase] = useState<Phase>("confirm");

  function handleOpenChange(next: boolean) {
    // İstek yoldayken kapatılamaz: sonucu göremeyen kullanıcı hesabının silinip
    // silinmediğini bilemez.
    if (phase === "deleting") return;
    // Silindikten sonra panelde kalınamaz — gösterilecek bir hesap yok.
    if (phase === "done") {
      navigate("/", { replace: true });
      return;
    }
    setOpen(next);
    if (!next) {
      setUnderstood(false);
      setPhase("confirm");
    }
  }

  async function handleDelete() {
    setPhase("deleting");
    setPhase((await deleteAccount()) ? "done" : "failed");
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <button type="button" className={className}>
          Hesabımı sil
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-sm border border-slate-700 bg-slate-900 text-white">
        {phase === "done" ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif text-white">Hesabın silindi</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Hesabın ve Lens'te sana ait kayıtlar kalıcı olarak silindi. Bir gün yeniden
                uğrarsan sıfırdan başlarız.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                className="border-0 bg-slate-700 text-white hover:bg-slate-600"
                onClick={() => navigate("/", { replace: true })}
              >
                Tamam
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif text-white">
                Hesabını silmek üzeresin
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Raporların, Listem'deki eserler, verdiğin geri bildirimler, keşif ve seçki
                geçmişin, tercihlerin ve e-posta adresin kalıcı olarak silinir. Paylaştığın
                rapor bağlantıları da çalışmaz olur. Bu işlem geri alınamaz.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-200">
              <Checkbox
                checked={understood}
                onCheckedChange={(value) => setUnderstood(value === true)}
                disabled={phase === "deleting"}
                className="mt-0.5 border-slate-500 data-[state=checked]:border-red-500 data-[state=checked]:bg-red-600 data-[state=checked]:text-white"
              />
              <span>Geri alınamayacağını anladım.</span>
            </label>

            {phase === "failed" && (
              <p className="text-sm text-red-400">
                Hesabın silinemedi. Bağlantını kontrol edip tekrar dene.
              </p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={phase === "deleting"}
                className="border-slate-600 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Vazgeç
              </AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={!understood || phase === "deleting"}
                onClick={() => void handleDelete()}
              >
                {phase === "deleting" ? "Siliniyor..." : "Hesabımı kalıcı olarak sil"}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
