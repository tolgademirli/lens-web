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
api/                 # Vercel serverless fonksiyonları (Node runtime)
  _assets/fonts/     # Playfair Display Italic + Inter — poster fontları, lokal
  _lib/              # color (OKLCH/kontrast) · fonts (ölçüm) · text · poster · render · report
  poster/[reportId].ts   # Story/Feed posteri — RLS'e göre yetkilendirilir
  og/[reportId].ts       # 1200×630 link önizleme görseli — özel raporda jenerik döner
  report-preview.ts      # Crawler'a OG etiketli HTML (asla hata döndürmez)
scripts/
  poster-samples.mjs     # Elle kurulmuş verilerle poster örnekleri + inceleme sayfası
  kapi2-real-reports.mjs # Gerçek analyze çıktısıyla doğrulama (REUSE=1 kredi harcamaz)
  check-glyphs.mjs       # Font Türkçe glif denetimi
src/
  app/
    components/   # UI bileşenleri (step akışı + rapor bölümleri)
    App.tsx        # React Router rota tanımları
    supabase.ts    # KULLANMA — deprecated, src/lib/supabase.ts kullan
    types.ts       # KULLANMA — deprecated, src/lib/types.ts kullan
  lib/
    supabase.ts    # Tüm Supabase sorguları ve auth yardımcıları
    preferences.ts # user_preferences okuma/yazma + varsayılanlar
    entitlements.ts# Paket (free/premium) okumanın TEK noktası
    feedback.ts    # Karar sözlüğü + record/retract sarmalayıcıları
    myList.ts      # Listem CRUD
    discovery.ts   # Keşif/seçki -> kart verisi, kart↔sinyal eşleşmesi
    types.ts       # TypeScript arayüzleri (Report, WorkEntry, DailyDiscovery vb.)
    formLimits.ts  # MIN_TOTAL_ENTRIES / MAX_ENTRIES_PER_CATEGORY — tek kaynak
    tasteDraft.ts  # sessionStorage taslak sözleşmesi + normalizasyon
  pages/
    ReportPage.tsx     # /report/:id — rapor görüntüleme + paylaşım kontrolü
    Dashboard.tsx      # /dashboard — kullanıcının raporları
    Account.tsx        # /account — panel sekmesi: paket + öneri tercihleri
                       #   (eski /settings buraya yönleniyor; Settings.tsx kaldırıldı)
    ReportsPage.tsx    # alternatif liste görünümü
  main.tsx
supabase/
  functions/
    analyze/           # Kitap+film+müzik → estetik rapor (Claude API → reports insert)
    extract-works/     # Ekran görüntüsü / yapıştırılan metin → eser listesi (Claude vision)
    daily-discovery/   # Günlük keşif önerisi (cache: daily_discoveries tablosu)
    link-telegram/     # Telegram hesap bağlama
    _shared/           # watch.ts (izleme erişilebilirliği) · unsubscribe.ts (mail kapatma HMAC'i)
    generate-weekly-picks/ # Haftalık seçki ÜRETİMİ (Claude [+ erişilebilirlik]) — index.ts + prompt.ts
    send-weekly-picks/ # Haftalık seçki maili (Resend) — index.ts + email.ts. Film SEÇMEZ
    unsubscribe/       # Maildeki tek-dokunuş kapatma linki (verify_jwt = false)
  migrations/
    daily_discoveries.sql
    telegram_link_codes.sql
    user_works.sql       # eser havuzu + rapor↔eser provenance
    weekly_picks.sql     # user_preferences + weekly_picks
    2026...feedback_engine.sql  # US-05: sinyal defteri, Listem, eksen profili, RPC'ler
    20260815...weekly_picks_automation.sql # platforms kolonu, watch_providers,
                                # aday RPC'si, lens_active_signals'a seçki etiketleri
    20260816...weekly_picks_cron.sql       # pg_cron + pg_net + Vault yardımcıları
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
| `/dashboard` | `Dashboard` | Panel — Keşifler sekmesi (günlük keşif + haftalık seçki kartları) |
| `/dashboard/reports` | `DashboardReports` | Panel — Raporlar sekmesi |
| `/dashboard/list` | `MyList` | Panel — Listem sekmesi (Bekleyenler / Bitirdiklerim) |
| `/account` | `Account` | Panel — Hesabım sekmesi: paket + tercihler (seçki opt-out, platform) |
| `/settings` | — | Eski tercih rotası; `/account`'a yönlenir (silinmedi, BUG-01 dersi) |
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

