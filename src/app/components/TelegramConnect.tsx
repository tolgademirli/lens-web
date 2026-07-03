import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import { CheckCircle, XCircle, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { supabase } from "@/lib/supabase";

type Status = "waiting" | "linking" | "success" | "error" | "unavailable";

export function TelegramConnect() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const [status, setStatus] = useState<Status>(code ? "waiting" : "unavailable");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!code) return;

    const linkAccount = async () => {
      setStatus("linking");
      const { error } = await supabase.functions.invoke("link-telegram", {
        body: { code },
      });
      if (error) {
        setErrorMsg("Bağlantı kurulamadı. Kodun süresi dolmuş olabilir — bottan yeni kod al.");
        setStatus("error");
      } else {
        setStatus("success");
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        subscription.unsubscribe();
        linkAccount();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        subscription.unsubscribe();
        linkAccount();
      }
    });

    return () => subscription.unsubscribe();
  }, [code]);

  const telegramBotUrl = import.meta.env.VITE_TELEGRAM_BOT_URL as string | undefined;

  if (status === "unavailable") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-4"
        >
          <p className="text-purple-200 text-lg font-serif">Telegram bağlantısı yakında</p>
          <p className="text-slate-400 text-sm">
            Bu özellik henüz aktif değil. Bot hazır olduğunda buraya otomatik yönlendirileceksin.
          </p>
        </motion.div>
      </div>
    );
  }

  if (status === "waiting" || status === "linking") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-4"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500"
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
          <p className="text-purple-200">
            {status === "linking" ? "Hesabın bağlanıyor..." : "Oturum açılıyor..."}
          </p>
        </motion.div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl text-white font-serif">Hesabın bağlandı!</h2>
          <p className="text-purple-200 text-sm leading-relaxed">
            Telegram hesabın artık Lens profilinle eşleşti.
            Geçmiş raporların hesabına kaydedildi.
          </p>
          {telegramBotUrl ? (
            <Button
              asChild
              size="lg"
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl"
            >
              <a href={telegramBotUrl}>Telegram'a Dön</a>
            </Button>
          ) : (
            <p className="text-slate-400 text-sm">Telegram uygulamasına dönebilirsin.</p>
          )}
        </motion.div>
      </div>
    );
  }

  // error
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center space-y-6"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30">
          <XCircle className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-2xl text-white font-serif">Bağlantı kurulamadı</h2>
        <p className="text-slate-400 text-sm">{errorMsg || "Bir hata oluştu."}</p>
        {telegramBotUrl && (
          <Button asChild variant="ghost" className="text-purple-200 hover:text-white">
            <a href={telegramBotUrl}>Telegram'a Dön</a>
          </Button>
        )}
      </motion.div>
    </div>
  );
}
