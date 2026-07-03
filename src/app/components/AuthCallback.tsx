import { useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { readPendingReport } from "@/lib/pendingReport";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleNav(sub: { unsubscribe: () => void }) {
      sub.unsubscribe();
      const hasPending = Boolean(readPendingReport());
      navigate(hasPending ? "/generating" : "/dashboard", { replace: true });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") handleNav(subscription);
    });

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