## Veri akışı: haftalık dizi & film seçkisi
**Otomatik.** Üretim ve gönderim AYRI fonksiyonlar ve bu bir arıza alanı ayrımı:
Claude kesintisi ya da erişilebilirlik API'sinin 429 fırtınası mail gönderimini
geciktirmemeli. Runbook: [`docs/weekly-picks.md`](docs/weekly-picks.md).

**İki yol var, ayrım pakete bağlı.** Platform filtresi PREMIUM özelliği:
ücretsiz pakette erişilebilirlik API'si **hiç çağrılmaz**, izleme linki JustWatch
**arama** linkidir (`justwatchSearchUrl` — slug tahmini değil, o yüzden 404 vermez).
Premium + platform seçiliyse movieofthenight çağrılır, link doğrulanmış servis deep
link'i olur ve filtre gerçekten uygulanır. Premium + "Tümü" de API'ye gerek duymaz:
**API yalnızca etkin bir filtre varsa çağrılır** — ücretli özellik ücretli API'yi
finanse eder.

**Üretim** — `generate-weekly-picks`, Cuma 09:00–11:55 İstanbul, parti parti:
1. `lens_weekly_pick_candidates` adayları verir: raporu olan **ve** opt-out olmayan
   **ve** o hafta satırı olmayan kullanıcılar. Opt-out kullanıcı aday listesine
   **hiç girmez** — token harcanmaz. Aynı RPC `platforms`'ı yalnızca premium'da
   döndürür (ücretsizde NULL) — plan kapısının TEK noktası burası.
2. Kullanıcı başına: profil tazele → son rapor → `lens_blocked_works` → `taste_profile`
   → Claude'dan N aday (`candidateCount`: filtresizde 5, dar filtrede 9).
3. **Yalnızca filtreli yolda** her aday movieofthenight'ta doğrulanır:
   `/shows/search/title?country=tr` **tek çağrıda** eseri ve `streamingOptions.tr[]`i
   verir. Güven kapısı (ad eşitliği VEYA ±1 yıl) geçilmezse aday DÜŞER. Link, seçilen
   teklifin kendi `link`'idir. Tahmin edilen URL yok.
4. Yasak küme `lens_work_keys` ile **kod tarafında** doğrulanır; ihlal eden aday düşer.
5. **Gevşetme merdiveni** (yalnızca filtreli yol) 3 öğe dolana kadar: platformda
   abonelik → ücretsiz → 2. Claude çağrısı → kiralık/ek kanal → filtre yok sayılır →
   eksik sayıyla gönder → satır yok.
6. `weekly_picks` insert (`status='draft'`, `ignoreDuplicates`).

**Gönderim** — `send-weekly-picks`, Cuma 17:00–18:55, 40 alıcı/tik:
7. Bayat satırları süpürür (7 gün → `overpast`), o haftanın `draft`'larını çeker,
   `user_preferences` kesişimiyle `weekly_picks_enabled = false` olanları **atlar**
   (satır yoksa varsayılan açık → gönderilir).
8. `email.ts` HTML + düz metin render eder, Resend'e yollanır. Başarı → `status='sent'`;
   hata → `status='failed'`, **döngü devam eder**.

Zamanlama pg_cron + pg_net; URL/anahtarlar **Vault'tan adıyla** okunur (git'e sır girmez).
Takvim yalnızca üç Vault sırrı varsa kurulur — lokalde iş kurulmaz. Türkiye kalıcı UTC+3,
`14:00 UTC == 17:00 İstanbul` her zaman. Üretim ile gönderim arasındaki ~8 saat
**veto penceresidir** (onay beklenmez; istemezsen o haftayı elle `overpast` yaparsın).

Her iki çağrı `x-weekly-picks-secret` ile korunur: `verify_jwt` tek başına yetmez, çünkü
oturumu olan herhangi bir kullanıcı fonksiyonu invoke edip tüm haftanın mailini attırabilirdi.

