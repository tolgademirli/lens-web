import { BrowserRouter, Routes, Route } from "react-router";
import { RaporPage } from "@/pages/RaporPage";
import { Welcome } from "@/app/components/Welcome";
import { BooksStep } from "@/app/components/BooksStep";
import { MoviesStep } from "@/app/components/MoviesStep";
import { MusicStep } from "@/app/components/MusicStep";
import { GeneratingReport } from "@/app/components/GeneratingReport";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/books" element={<BooksStep />} />
        <Route path="/movies" element={<MoviesStep />} />
        <Route path="/music" element={<MusicStep />} />
        <Route path="/generating" element={<GeneratingReport />} />
        <Route path="/rapor/:id" element={<RaporPage />} />
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
