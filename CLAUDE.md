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
npm run dev:local   # geliştirme — LOKAL Supabase stack'e bağlanır
npm run dev         # geliştirme — PRODUCTION Supabase'e bağlanır
npm run build       # production build → dist/
npx supabase start / stop / db reset / db push
npx supabase functions deploy <name>   # edge function deploy
```
Test komutu yok. **`vite build` tip denetimi YAPMAZ** (esbuild tipleri sadece siler) ve
typescript projede bağımlı değil. Gerçek denetim için:
`npx --yes --package typescript@5.6 tsc --noEmit -p tsconfig.json`
(Mevcut, bu değişiklikten önce de var olan hatalar: `vite/client` ve `@types/react-dom`
tanımlarının eksikliği, `preferences.ts` boolean daralması, ImportFlow'un `source` karşılaştırmaları.)
Geliştirme, test ve deploy akışının tamamı: [`docs/gelistirme.md`](docs/gelistirme.md).

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
    preferences.ts # user_preferences okuma/yazma + varsayılanlar
    types.ts       # TypeScript arayüzleri (Report, WorkEntry, DailyDiscovery vb.)
    formLimits.ts  # MIN_TOTAL_ENTRIES / MAX_ENTRIES_PER_CATEGORY — tek kaynak
    tasteDraft.ts  # sessionStorage taslak sözleşmesi + normalizasyon
  pages/
    ReportPage.tsx     # /report/:id — rapor görüntüleme + paylaşım kontrolü
    Dashboard.tsx      # /dashboard — kullanıcının raporları
    Settings.tsx       # /settings — kullanıcı tercihleri (haftalık seçki toggle'ı)
    ReportsPage.tsx    # alternatif liste görünümü
  main.tsx
supabase/
  functions/
    analyze/           # Kitap+film+müzik → estetik rapor (Claude API → reports insert)
    extract-works/     # Ekran görüntüsü / yapıştırılan metin → eser listesi (Claude vision)
    daily-discovery/   # Günlük keşif önerisi (cache: daily_discoveries tablosu)
    link-telegram/     # Telegram hesap bağlama
    send-weekly-picks/ # Haftalık film seçkisi maili (Resend) — index.ts + email.ts
  migrations/
    daily_discoveries.sql
    telegram_link_codes.sql
    user_works.sql       # eser havuzu + rapor↔eser provenance
    weekly_picks.sql     # user_preferences + weekly_picks
guidelines/
  Guidelines.md        # Figma Make şablonu — uygulama kuralları değil
docs/
  schema.md            # Tablo şemaları (reports, daily_discoveries, auth.users)
```

## Rota haritası
| Rota | Bileşen | Açıklama |
|------|---------|----------|
| `/` | `Welcome` | Giriş / onboarding |
| `/start` | `TasteForm` | Tek ekran, üç sekme — kullanıcı girdisi sessionStorage'da birikir |
| `/books` `/movies` `/music` | — | Eski adım rotaları; `/start`'a yönlenir (silinmedi, BUG-01 dersi) |
| `/generating` | `GeneratingReport` | `analyze` edge function'ı çağırır, rapor ID'siyle yönlendirir |
| `/report/:id` | `ReportPage` | Raporu gösterir; sahip ise public/private toggle |
| `/dashboard` | `Dashboard` | Kullanıcının tüm raporları |
| `/settings` | `Settings` | Kullanıcı tercihleri — haftalık film seçkisi opt-out |
| `/auth/callback` | `AuthCallback` | OAuth + magic link dönüşü |
| `/connect` | `TelegramConnect` | Telegram hesap bağlama |

## Veri akışı: rapor oluşturma
1. Kullanıcı `/start`'ta tek ekranda sinyal girer. Eşik **toplamda 6**, dağılım serbest —
   6+0+0 da geçerli, kategori boş kalabilir. Kategori başına tavan 8. Sınırlar
   `src/lib/formLimits.ts`'te; `analyze`'daki kardeşleri elle senkron tutulur (ayrı Deno bundle).
2. Her sinyal yapılı bir `WorkEntry`: `{title, creator, source, workId}`. Yazar ve eser adı
   ayrı tutuluyor çünkü kullanıcı ikisini ayrı düzenleyebiliyor; `source`/`workId` nesnenin
   içinde durur — eskiden paralel dizilerdeydi ve indeks kayması sessizce yanlış edinim yolu yazardı.
3. Gönderimde taslak **çift yazılır**: `sessionStorage` (aynı sekme, doğrudan giriş yolu)
   + `localStorage["lens_pending_report"]` (OAuth/magic link redirect'i sekme sessionStorage'ını
   sıfırlar, localStorage köprüyü sağlar). İkisi kasıtlı — tek kaynağa indirme dürtüsüne kapılma.
   Okuma/yazma `src/lib/tasteDraft.ts` + `src/lib/pendingReport.ts`; kayıt 60 dakika sonra geçersizleşir.
   İkisi de eski 9-anahtarlı / string[] biçimini okuyup yükseltir (deploy anındaki kullanıcı kaybolmasın).
4. `/generating` **bütün taslağı** seçer (kategori kategori karıştırmaz — taze bir kategoriyi
   bayat bir kategoriyle birleştirmek sessizce yanlış rapor üretirdi), sonra `analyzeAndCreateReport()`.
5. `analyze` edge function: Claude API → JSON rapor → `reports` insert → `reportId`.
   Ardından eserler `user_works` havuzuna, rapor↔eser ilişkisi `report_works`'e yazılır.
   `source` sinyalin kendi içinden gelir (`screenshot` | `paste` | `manual`); tanınmayan değer
   `form`'a düşer. `form` bir varsayılan — form akışının damgası değil, elle yazılan eser `manual`.
   Bu yazım **best-effort**: hata alırsa loglanır ve yutulur, rapor dönüşünü asla bloklamaz.