Gerekli secret'lar: `ANTHROPIC_API_KEY` (üretici) · `RESEND_API_KEY` (gönderen) ·
`WEEKLY_PICKS_SECRET`, `WEEKLY_PICKS_REPLY_TO`, `UNSUBSCRIBE_SECRET`.
Opsiyonel: `WATCH_API_KEY` (yalnızca premium platform filtresi için; yokken filtreli
kullanıcı ATLANIR, ücretsizler normal üretilir), `WEEKLY_PICKS_FROM`, `SITE_URL`,
`POSTHOG_KEY`, `POSTHOG_HOST`.

Maildeki "kapat" linki ayrı bir fonksiyondur (`unsubscribe`, `verify_jwt = false`):
imzalı HMAC token ile çalışır, **oturum istemez** ve `List-Unsubscribe-Post` (One-Click)
desteğini açar. Eskiden footer doğrudan tercih sayfasına gidiyordu ve o sayfa
oturumsuz kullanıcıyı `/login`'e attığı için telefonda gelen link sekiyordu.

## Veri akışı: estetik kimlik posteri
1. Poster **sunucuda** üretilir: `api/poster/[reportId].ts` (Story 1080×1920 / Feed 1080×1350)
   ve `api/og/[reportId].ts` (1200×630, link önizlemesi). Motor `satori` + `@resvg/resvg-js`,
   fontlar `api/_assets/fonts/` altından **lokal dosyadan** okunur — runtime'da ağ isteği yok.
2. Gizlilik kod ile değil **RLS ile** korunur: endpoint çağıranın JWT'si varsa onunla, yoksa
   anon anahtarıyla client kurar; kararı veritabanı verir. `SUPABASE_SERVICE_ROLE_KEY` Vercel
   ortamına **konmaz**. Erişilemeyen rapor → poster'da boş gövdeli 404 (varlığı bile sızmaz),
   OG'de jenerik marka görseli.
3. İstemci posteri `<img src>` ile değil `fetch` + `Authorization` ile çeker. Dönen Blob üç işi
   görür: önizleme, `navigator.share({files})`, indirme. Tek istek, üç kullanım.
4. Paylaşım/indirme/kopyalama aksiyonlarının **tamamı** gizlilik kapısından geçer
   (`PosterShare` içindeki onay diyaloğu). Onay olmadan `is_public` asla true olmaz.
   Geçiş anı `reports.public_since`'e **trigger ile** damgalanır — client yazamaz.
5. Link önizlemesi: `vercel.json` yalnızca bilinen sosyal crawler'ların User-Agent'ını
   `api/report-preview.ts`'e yönlendirir. Gerçek kullanıcı ve Googlebot her zamanki SPA'yı alır.

## Veri akışı: geri bildirim ve öneri motoru (US-05)
1. Keşif kartında üç seçenek var: **İlgimi çekti** (rezonans, listeye ekler) · **İlgimi çekmedi**
   (rezonans, opsiyonel neden) · **Bunu biliyorum** (zevk, opsiyonel Sevdim/Sevmedim/Kararsızım).
   Alt sorular buton satırının **yerine** gelir — altına eklenmez, popover açılmaz.
2. Her dokunuş `record_feedback` RPC'sine gider. Sinyal tipi ve ağırlık **sunucuda karardan
   türetilir**; client ağırlık göndermez. Alt soru yanıtı `retract_feedback` + yeni kayıt olarak
   uygulanır (aynı sinyalin tamamlanması, yeni bir çelişki değil).
3. "İlgimi çekti" → `list_items`'a satır. Listede "Okudum/İzledim/Dinledim" → "İsabet miydi?" →
   5× kalibrasyon sinyali; öğe silinmez, rozetle Bitirdiklerim'e geçer.
4. Biriken sinyaller `taste_profile`'a indirgenir (ton / popülerlik / dönem eksenleri + tür
   ağırlıkları). Ücretsizde **haftalık** (`lens_refresh_profile_if_due`, cron yok — haftanın ilk
   keşfi tetikler), premiumda **her geri bildirimde**. Hafıza penceresi 30 gün / sınırsız.
