import { useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";

function restoreSessionFromLocalStorage() {
  const map = {
    books: "lens_pending_books",
    movies: "lens_pending_movies",
    music: "lens_pending_music",
  } as const;
  (Object.keys(map) as (keyof typeof map)[]).forEach((key) => {
    const stored = localStorage.getItem(map[key]);
    if (stored && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, stored);
    }
  });
}

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("intent");

    function handleNav(sub: { unsubscribe: () => void }) {
      sub.unsubscribe();
      if (intent === "reports") {
        navigate("/reports", { replace: true });
      } else {
        restoreSessionFromLocalStorage();
        navigate("/generating", { replace: true });
      }
    }

    // Supabase magic link'ten dönen URL hash'ini otomatik işler.
    // onAuthStateChange ile session oluşunca intent'e göre yönlendir.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") handleNav(subscription);
    });

    // Sayfa yüklenirken zaten oturum varsa (hash zaten işlendi) direkt geç
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) handleNav(subscription);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

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
