import { useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Mail, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { sendMagicLink } from "@/lib/supabase";

type Status = "idle" | "sending" | "sent" | "error";

export function EmailOptIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const isValidEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleSubmit = async () => {
    if (!isValidEmail(email)) return;
    setStatus("sending");
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await sendMagicLink(email.trim(), redirectTo);
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  if (status === "sent") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl text-white font-serif">Email'inizi kontrol edin</h2>
          <p className="text-purple-200">
            <span className="text-white font-medium">{email}</span> adresine bir bağlantı gönderdik.
            Gelen kutusundaki linke tıkladığınızda raporunuz otomatik oluşturulacak.
          </p>
          <p className="text-slate-400 text-sm">
            Email gelmedi mi? Spam klasörünü kontrol edin.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full space-y-8"
      >
        {/* İkon */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-6">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl text-white font-serif mb-3">
            Raporunuzu kaydetmek ister misiniz?
          </h2>
          <p className="text-purple-200 text-sm leading-relaxed">
            Email adresinizle giriş yaparsanız raporunuz hesabınıza bağlanır
            ve kişiselleştirilmiş deneyimlerden yararlanabilirsiniz.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-3">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyPress={handleKeyPress}
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
            onClick={handleSubmit}
            disabled={!isValidEmail(email) || status === "sending"}
            size="lg"
            className="w-full h-14 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "sending" ? "Gönderiliyor..." : "Devam Et"}
          </Button>
        </div>

        {/* Skip */}
        <div className="text-center">
          <button
            onClick={() => navigate("/generating")}
            className="text-slate-400 hover:text-purple-300 text-sm transition-colors underline underline-offset-4"
          >
            Hayır, anonim devam et
          </button>
        </div>
      </motion.div>
    </div>
  );
}