5. `daily-discovery` üç şeyi birleştirir: yasak küme (`lens_blocked_works`), profil eksenleri ve
   son rapor. Dönen öneri yasak kümeyle **deterministik doğrulanır**; ihlalde bir kez daha
   denenir, yine ihlal varsa loglanır ve yine de sunulur (boş kart göstermek daha kötü).

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
- Tek satırlık girişte ayıraç yoksa **tamamı `creator`'a** yazılır (`entryFromText`), yani
  `title` boş gelen sinyalin eser mi kişi mi olduğunu **bilmiyoruz**. Bu yüzden `formatSignal`
  "yön. " önekini yalnızca **başlık da varken** koyar: koşulsuzken prompt'a `yön. Asmalı Konak`
  düşüyordu ve modele olmayan bir yönetmen olgu diye dayatılıyordu. Belirsizliği prompt'ta
  belirsiz bırak — tahminimizi gerçek gibi sunma. Aynı sebeple `reports.films[].director` ve
  `user_works.creator` bugün eser adı taşıyabilir; bu kolonlara "kesin yaratıcı" muamelesi yapma.
- Haftalık seçki maili **görselsiz** kalır (afiş/poster yok) ve **link tavanı 5**:
  3 izleme linki + 1 panel (geri bildirim) + 1 kapatma. Bu bir deliverability kararı
  (Gmail Promotions riski), estetik tercih değil. Yeni link eklenecekse biri çıkar —
  erişilebilirlik künyesi bu yüzden mailde değil Ayarlar'daki platform kartının altında.
- `send-weekly-picks` film **seçmez**; tek işi göndermektir. Kürasyon
  `generate-weekly-picks`'te. Bu ayrımı birleştirme dürtüsüne kapılma: Claude/erişilebilirlik
  arızası mail gönderimini bloklamamalı ve `RESEND_API_KEY` üreticinin ortamına girmemeli.
- Seçkideki izleme linki **asla elle kurulmaz**. `justwatch.com/tr/film/<slug>` tahmini
  sık sık kırık çıkıyordu ve 7 Ağustos 2026 seçkisinde üç filmin de "Nerede izlenir"
  satırı bu yüzden kayboldu. İki meşru kaynak var: sağlayıcının döndürdüğü servis
  linki (`streamingOptions.tr[].link`, filtreli yol) ve JustWatch **arama** URL'i
  (`justwatchSearchUrl`, filtresiz yol). Eşleşme güven kapısını geçmezse aday
  **düşer** — yanlış link, eksik linkten kesinlikle kötüdür.
- Güven kapısında **yıl hakemdir**, ad değil: iki yıl da biliniyorsa `|fark| <= 1`
  ŞART ve ad eşitliği tek başına YETMEZ. TMDB'deki "ad VEYA yıl" kuralını geri
  getirme — o kural, TMDB aramasının `year` parametresiyle sonucu zaten daralttığı
  için çalışıyordu. Bu API'de öyle bir parametre yok: kural birebir taşındığında
  2019 "Chernobyl" mini dizisi yerine 2024 yapımı başka bir "Chernobyl" filmi
  yalnızca ad eşitliğiyle kapıdan geçti (canlı probe, 16 Ağustos 2026).
- Erişilebilirlik sağlayıcısı **movieofthenight**, TMDB DEĞİL (2026-08-16'da terk
  edildi: ticari kullanım $149/ay ve premium paketimiz var, "kişisel kullanım" beyanı
  yanlış beyan olurdu). Künye **zorunlu** ve Ayarlar'da duruyor; yalnızca filtre
  gerçekten uygulanırken gösteriliyor, çünkü ücretsiz yolda o veri hiç çekilmiyor.
- `user_preferences.platforms`'ta **NULL = "Tümü"; boş dizi YASAK** (CHECK).
  `'{}'` "hiçbir platform kabul değil" demek ve kullanıcı sessizce sıfır öneri alır.
  `array_length('{}',1)` **NULL** döndüğü için CHECK'te `COALESCE` şart — bu ilk
  yazımda atlandı ve boş dizi kısıttan geçti.
- Platform filtresi **premium**, ve zorlama **tek noktada**:
  `lens_weekly_pick_candidates` ücretsiz pakette `platforms`'ı NULL döndürür. Yazma
  tarafına (`setPlatforms`, RLS, trigger) ikinci bir kapı KOYMA: premium'dan düşen
  kullanıcı tercihini kaybetmemeli, iki kapı da zamanla ayrışır. Ayarlar'daki kilit
  bir güvenlik sınırı değil, anlatım.
- `watch_providers.service_id` **NULL ise o platform Ayarlar'da gösterilmez**:
  filtreleyemeyeceğimiz bir platformu teklif etmek tutamayacağımız bir sözdür
  (kullanıcı seçer, hiçbir şey değişmez, sebebini de göremez). Yeni bir slug'ın
  service_id'sini tahminle doldurma — `mode: "services"` çıktısıyla doğrula.
