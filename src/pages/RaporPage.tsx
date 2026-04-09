import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchReport } from "@/lib/supabase";
import type { Report } from "@/lib/types";
import { HeroSection } from "@/app/components/HeroSection";
import { TextureSection } from "@/app/components/TextureSection";
import { ThreadsSection } from "@/app/components/ThreadsSection";
import { ContrastsSection } from "@/app/components/ContrastsSection";
import { ShadowSection } from "@/app/components/ShadowSection";
import { FooterSection } from "@/app/components/FooterSection";

export function RaporPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchReport(id).then((data) => {
      if (!data) setNotFound(true);
      else setReport(data);
      setLoading(false);
    });
  }, [id]);

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

  return (
    <div className="bg-black">
      <HeroSection data={report.hero} />
      <TextureSection data={report.texture} />
      <ThreadsSection data={report.threads} />
      <ContrastsSection data={report.contrasts} />
      <ShadowSection data={report.shadow} />
      <FooterSection />
    </div>
  );
}
