# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje
Lens (lensestetik.com): kullanıcıların kitap/film/müzik zevkinden "estetik arketip" raporu üreten platform. Türkçe ürün — tüm kullanıcıya dönük metinler Türkçe yazılır; arketip dili korunur (edebi, sıcak, jenerik SaaS dili değil).

## Yığın
- React 18 + Vite 6 + TypeScript, Tailwind v4, shadcn/ui (Radix primitives)
- Supabase: auth (magic link + Google OAuth), Postgres, edge functions (Deno)
- Claude API (`claude-sonnet-4-6`): rapor ve günlük keşif üretimi — **sadece edge function içinden çağrılır**
- Vercel hosting (SPA rewrite: `vercel.json`), Cloudflare domain

## Komutlar
```
npm run dev      # geliştirme sunucusu
npm run build    # production build → dist/
supabase functions deploy <name>   # edge function deploy
```
Test komutu yok. TypeScript kontrolü Vite build sırasında çalışır.

## Yapı

```
src/
  app/
    components/   # UI bileşenleri (step akışı + rapor bölümleri)
    App.tsx        # React Router rota tanımları
    supabase.ts    # KULLANMA — deprecated, src/lib/supabase.ts kullan
    types.ts       # KULLANMA — deprecated, src/lib/types.ts kullan
  lib/
    supabase.ts    # Tüm Supabase sorguları ve auth yardımcıları
    types.ts       # TypeScript arayüzleri (Report, DailyDiscovery vb.)
  pages/
    ReportPage.tsx     # /report/:id — rapor görüntüleme + paylaşım kontrolü
    Dashboard.tsx      # /dashboard — kullanıcının raporları
    ReportsPage.tsx    # alternatif liste görünümü
  main.tsx
supabase/
  functions/
    analyze/           # Kitap+film+müzik → estetik rapor (Claude API → reports insert)
    daily-discovery/   # Günlük keşif önerisi (cache: daily_discoveries tablosu)
    link-telegram/     # Telegram hesap bağlama
  migrations/
    daily_discoveries.sql
guidelines/
  Guidelines.md        # Figma Make şablonu — uygulama kuralları değil
docs/
  schema.md            # Tablo şemaları (reports, daily_discoveries, auth.users)
```

## Rota haritası
| Rota | Bileşen | Açıklama |
|------|---------|----------|
| `/` | `Welcome` | Giriş / onboarding |
| `/books` → `/movies` → `/music` | Step bileşenleri | Kullanıcı girdisi — sessionStorage'da birikir |
| `/generating` | `GeneratingReport` | `analyze` edge function'ı çağırır, rapor ID'siyle yönlendirir |
| `/report/:id` | `ReportPage` | Raporu gösterir; sahip ise public/private toggle |
| `/dashboard` | `Dashboard` | Kullanıcının tüm raporları |
| `/auth/callback` | `AuthCallback` | OAuth + magic link dönüşü |
| `/connect` | `TelegramConnect` | Telegram hesap bağlama |

## Veri akışı: rapor oluşturma
1. Kullanıcı 3 adımda 3–5'er kitap/film/müzik girer; veriler `sessionStorage`'a yazılır.
2. MusicStep tamamlanınca form verisi **çift yazılır**: `sessionStorage` (aynı sekme, doğrudan giriş yolu)
   + `localStorage["lens_pending_report"]` (OAuth/magic link redirect'i sekme sessionStorage'ını sıfırlar,
   localStorage köprüyü sağlar). İkisi kasıtlı — tek kaynağa indirme dürtüsüne kapılma.
   Okuma/temizleme mantığı `src/lib/pendingReport.ts` içinde; kayıt 60 dakika sonra otomatik geçersizleşir.
3. `/generating` sayfası `analyzeAndCreateReport()` → `supabase.functions.invoke("analyze")` çağırır.
4. `analyze` edge function: Claude API → JSON rapor → `reports` tablosuna insert → `reportId` döner.
5. Client `/report/:id`'ye yönlendirilir; `fetchReport()` RLS'e göre raporu çeker.

## Kritik kurallar
- `ANTHROPIC_API_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` **sadece edge function ortamında** yaşar. Client koduna asla import edilmez.
- `.env.local`'a dokunma. Yeni env değişkeni eklenecekse `.env.example`'a belgele.
- Rota `/report/:id` — eski `/rapor/:id` kaldırıldı (BUG-01).
- `is_public = false` olan rapor **asla** auth'suz endpoint'ten dönmemeli. `fetchReport()` içindeki RLS sorgusunu bozmadan koru.
- `src/app/supabase.ts` ve `src/app/types.ts` deprecated — bunlara yeni kod yazma, `src/lib/` kullan.

## Şema
Tablo kolonları, JSONB yapıları ve RLS kuralları için bkz. [`docs/schema.md`](docs/schema.md).
