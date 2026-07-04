import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { GoogleButton } from "./ui/google-button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { sendMagicLink, signInWithGoogle } from "@/lib/supabase";

type View = "options" | "email-form" | "sent";
type Status = "idle" | "sending" | "error";

interface EmailOptInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmailOptInModal({ open, onOpenChange }: EmailOptInModalProps) {
  const [view, setView] = useState<View>("options");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  const isValidEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleGoogleClick = async () => {
    setGoogleLoading(true);
    localStorage.setItem("lens_auth_method", "google");
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await signInWithGoogle(redirectTo);
    if (error) setGoogleLoading(false);
  };

  const handleEmailSubmit = async () => {
    if (!isValidEmail(email)) return;
    setStatus("sending");
    localStorage.setItem("lens_auth_method", "magic_link");
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await sendMagicLink(email.trim(), redirectTo);
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setView("sent");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleEmailSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="backdrop-blur-sm bg-black/60"
        className="bg-slate-900 border border-purple-500/30 text-white sm:max-w-md max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:max-w-full"
      >
        {view === "options" && (
          <>
            <DialogTitle className="text-2xl text-white font-serif text-center">
              Raporun hazır olmak üzere
            </DialogTitle>
            <DialogDescription className="text-purple-200 text-sm leading-relaxed text-center">
              Görmek ve daha sonra tekrar açmak için giriş yap — 10 saniye sürer.
            </DialogDescription>

            <div className="space-y-4 pt-2">
              <GoogleButton
                onClick={handleGoogleClick}
                disabled={googleLoading}
                label={googleLoading ? "Yönlendiriliyor..." : "Google ile Devam Et"}
              />

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-purple-500/20" />
                <span className="text-purple-300/60 text-sm">veya</span>
                <div className="h-px flex-1 bg-purple-500/20" />
              </div>

              <Button
                onClick={() => setView("email-form")}
                size="lg"
                className="w-full h-14 bg-slate-700/50 hover:bg-slate-700 border border-purple-500/30 text-white rounded-xl"
              >
                <Mail className="w-5 h-5" />
                Email ile Devam Et
              </Button>
            </div>

          </>
        )}

        {view === "email-form" && (
          <>
            <DialogTitle className="text-2xl text-white font-serif text-center">
              Email ile Devam Et
            </DialogTitle>
            <DialogDescription className="text-purple-200 text-sm leading-relaxed text-center">
              Email adresinize bir giriş bağlantısı göndereceğiz.
            </DialogDescription>

            <div className="space-y-3 pt-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ornek@email.com"
                disabled={status === "sending"}
                className="h-14 text-lg rounded-xl border-2 bg-slate-700/50 border-purple-500/30 text-white placeholder:text-purple-300/50 focus:border-purple-400 focus:bg-slate-700"
              />

              {status === "error" && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-red-400 text-sm text-center"
                >
                  {errorMsg || "Bir hata oluştu, tekrar deneyin."}
                </motion.p>
              )}

              <Button
                onClick={handleEmailSubmit}
                disabled={!isValidEmail(email) || status === "sending"}
                size="lg"
                className="w-full h-14 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "sending" ? "Gönderiliyor..." : "Devam Et"}
              </Button>
            </div>

            <div className="text-center pt-2">
              <button
                onClick={() => setView("options")}
                className="inline-flex items-center gap-1.5 text-purple-300/60 hover:text-purple-200 text-sm transition-colors mx-auto"
              >
                <ArrowLeft className="w-4 h-4" />
                Geri
              </button>
            </div>
          </>
        )}

        {view === "sent" && (
          <div className="text-center space-y-6 py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mx-auto">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <DialogTitle className="text-2xl text-white font-serif">
              Email'inizi kontrol edin
            </DialogTitle>
            <DialogDescription className="text-purple-200">
              <span className="text-white font-medium">{email}</span> adresine bir bağlantı gönderdik.
              Gelen kutusundaki linke tıkladığınızda raporunuz otomatik oluşturulacak.
            </DialogDescription>
            <p className="text-slate-400 text-sm">
              Email gelmedi mi? Spam klasörünü kontrol edin.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