6. Client `/report/:id`'ye yönlendirilir; `fetchReport()` RLS'e göre raporu çeker.

## Veri akışı: haftalık film seçkisi
**Kürasyon manuel.** Hiçbir kod film seçmez — Claude bu akışa hiç girmez.

1. Seçki `weekly_picks` tablosuna **elle** girilir (SQL Editor veya dışarıda üretilmiş JSON):
   `user_id`, `week`, `films`, `intro_variant`. Satır `status='draft'` doğar.
2. `send-weekly-picks` edge function'ı elle invoke edilir (**cron yok**), gövde: `{"week":"YYYY-MM-DD"}`.
3. Fonksiyon önce **bayat satırları süpürür**: haftası 7 günden fazla geçmiş `draft` satırlar
   `overpast` ile terminal olarak kapanır. Sonra o haftanın `draft` satırlarını çeker,
   `user_preferences` ile kesişimini alır ve `weekly_picks_enabled = false` olanları **atlar**
   (satır yoksa varsayılan açık → gönderilir).
4. Her alıcı için `email.ts` HTML + düz metin render eder, Resend'e yollanır
   (`from: tolga@lensestetik.com`, `reply_to`: secret'tan gelen gerçek kutu).
5. Başarı → `status='sent'`, `sent_at=now()`, PostHog `weekly_pick_sent`. Hata → `status='failed'`,
   loglanır, **döngü devam eder** — bir mailin hatası diğerlerini durdurmaz.

Çağrı, `x-weekly-picks-secret` header'ı ile korunur: `verify_jwt` tek başına yetmez, çünkü
oturumu olan herhangi bir kullanıcı fonksiyonu invoke edip tüm haftanın mailini attırabilirdi.

Gerekli secret'lar (`supabase secrets set`): `RESEND_API_KEY`, `WEEKLY_PICKS_SECRET`,
`WEEKLY_PICKS_REPLY_TO`. Opsiyonel: `WEEKLY_PICKS_FROM`, `SITE_URL`, `POSTHOG_KEY`, `POSTHOG_HOST`.

## Kritik kurallar
- Onboarding eşiği **toplamda 6 sinyal**, kategori başına değil. Kategori zorunluluğuna geri
  dönme: "3 favori film yaz", film izlemeyen kullanıcıyı daha portresi çıkmadan eliyordu.
  Boş kategori bir kusur değil — rapor bunu bir kez, dürüstçe söyler.
- `shadow` **her zaman tam 3 öneri** (1 Kitap + 1 Film + 1 Müzik), kullanıcı o kategoride hiçbir
  şey vermemiş olsa bile: boş kategori bir keşif kapısıdır. `analyze` bunu insert öncesi
  doğrular; `ShadowSection`'ın `md:grid-cols-3` düzeni ve `data.map`'i buna dayanıyor.
- Sinyalin `title` ve `creator`'ı **ayrı taşınır** (`WorkEntry`). Tek string'e ("Başlık - Yaratıcı")
  geri dönme: ayırıcısız bir satır hep yaratıcı sanılıyordu, yalnız eser adı yanlış kolona yazılıyordu.
  `analyze`'daki `parseEntry` yalnızca 60 dk TTL'deki eski kayıtlar için duruyor.
- Haftalık seçki maili **görselsiz** kalır (afiş/poster yok) ve link sayısı düşük tutulur —
  bu bir deliverability kararı (Gmail Promotions riski), estetik tercih değil.
- `send-weekly-picks` film **seçmez**; tek işi göndermektir. Kürasyonu otomatikleştirme dürtüsüne kapılma.
- Haftası geçmiş seçki **gönderilmez** (`overpast`). Opt-out'tan dönen kullanıcı yalnızca
  tercihini açtıktan sonraki haftaları alır — birikmiş seçkiler toplu halde gitmez.
  Geri-doldurma yalnızca açık `allow_overpast: true` bayrağıyla mümkün.
- PostHog'da edinim yolu `source` property'siyle ve `user_works.source` sözlüğüyle gider
  (`screenshot` | `paste` | `manual` | `form`); şemsiye bir `import` değeri **YOK**. Event'e düşen
  değer kütüphaneye yazılanla aynı değişkenden türer (`captureSourcePath`, ImportFlow'da `flowSource`) —
  event için ayrı bir kaynak hesaplaması açma, ikisi ayrışır.
- `ANTHROPIC_API_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` **sadece edge function ortamında** yaşar. Client koduna asla import edilmez.
- `.env.local`'a dokunma. Yeni env değişkeni eklenecekse `.env.example`'a belgele.
- Rota `/report/:id` — eski `/rapor/:id` kaldırıldı (BUG-01). Rota dili İngilizce.
- `/start`, `Welcome` ile birlikte yeni düz koyu görsel dili kullanır (`--lens-*` tokenları,
  `src/styles/theme.css`). Rapor ve panel gradyan dilinde kalır — geçişteki kontrast kasıtlı.
- `is_public = false` olan rapor **asla** auth'suz endpoint'ten dönmemeli. `fetchReport()` içindeki RLS sorgusunu bozmadan koru.
- `src/app/supabase.ts` ve `src/app/types.ts` deprecated — bunlara yeni kod yazma, `src/lib/` kullan.

## Şema
Tablo kolonları, JSONB yapıları ve RLS kuralları için bkz. [`docs/schema.md`](docs/schema.md).
Haftalık seçki kurulumu, gönderim komutu ve doğrulama testleri: [`docs/weekly-picks.md`](docs/weekly-picks.md).
