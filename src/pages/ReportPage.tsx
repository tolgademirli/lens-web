import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchReport, getCurrentUser, updateReportVisibility } from "@/lib/supabase";
import type { Report } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import { HeroSection } from "@/app/components/HeroSection";
import { TextureSection } from "@/app/components/TextureSection";
import { ThreadsSection } from "@/app/components/ThreadsSection";
import { ContrastsSection } from "@/app/components/ContrastsSection";
import { ShadowSection } from "@/app/components/ShadowSection";
import { FooterSection } from "@/app/components/FooterSection";
import { Switch } from "@/app/components/ui/switch";
import { Button } from "@/app/components/ui/button";
import { Lock, Globe2, Copy, Check } from "lucide-react";

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchReport(id), getCurrentUser()]).then(([data, user]) => {
      if (!data) setNotFound(true);
      else {
        setReport(data);
        setIsPublic(data.is_public);
      }
      setCurrentUser(user);
      setLoading(false);
    });
  }, [id]);

  async function handleToggle(checked: boolean) {
    if (!id) return;
    setToggling(true);
    const success = await updateReportVisibility(id, checked);
    if (success) setIsPublic(checked);
    setToggling(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm uppercase tracking-wider">Rapor yükleniyor</p>
        </div>
      </div>
    );
  }

  if (notFound || !report) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4 px-6">
          <p className="text-slate-500 text-6xl">404</p>
          <h1 className="text-white text-2xl font-serif">Rapor bulunamadı</h1>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            Bu rapor mevcut değil veya gizlilik ayarları nedeniyle erişilemiyor.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = !!currentUser && currentUser.id === report.user_id;
  const shareUrl = `${window.location.origin}/report/${id}`;

  return (
    <div className="bg-black">
      <HeroSection data={report.hero} />
      <TextureSection data={report.texture} />
      <ThreadsSection data={report.threads} />
      <ContrastsSection data={report.contrasts} />
      <ShadowSection data={report.shadow} />

      {isOwner && (
        <div className="bg-slate-900 px-6 py-8">
          <div className="max-w-2xl mx-auto rounded-2xl border border-purple-500/20 bg-slate-800/60 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isPublic ? (
                  <Globe2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Lock className="w-4 h-4 text-slate-400" />
                )}
                <span className="text-white font-medium">
                  {isPublic ? "Paylaşıma Açık" : "Özel"}
                </span>
              </div>
              <Switch checked={isPublic} onCheckedChange={handleToggle} disabled={toggling} />
            </div>
            <p className="text-sm text-slate-400">
              {isPublic
                ? "Link ile herkes bu raporu görüntüleyebilir"
                : "Sadece siz bu raporu görüntüleyebilirsiniz"}
            </p>
            {isPublic && (
              <>
                <hr className="border-slate-700" />
                <div>
                  <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">
                    Paylaşım Linki
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      readOnly
                      value={shareUrl}
                      className="flex-1 bg-slate-900 text-slate-300 text-sm rounded-xl px-4 py-2.5 border border-slate-700 outline-none"
                    />
                    <Button
                      disabled={copied}
                      onClick={() => {
                        navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className={copied
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-xl cursor-default"
                        : "bg-purple-500/20 hover:bg-purple-500/30 text-purple-100 border border-purple-500/30 rounded-xl"
                      }
                    >
                      {copied ? (
                        <><Check className="w-4 h-4 mr-2" /> Kopyalandı</>
                      ) : (
                        <><Copy className="w-4 h-4 mr-2" /> Kopyala</>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <FooterSection />
    </div>
  );
}
