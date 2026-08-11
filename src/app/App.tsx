import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { ReportPage } from "@/pages/ReportPage";
import { Dashboard } from "@/pages/Dashboard";
import { DashboardReports } from "@/pages/DashboardReports";
import { MyList } from "@/pages/MyList";
import { Settings } from "@/pages/Settings";
import { Welcome } from "@/app/components/Welcome";
import { TasteForm } from "@/app/components/TasteForm";
import { GeneratingReport } from "@/app/components/GeneratingReport";
import { AuthCallback } from "@/app/components/AuthCallback";
import { TelegramConnect } from "@/app/components/TelegramConnect";
import { Login } from "@/app/components/Login";

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
        <Route path="/connect" element={<TelegramConnect />} />
        <Route path="/generating" element={<GeneratingReport />} />
        <Route path="/report/:id" element={<ReportPage />} />
        <Route path="/login" element={<Login />} />
        {/* Panel sekmeleri. Rota dili İngilizce (BUG-01 dersi). */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/reports" element={<DashboardReports />} />
        <Route path="/dashboard/list" element={<MyList />} />
        <Route path="/settings" element={<Settings />} />
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
    </BrowserRouter>
  );
}
