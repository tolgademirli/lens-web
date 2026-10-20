import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { readPendingReport, pendingReportIsComplete } from "@/lib/pendingReport";
import { posthog } from "@/lib/posthog";
import { Button } from "./ui/button";

/**
 * Supabase, kullanılmış ya da süresi dolmuş bir giriş bağlantısını dönüş adresine
 * oturumla değil hata parametreleriyle yollar (`#error=access_denied&error_code=…`).
 */
function linkWasRejected(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  return ["error", "error_code", "error_description"].some(
    (key) => hash.has(key) || search.has(key)
  );
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    function handleNav(sub: { unsubscribe: () => void }) {
      sub.unsubscribe();
      const method = localStorage.getItem("lens_auth_method") as
        | "google"
        | "magic_link"
        | "email_code"
        | null;
      if (method) {
        posthog.capture("auth_completed", { method });
        localStorage.removeItem("lens_auth_method");
      }
      // Sadece "var mı" yetmez: eksik bir kayıt kullanıcıyı /generating'e atar,
      // orası da onu geri fırlatır. Eşiği burada da uygula.
      const ready = pendingReportIsComplete(readPendingReport());
      navigate(ready ? "/generating" : "/dashboard", { replace: true });
    }

    // Oturum sorgusundan ÖNCE okunur: adres çubuğu sonradan değişebilir.
    const linkRejected = linkWasRejected();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") handleNav(subscription);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleNav(subscription);
      // Oturum yok ve bağlantı reddedilmiş: SIGNED_IN hiç gelmeyecek. Eskiden bu
      // ekran sonsuza dek "Oturum açılıyor..." diyordu. E-postada kod da durduğundan
      // (kodu yazıp sonra bağlantıya dokunan) bu duruma artık daha sık düşülür.
      // Oturum VARSA hata yok sayılır: kişi zaten içeride, yoluna devam eder.
      else if (linkRejected) setRejected(true);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (rejected) {
    // Taslağı bu tarayıcıda duran kişi formuna döner (sinyalleri yerinde, giriş
    // penceresi bir düğme uzakta); taslağı olmayan giriş sayfasına.
    const hasDraft = pendingReportIsComplete(readPendingReport());
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <p className="text-white text-lg">Bu giriş bağlantısı artık geçerli değil.</p>
          <p className="text-purple-200 text-sm">
            Bağlantı yalnızca bir kez kullanılır ve bir süre sonra geçersizleşir. E-postadaki
            kodla giriş yaptıysan bir şey kaybolmadı: raporun, kodu yazdığın ekranda.
          </p>
          <Button
            onClick={() => navigate(hasDraft ? "/start" : "/login", { replace: true })}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl px-8"
          >
            Yeniden giriş yap
          </Button>
        </div>
      </div>
    );
  }

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
        <p className="text-purple-200">Oturum açılıyor...</p>
      </motion.div>
    </div>
  );
}
