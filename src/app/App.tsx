import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { ReportPage } from "@/pages/ReportPage";
import { Dashboard } from "@/pages/Dashboard";
import { DashboardReports } from "@/pages/DashboardReports";
import { MyList } from "@/pages/MyList";
import { Account } from "@/pages/Account";
import { CookiesPage, PrivacyPage, TermsPage } from "@/pages/Legal";
import { Welcome } from "@/app/components/Welcome";
import { TasteForm } from "@/app/components/TasteForm";
import { GeneratingReport } from "@/app/components/GeneratingReport";
import { AuthCallback } from "@/app/components/AuthCallback";
import { Login } from "@/app/components/Login";
import { AnalyticsConsentBanner } from "@/app/components/AnalyticsConsent";
import { TransferConsentGate } from "@/app/components/TransferConsent";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/start" element={<TasteForm />} />
        {/* Üç adımlı akışın eski rotaları. BUG-01'in dersi: rota silinmez,
            yönlendirilir — kullanıcı geçmişinde ve dış bağlantılarda yaşıyorlar. */}
        <Route path="/books" element={<Navigate to="/start" replace />} />
        <Route path="/movies" element={<Navigate to="/start" replace />} />
        <Route path="/music" element={<Navigate to="/start" replace />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* Telegram hesap bağlama sayfasıydı; bot desteklenmiyor, sayfa ve
            link-telegram kaldırıldı (20 Ekim 2026). Botun eski mesajlarındaki
            bağlantılar ana sayfaya düşer (BUG-01 dersi). */}
        <Route path="/connect" element={<Navigate to="/" replace />} />
        <Route path="/generating" element={<GeneratingReport />} />
        <Route path="/report/:id" element={<ReportPage />} />
        <Route path="/login" element={<Login />} />
        {/* Panel sekmeleri. Rota dili İngilizce (BUG-01 dersi). */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/reports" element={<DashboardReports />} />
        <Route path="/dashboard/list" element={<MyList />} />
        {/* Her zaman açık: analitik izni ve hesap silme burada, hiçbir anahtara
            bağlı değil. */}
        <Route path="/account" element={<Account />} />
        {/* Tercihler /settings'ten /account'a taşındı. Rota SİLİNMEZ, yönlendirilir
            (BUG-01 dersi): yayına çıkmış haftalık seçki maillerinde bu adres var. */}
        <Route path="/settings" element={<Navigate to="/account" replace />} />
        {/* Hukuki metinler. Oturum istemezler: rıza vermeden önce okunabilmeliler. */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="*"
          element={
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
              <div className="text-center space-y-4 px-6">
                <p className="text-slate-500 text-6xl">404</p>
                <h1 className="text-white text-2xl font-serif">Sayfa bulunamadı</h1>
              </div>
            </div>
          }
        />
      </Routes>
      {/* Rotaların DIŞINDA: karar verilene kadar hangi sayfada olunursa olsun görünür. */}
      <AnalyticsConsentBanner />
      {/* O da rotaların dışında: oturumu olup yurt dışı aktarımına rıza kaydı
          olmayan kişiye hangi sayfadan girerse girsin sorulur. */}
      <TransferConsentGate />
    </BrowserRouter>
  );
}
