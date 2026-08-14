import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { fetchReport, getCurrentUser, updateReportVisibility } from "@/lib/supabase";
import type { Report } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import { posthog } from "@/lib/posthog";
import { HeroSection } from "@/app/components/HeroSection";
import { TextureSection } from "@/app/components/TextureSection";
import { ThreadsSection } from "@/app/components/ThreadsSection";
import { ContrastsSection } from "@/app/components/ContrastsSection";
import { ShadowSection } from "@/app/components/ShadowSection";
import { FooterSection } from "@/app/components/FooterSection";
import { Button } from "@/app/components/ui/button";
import { PosterShare } from "@/app/components/PosterShare";
import { Lock, Globe2 } from "lucide-react";

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchReport(id), getCurrentUser()]).then(([data, user]) => {
      if (!data) setNotFound(true);
      else {
        setReport(data);
        setIsPublic(data.is_public);
        const is_own = !!user && user.id === data.user_id;
        posthog.capture("report_viewed", { is_own });
      }
      setCurrentUser(user);
      setLoading(false);
    });
  }, [id]);

  async function handleMakePrivate() {
    if (!id) return;
    setToggling(true);
    const success = await updateReportVisibility(id, false);
    if (success) setIsPublic(false);
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

  return (
    <div className="bg-black">
      <HeroSection data={report.hero} />
      <TextureSection data={report.texture} />
      <ThreadsSection data={report.threads} />
      <ContrastsSection data={report.contrasts} />
      <ShadowSection data={report.shadow} />

      {isOwner ? (
        <OwnerClosing
          report={report}
          isPublic={isPublic}
          toggling={toggling}
          onVisibilityChange={setIsPublic}
          onMakePrivate={handleMakePrivate}
        />
      ) : (
        <VisitorCta reportId={report.id} />
      )}

      <FooterSection />
    </div>
  );
}

// ── Owner closing block ───────────────────────────────────────────────────────

interface OwnerClosingProps {
  report: Report;
  isPublic: boolean;
  toggling: boolean;
  onVisibilityChange: (isPublic: boolean) => void;
  onMakePrivate: () => void;
}

function OwnerClosing({ report, isPublic, toggling, onVisibilityChange, onMakePrivate }: OwnerClosingProps) {
  return (
    <section className="bg-gradient-to-b from-slate-950 to-black px-6 py-20">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        {/* Label */}
        <p className="text-purple-300 uppercase tracking-[0.3em] text-xs font-medium">
          Senin Arketipin
        </p>

        {/* Archetype name */}
        <h2 className="text-3xl md:text-5xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-pink-200 to-indigo-200 text-balance leading-tight">
          {report.hero.archetype}
        </h2>

        {/* Tagline */}
        <p className="text-slate-400 text-base">
          Bu senin estetiğin. Merak edenler görsün.
        </p>

        {/* Poster önizlemesi + paylaşım aksiyonları */}
        <div className="pt-2 text-left">
          <PosterShare
            report={report}
            isPublic={isPublic}
            onVisibilityChange={onVisibilityChange}
          />
        </div>

        {/* Privacy status row */}
        <div className="flex items-center justify-center gap-2">
          {isPublic ? (
            <>
              <Globe2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs text-slate-500">
                Paylaşıma açık ·{" "}
                <button
                  onClick={onMakePrivate}
                  disabled={toggling}
                  className="text-slate-400 hover:text-slate-200 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  Gizli yap
                </button>
              </span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-500">
                Bu rapor özel · Paylaşmadan önce onayın sorulur
              </span>
            </>
          )}
        </div>

        {/* Footer nav links */}
        <div className="flex items-center gap-6 justify-center pt-4">
          <Link to="/start" className="text-slate-500 hover:text-purple-300 text-sm transition-colors">
            Yeni Rapor Oluştur
          </Link>
          <span className="text-slate-700">·</span>
          <Link to="/dashboard" className="text-slate-500 hover:text-purple-300 text-sm transition-colors">
            Ana Sayfa
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Visitor CTA block ─────────────────────────────────────────────────────────

function VisitorCta({ reportId }: { reportId: string }) {
  useEffect(() => {
    posthog.capture("visitor_cta_viewed", { report_id: reportId });
  }, [reportId]);

  return (
    <section className="bg-gradient-to-b from-slate-950 to-black px-6 py-20">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        {/* Label */}
        <p className="text-purple-300 uppercase tracking-[0.3em] text-xs font-medium">
          Senin estetik kimliğin ne?
        </p>

        {/* Description */}
        <p className="text-slate-300 text-base leading-relaxed max-w-md mx-auto">
          Bu rapor bir Lens kullanıcısına ait. Kendi estetik kimliğini keşfetmek 3 dakika sürer.
        </p>

        {/*
          Doğrudan /start'a: ziyaretçi paylaşılan bir linkten geldi, merakı
          taze. Ana sayfaya atmak onu bir adım geri götürüyordu ve döngü orada
          kopuyordu — sinyal → rapor → poster → paylaşım → merak → SİNYAL.
        */}
        <Link to="/start" className="block">
          <Button className="w-full min-h-12 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0 rounded-2xl text-sm font-medium tracking-wide">
            Kendi Raporunu Oluştur
          </Button>
        </Link>
      </div>
    </section>
  );
}