- Mailin "kapat" linki tercih sayfasına **bakmaz**; imzalı `unsubscribe` fonksiyonuna
  bakar. `/account` panel kabuğunda ve oturumsuz kullanıcıyı `/login`'e atıyor, yani
  telefonda gelen link sekiyordu — ve kapatamayan kullanıcı spam işaretliyor. `config.toml`'da
  `verify_jwt = false` **yalnızca** bu fonksiyon için; çıplak `[functions]` bloğu
  beşinin korumasını birden kaldırır.
- Haftası geçmiş seçki **gönderilmez** (`overpast`). Opt-out'tan dönen kullanıcı yalnızca
  tercihini açtıktan sonraki haftaları alır — birikmiş seçkiler toplu halde gitmez.
  Geri-doldurma yalnızca açık `allow_overpast: true` bayrağıyla mümkün.
- PostHog'da edinim yolu `source` property'siyle ve `user_works.source` sözlüğüyle gider
  (`screenshot` | `paste` | `manual` | `form`); şemsiye bir `import` değeri **YOK**. Event'e düşen
  değer kütüphaneye yazılanla aynı değişkenden türer (`captureSourcePath`, ImportFlow'da `flowSource`) —
  event için ayrı bir kaynak hesaplaması açma, ikisi ayrışır.
- Üç sinyal tipi **asla eşit işlenmez**: rezonans 1×, zevk 3×, kalibrasyon 5×. Rezonans tüketim
  ÖNCESİ verilir — kullanıcı kartta yazan gerekçenin ikna gücünü oylar, eseri değil. Eşitlersen
  motor "daha isabetli eser seçmeyi" değil "daha ikna edici blurb yazmayı" öğrenir.
  **Ağırlık** (güven kütlesi) ile **valans** (yön/şiddet) ayrı: `partial` tam 5× kütle sayar ama
  ekseni `hit`in yarısı kadar çeker; `known_neutral` kütle katar, ekseni oynatmaz.
- Çakışan sinyal **üzerine yazılmaz**. `work_key` başına tek aktif satır tutulur, aşılan satır
  `superseded_by` ile işaretlenir ama **durur** — "ilgimi çekti → bitirdim → isabet değildi"
  zinciri motorun kendi öngörü hatasını görebildiği tek veridir. Eşit ağırlıkta da eskisi kapanır
  (yoksa aynı eser iki kanaldan gelip eksene çift katkı verir). Geri alma sonrası invaryant
  `retract_feedback` içinde **yeniden kurulur** — sadece `superseded_by`'ı NULL'lamak yetmez.
- `mood_mismatch` eseri **elemez, 60 gün erteler**. `genre_mismatch` ise **bayatlamaz** — tür reddi
  ilk izlenim değil, kalıcı tercih beyanıdır. Diğer rezonans sinyalleri 90 günde yarılanır ve yaş
  **tam gün** olarak alınır: saniye çözünürlüğünde 5 taze sinyal 4.9999999954'te kalıp eşiği
  geçemiyordu.
- Eşik **5 ağırlıklı sinyal**; altında profil yazılmaz (sayaçlar yine tazelenir ki karttaki
  "N geri bildirim daha" ilerlesin). Ücretsizde ilk hesaplama eşik dolar dolmaz **anında** yapılır;
  koşul `axes IS NULL`, satır yokluğu değil — eşik altı çağrılar satırı zaten açıyor.
- `lens_work_key` iki tabloda da **GENERATED kolon**; normalizasyonu client'a ya da Deno'ya
  kopyalama. `translate` haritasındaki noktasız **`I`** zorunlu: Türkçe collation'da `lower('I')='ı'`
  ve "Into the Wild" → `ntothewild` olur, filtre sessizce delinir.
- `public` şemadaki IMMUTABLE olmayan bir fonksiyondan **EXECUTE yetkisi geri alma** — PG 17.6'da
  izin reddi backend'i segfault ettiriyor ve fonksiyonlar PostgREST'e açık. Koruma yetkiyle değil
  gövdedeki `auth.uid()` denetimiyle; gizlenmesi gerekenler `lens_private` şemasında.
  Ayrıntı ve kanıt: [`docs/schema.md`](docs/schema.md).
- **Bilinen ölçekleme borcu:** premium'da `record_feedback` her dokunuşta tüm sinyal geçmişini
  tarar (pencere sınırsız). Bugünkü hacimde sorun değil; birkaç yüz satırdan sonra gecikme
  kullanıcının tıklamasına yansır ve geri bildirim vermeyi caydırarak tam da toplamak istediğimiz
  veriyi azaltır. Yavaşlama görülürse artımlı toplama ya da kuyruğa alma — sürpriz değil, planlı borç.
- Posterde **film grain YOK** ve bu ölçülmüş bir karar: grain her pikseli oynattığı için PNG
  sıkıştırmasını kırıyor (Story 373 KB → 2273 KB, OG 155 KB → 900 KB). OG'de zaten taşınamazdı,
  WhatsApp o boyutta bir `og:image`'ı açmıyor. Bedeli: grain dither de yapıyordu, koyu
  gradyanlarda hafif bant görülebilir. Bant şikâyeti gelirse çözüm grain değil, glow duraklarını
  çoğaltmak. Ayrıntı: `api/_lib/poster.ts` başındaki not.
- Posterdeki her büyük harf `toLocaleUpperCase("tr-TR")` ile üretilir ve `contrasts[].poster`
  üreticiden **küçük harfle** istenir. Model Türkçe I/İ ayrımını tutturamıyor ("metin" yerine
  "METIN" yazıyor); büyük harfe çevirmeyi modele bırakma.
- `⟷` (U+27F7) Playfair'de de Inter'de de **yok**. Metin olarak yazma — SVG path olarak çiziliyor.
- `api/` içindeki yerel importlar **`.js` uzantısıyla** yazılır (`from "./_lib/render.js"`),
  dosya `.ts` olsa bile. Vercel her fonksiyonu ayrı ayrı `.js`'e derliyor ama import yolundaki
  uzantıyı yeniden yazmıyor: kaynakta `.ts` yazarsan derlenmiş çıktıda da `.ts` kalır ve
  production'da `ERR_MODULE_NOT_FOUND` → 500 olur. Bu bir kez canlıya böyle çıktı.
  `scripts/` altındaki araçlar aynı modülleri kullanabilsin diye `scripts/_ts-resolve.mjs`
  hook'u var; poster script'lerini `npm run poster:samples` / `poster:real` ile çalıştır,
  düz `node scripts/...` ile değil.
- `hero.archetype` **her zaman düz string**. Üretici prompt'u `{full, qualifier, core}` nesnesi
  ister, `analyze` insert öncesi düzleştirir (`normalizeArchetype`). Nesne olarak saklama:
  dokuz frontend noktası ve `daily-discovery`'nin prompt'u onu string okuyor.
- `ANTHROPIC_API_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` **sadece edge function ortamında** yaşar. Client koduna asla import edilmez.
- Canlıyı besleyen Vercel projesi **`lens-web-9a4e`**; panodaki `lens-web` eski ve boş bir
  kayıt. `.vercel/project.json` yanlış projeye bağlıysa `npx vercel --prod` "başarılı" der ve
  canlıda hiçbir şey değişmez. CLI ile deploy etmeden önce kontrol et — ayrıntı:
  [`docs/gelistirme.md`](docs/gelistirme.md).
- `.env.local`'a dokunma. Yeni env değişkeni eklenecekse `.env.example`'a belgele.
- Rota `/report/:id` — eski `/rapor/:id` kaldırıldı (BUG-01). Rota dili İngilizce.
- `/start`, `Welcome` ile birlikte yeni düz koyu görsel dili kullanır (`--lens-*` tokenları,
  `src/styles/theme.css`). Rapor ve panel gradyan dilinde kalır — geçişteki kontrast kasıtlı.
- `is_public = false` olan rapor **asla** auth'suz endpoint'ten dönmemeli. `fetchReport()` içindeki RLS sorgusunu bozmadan koru.
- `src/app/supabase.ts` ve `src/app/types.ts` deprecated — bunlara yeni kod yazma, `src/lib/` kullan.

## Şema
Tablo kolonları, JSONB yapıları ve RLS kuralları için bkz. [`docs/schema.md`](docs/schema.md).
Haftalık seçki kurulumu, gönderim komutu ve doğrulama testleri: [`docs/weekly-picks.md`](docs/weekly-picks.md).
