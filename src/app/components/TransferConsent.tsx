import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { supabase } from "@/lib/supabase";
import { TRANSFER_COUNTRIES } from "@/lib/legal";
import { hasTransferConsent, recordTransferConsent } from "@/lib/transferConsent";

/**
 * Yurt dışı aktarımına açık rıza kutusu (KVKK m.9). Giriş ekranlarında ve
 * girişten sonraki kapıda AYNI metinle durur — iki yerde iki ayrı cümleye
 * verilen rıza, hangisine verildiği belli olmayan rızadır.
 *
 * KUTU İŞARETSİZ GELİR ve öyle kalmak zorunda: önceden işaretlenmiş kutu açık
 * rıza sayılmaz. Aynı sebeple "devam ederek kabul etmiş olursun" cümlesine de
 * katlanmadı — o kalıp Kullanım Koşulları için yeter, rıza için yetmez.
 *
 * METİN, AKTARIMI ANLATIR: ülkeler `legal.ts`'ten gelir ve Aydınlatma
 * Metni'ndeki tabloyla birlikte değişir. Kapsam değişirse sürüm de değişir
 * (`TRANSFER_CONSENT_VERSION`) ve herkese yeniden sorulur.
 *
 * Bağlantılar YENİ SEKMEDE açılır: giriş penceresi /start'ın üstünde duruyor,
 * aynı sekmede gitmek yarım kalmış girişi ekrandan kaldırırdı.
 */
export function TransferConsentField({
  checked,
  onCheckedChange,
  missing = false,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Kutu işaretlenmeden devam edilmeye çalışıldı. */
  missing?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const link = "text-white underline underline-offset-2 hover:text-purple-100";

  return (
    <div className="space-y-2 text-left">
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          disabled={disabled}
          aria-invalid={missing && !checked}
          className="mt-0.5 border-purple-300/70 data-[state=checked]:border-purple-500 data-[state=checked]:bg-purple-500 data-[state=checked]:text-white"
        />
        {/* font-normal: temadaki label tabanı orta kalınlık; üç satırlık bir cümlede
            kalın yazı bağırıyor ve altındaki risk notunu gölgede bırakıyordu. */}
        <label htmlFor={id} className="cursor-pointer text-sm font-normal leading-relaxed text-white">
          Verilerimin, Lens'in çalışması için yurt dışındaki ({TRANSFER_COUNTRIES}) hizmet
          sağlayıcılara aktarılmasına açık rıza veriyorum.
        </label>
      </div>

      {missing && !checked && (
        <p role="alert" className="pl-7 text-sm text-red-300">
          Devam edebilmem için bu izne ihtiyacım var.
        </p>
      )}

      <p className="pl-7 text-xs leading-relaxed text-purple-200">
        Bu ülkelerde verilerin Türkiye'deki korumanın aynısından yararlanmayabilir.
        Verilerinin kime ve ne için gittiğini{" "}
        <a href="/privacy" target="_blank" rel="noopener" className={link}>
          Aydınlatma Metni
        </a>
        'nde okuyabilirsin. Devam ederek{" "}
        <a href="/terms" target="_blank" rel="noopener" className={link}>
          Kullanım Koşulları
        </a>
        'nı da kabul etmiş olursun.
      </p>
    </div>
  );
}

/**
 * Kapının ÇİZİLMEDİĞİ sayfalar. Metinler: neye rıza verdiğini okumak isteyen
 * kişi kapıya takılmamalı. /account: rıza vermek istemeyenin çıkış yolu orada
 * (Verilerim → Hesabı sil) ve o yol hiçbir anahtara bağlanmaz.
 */
const EXEMPT_PATHS = ["/privacy", "/terms", "/cookies", "/account"];

type Phase = "idle" | "saving" | "failed";

/**
 * Girişten SONRAKİ kapı: oturumu olup güncel sürümde rıza kaydı olmayan herkese
 * sorar. Üç durumu yakalar — bu kapıdan önce açılmış hesaplar, giriş bağlantısını
 * başka cihazda açanlar ve rızanın kapsamı değiştikten (sürüm yükseldikten)
 * sonra dönenler. Kutuyu giriş ekranında işaretleyip aynı cihazda dönen kişi
 * bu pencereyi hiç görmez; kaydı `hasTransferConsent` sessizce yazar.
 *
 * AlertDialog, Dialog değil: dışına tıklayınca ya da Esc ile KAPANMAZ, kapatma
 * çarpısı yok. İki çıkış var ve ikisi de ekranda: izin ver ya da çıkış yap.
 *
 * Rotaların DIŞINDA durur (App.tsx), analitik bandı gibi: hangi sayfadan
 * girilirse girilsin sorulur.
 */
export function TransferConsentGate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [needed, setNeeded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    // Abone olunduğunda mevcut oturumla da bir kez ateşlenir (INITIAL_SESSION).
    // Geri çağrının İÇİNDE Supabase sorgusu yapılmaz — yalnızca kimlik alınır.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setNeeded(false);
    setAgreed(false);
    setMissing(false);
    setPhase("idle");
    if (!userId) return;

    let cancelled = false;
    void hasTransferConsent(userId).then((ok) => {
      if (!cancelled) setNeeded(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleAgree() {
    if (!userId) return;
    if (!agreed) {
      setMissing(true);
      return;
    }
    setPhase("saving");
    if (await recordTransferConsent(userId)) setNeeded(false);
    else setPhase("failed");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  }

  const open = needed && !EXEMPT_PATHS.includes(pathname);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md border border-slate-700 bg-slate-900 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-white">
            Devam etmeden önce bir izin
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            Lens'i kullanabilmen için verilerinin yurt dışındaki hizmet sağlayıcılara
            aktarılması gerekiyor. Veritabanı Güney Kore'de, raporları yazan yapay zekâ ve
            sitenin altyapısı ABD'de bulunuyor. Bu aktarım için açık rızan gerekiyor.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <TransferConsentField
          checked={agreed}
          onCheckedChange={setAgreed}
          missing={missing}
          disabled={phase === "saving"}
        />

        {phase === "failed" && (
          <p role="alert" className="text-sm text-red-300">
            İznin kaydedilemedi. Bağlantını kontrol edip tekrar dene.
          </p>
        )}

        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={phase === "saving"}
            onClick={() => void handleSignOut()}
            className="border-slate-600 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Çıkış yap
          </Button>
          <Button
            disabled={phase === "saving"}
            onClick={() => void handleAgree()}
            className="border-0 bg-purple-500 text-white hover:bg-purple-600"
          >
            {phase === "saving" ? "Kaydediliyor..." : "Devam et"}
          </Button>
        </AlertDialogFooter>

        <p className="text-xs leading-relaxed text-slate-400">
          İzin vermek istemiyorsan hesabını ve Lens'teki bütün verilerini{" "}
          <Link to="/account" className="text-slate-200 underline underline-offset-2 hover:text-white">
            Hesabım
          </Link>{" "}
          sekmesinden silebilirsin.
        </p>
      </AlertDialogContent>
    </AlertDialog>
  );
}
