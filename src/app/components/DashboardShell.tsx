import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { motion } from "motion/react";
import { Bookmark, Compass, FileText, LogOut, Plus, Sparkles, User, UserCog } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { getCurrentUser, supabase } from "@/lib/supabase";

/**
 * Panelin ortak kabuğu: başlık + sekmeler. Sekmelerin hepsi aynı kabuğu kullanır
 * ki sekme değiştirmek sayfa kimliğini değiştirmesin.
 *
 * Rota dili İngilizce (BUG-01 dersi): /dashboard, /dashboard/reports,
 * /dashboard/list, /account.
 *
 * "Hesabım" panelin İÇİNDE bir sekme: tercihler eskiden panelin dışındaki
 * /settings'teydi ve kullanıcı ayarı değiştirip panele dönmek için geri tuşuna
 * basıyordu. /settings artık /account'a yönleniyor (yayına çıkmış maillerdeki
 * eski linkler kırılmasın).
 */
const TABS = [
  { to: "/dashboard", label: "Keşifler", Icon: Compass, end: true },
  { to: "/dashboard/reports", label: "Raporlar", Icon: FileText, end: false },
  { to: "/dashboard/list", label: "Listem", Icon: Bookmark, end: false },
  { to: "/account", label: "Hesabım", Icon: UserCog, end: false },
];

interface DashboardShellProps {
  children: ReactNode;
  /** İçerik hazır mı — hazır değilse ortak yükleme durumu gösterilir. */
  loading?: boolean;
}

export function DashboardShell({ children, loading = false }: DashboardShellProps) {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setUserEmail(user.email ?? "");
    }
    init();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="sticky top-0 z-10 border-b border-purple-500/20 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="flex items-center justify-between gap-2 py-4">
            {/* min-w-0: sol grup küçülebilmeli, yoksa e-posta satırı kırpılmak yerine
                sağdaki aksiyonları (shrink-0 butonlar) mobilde ekran dışına iter. */}
            <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-light tracking-widest text-white">LENS</h1>
                <div className="flex items-center gap-2 text-sm text-purple-200">
                  <User className="h-4 w-4 shrink-0" />
                  <span className="truncate">{userEmail}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <Button
                onClick={() => navigate("/start")}
                aria-label="Yeni Rapor"
                className="gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg hover:from-purple-600 hover:to-pink-600"
              >
                <Plus className="h-5 w-5" />
                <span className="hidden sm:inline">Yeni Rapor</span>
              </Button>
              {/* Ayar dişlisi kalktı: aynı yere götüren iki giriş (dişli + sekme)
                  kullanıcıya iki ayrı yer varmış gibi geliyordu. */}
              <Button
                variant="ghost"
                onClick={handleSignOut}
                aria-label="Çıkış"
                className="gap-2 rounded-xl px-2 text-purple-200 hover:bg-slate-700/50 hover:text-white sm:px-3"
              >
                <span className="hidden sm:inline">Çıkış</span>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <nav className="flex gap-6">
            {TABS.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 border-b-2 pb-3 text-sm transition-colors ${
                    isActive
                      ? "border-purple-400 text-white"
                      : "border-transparent text-purple-300/70 hover:text-purple-100"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        {loading ? <ShellLoading /> : children}
      </div>
    </div>
  );
}

function ShellLoading() {
  return (
    <div className="flex justify-center py-24">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500"
      >
        <Sparkles className="h-8 w-8 text-white" />
      </motion.div>
    </div>
  );
}
