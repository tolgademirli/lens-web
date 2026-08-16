# Haftalık Dizi & Film Seçkisi — Runbook

Her Cuma sistem seçkiyi **kendisi üretir** ve **17:00'da** opt-in kullanıcılara
mail atar. Şema: [`schema.md`](schema.md) → `user_preferences`, `weekly_picks`,
`watch_providers`.

İki fonksiyon, iki iş — ve bu ayrım **bilinçli**:

| Fonksiyon | İşi | Ortamındaki anahtarlar |
|---|---|---|
| `generate-weekly-picks` | Seçkiyi ÜRETİR (Claude [+ erişilebilirlik]), `draft` satır yazar | `ANTHROPIC_API_KEY`, `WATCH_API_KEY` (ops.) |
| `send-weekly-picks` | Yalnızca GÖNDERİR. Film seçmez, Claude çağırmaz | `RESEND_API_KEY` |
| `unsubscribe` | Maildeki tek-dokunuş kapatma linki (JWT'siz) | `UNSUBSCRIBE_SECRET` |

Claude kesintisi ya da erişilebilirlik API'sinin 429 fırtınası mail gönderimini
**geciktirmemeli**; bu yüzden ayrı fonksiyonlar ve ayrı secret setleri.

### İki üretim yolu — ayrım pakete bağlı

| | Ücretsiz (bugün herkes) | Premium + platform seçili |
|---|---|---|
| Erişilebilirlik API'si | **çağrılmaz** | çağrılır (aday başına 1 istek) |
| İzleme linki | JustWatch **arama** linki | servise **doğrudan** deep link |
| Platform filtresi | yok | var (gevşetme merdiveni işler) |
| Mailde platform öneki | yok | `Netflix ·`, `Ücretsiz ·`, … |
| Aylık ek maliyet | $0 | kotadan 1 istek/aday |

**Premium + "Tümü"** de ücretsiz yol gibi davranır: zorlanacak filtre yoksa API'ye
gerek de yok. Kural tek cümle: **API yalnızca etkin bir platform filtresi varsa
çağrılır.**

### Filtrelenebilen platformlar (doğrulandı: 16 Ağustos 2026)

Sağlayıcının **Türkiye'de tanıdığı servislerin tamamı**: `netflix` · `prime` ·
`disney` · `hbo` · `mubi` · `curiosity` · `crunchyroll` · `zee5`.

Yani Ayarlar'da **Netflix, Prime Video, Disney+, HBO Max, MUBI** görünür.
**Apple TV+ görünmez** — Türkiye'de gerçekten var olan bir platform ama sağlayıcının
TR kataloğunda karşılığı yok, dolayısıyla filtreleyemiyoruz ve teklif de etmiyoruz.
BluTV / Exxen / Gain / tabii / TOD / YouTube Premium için de karşılık yok; satırları
`service_id IS NULL` ile duruyor, sağlayıcı eklerse tek UPDATE ile açılır.
`curiosity` / `crunchyroll` / `zee5` sözlüğümüzde yok — eklemek bir ürün kararı. Zorlama tek noktada — `lens_weekly_pick_candidates`, `plan <> 'premium'`
ise `platforms`'ı NULL döndürür. Üreticinin yanlış yapma imkânı yok; premium'dan
düşen kullanıcı da otomatik olarak doğru davranır (tercihi tabloda durmaya devam eder).

> **Künye (zorunlu).** Erişilebilirlik verisi *Streaming Availability API by Movie
> of the Night* tarafından sağlanıyor; künye **Ayarlar'daki platform kartının
> altında** duruyor ve `https://www.movieofthenight.com/about/api` adresine link
> veriyor. Maile konmadı: link tavanı 5 ve dolu (ölçülmüş deliverability kararı).
> Künye ücretsiz yolda görünmez — orada o veri hiç çekilmiyor.
>
> TMDB **terk edildi** (2026-08-16): ticari kullanım $149/ay ve Lens'in premium
> paketi olduğu için "kişisel kullanım" beyanı yanlış beyan olurdu. Watchmode'un
> ücretsiz katmanı da ticari kullanıma kapalı.

---

## Bir kerelik kurulum

```bash
# 1) Migration'lar
npx supabase db push          # 20260815... (şema) ve 20260816... (cron)

# 2) Secret'lar
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
supabase secrets set WATCH_API_KEY=xxx                   # movieofthenight.com/about/api
                                                         # OPSİYONEL: yalnızca premium
                                                         # platform filtresi için gerekir
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set WEEKLY_PICKS_SECRET="$(openssl rand -hex 24)"
supabase secrets set WEEKLY_PICKS_REPLY_TO=tolga@gmail.com
supabase secrets set UNSUBSCRIBE_SECRET="$(openssl rand -hex 32)"
# opsiyonel
supabase secrets set WEEKLY_PICKS_FROM="Tolga <tolga@lensestetik.com>"
supabase secrets set SITE_URL=https://lensestetik.com
supabase secrets set POSTHOG_KEY=phc_xxx

# 3) Deploy
supabase functions deploy generate-weekly-picks
supabase functions deploy send-weekly-picks
supabase functions deploy unsubscribe

# 4) Servis id'lerini DOĞRULA (premium platform filtresini açmadan önce ŞART)
curl -X POST "$SUPABASE_URL/functions/v1/generate-weekly-picks" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
  -H "Content-Type: application/json" -d '{"mode":"services"}'
# -> "unknown_service_ids": [] BEKLENİR. Boş değilse o slug'ın service_id'si yanlış
#    ve o platformu seçen kullanıcının filtresi SESSİZCE boşalır.
# -> "unmapped_slugs" = service_id'si NULL olanlar; Ayarlar bunları göstermiyor.
#    Sağlayıcı bir servis eklerse tek UPDATE ile açılır:
#      update watch_providers set service_id = 'crunchyroll' where slug = 'crunchyroll';

# 5) Takvimi kur (Vault sırları + cron)
```
```sql
-- SQL Editor'de. Takvim SIRLAR VARSA kurulur; migration lokalde iş kurmaz.
select vault.create_secret('https://<ref>.supabase.co', 'lens_project_url');
select vault.create_secret('<service_role_key>',        'lens_service_role_key');
select vault.create_secret('<weekly_picks_secret>',     'lens_weekly_picks_secret');
select lens_private.install_weekly_cron();   -- fikirdeş, tekrar çağrılabilir
show timezone;                                -- UTC olmalı
```

**`UNSUBSCRIBE_SECRET` rotate EDİLMEZ:** değiştirirsen yayına çıkmış bütün kapatma
linkleri geçersiz olur ve kapatmak isteyen kullanıcı 403 görür.

---

## Otomatik akış (Cuma)

| Saat (İstanbul) | Cron (UTC) | İş |
|---|---|---|
| 09:00–11:55 | `*/5 6-8 * * 5` | **Üretim** — parti parti, 3 kullanıcı/tik (~108 kişi/hafta) |
| 12:00 | `0 9 * * 5` | **Özet** — sahibe rapor. Onay beklemez |
| 17:00–18:55 | `*/5 14-15 * * 5` | **Gönderim** — 40 alıcı/tik |

Türkiye kalıcı UTC+3 (yaz saati yok), yani `14:00 UTC == 17:00 İstanbul` **her zaman**.

Üretim ile gönderim arasındaki ~8 saat **veto penceresidir**. Bir haftayı iptal:

```sql
-- Bütün haftayı iptal
update weekly_picks set status='overpast' where week='2026-08-21' and status='draft';
-- Tek kişiyi iptal
update weekly_picks set status='overpast' where week='2026-08-21' and user_id='<uuid>';
```

### Kim aday olur
`lens_weekly_pick_candidates` üç koşulu birlikte arar:
1. En az bir raporu var (prompt rapora dayanıyor)
2. `weekly_picks_enabled` **false değil** (satırı olmayan kullanıcı varsayılan AÇIK)
3. O hafta için satırı **yok** (fikirdeşlik — yeniden çalıştırma sıfır token harcar)

Opt-out kullanıcı aday listesine **hiç girmez**: token harcanmaz, mail denenmez.

### Neye göre üretiliyor
`taste_profile` (eksenler + tür ağırlıkları) **ve** kullanıcının son raporu. Yasak
küme (`lens_blocked_works`) prompt'a girer, dönen adaylar ayrıca `lens_work_keys`
ile **kod tarafında** doğrulanır — ihlal eden aday düşer.

### Gevşetme merdiveni (yalnızca filtreli yol)
Platform filtresi darsa 3 öğe dolmayabilir. Sırayla:

| # | Basamak | Mailde görünen |
|---|---|---|
| 0 | Seçili platformda abonelikle (`subscription`) | `Netflix ·` |
| 1 | Seçili platformda ücretsiz (`free`, reklamlı dahil) | `Ücretsiz ·` |
| 2 | İkinci Claude çağrısı (sert tavan: 2) | — |
| 3 | Seçili platformda kiralık/satın alma/ek kanal | `Kiralık ·` / `… · ek kanal` |
| 4 | Filtre yok sayılır | `Seçtiklerinin dışında ·` |
| 5 | Hâlâ eksik → 2 (ya da 1) öğeyle gönderilir | mail sayıyı kendi söyler |
| 6 | Hiç yok → **satır yazılmaz** | mail gitmez |

`addon` (örn. Prime Video üzerinden MUBI) 0. değil **3. basamakta**: kullanıcının o
platforma abone olması onu izleyebildiği anlamına gelmiyor, ek bir abonelik gerekiyor.

**İki durum hiç gevşetilmez, aday düşer:** eşleşme güven kapısını geçmezse — hangi
esere link verdiğimizi bilmiyoruz — ve eser TR'de hiçbir yerde izlenemiyorsa.
Yanlış link, eksik linkten kesinlikle kötüdür.

**Güven kapısı: yıl hakemdir.** Sorgu zaten ADA göre yapıldığı için dönen satır ad
olarak hep yakın; ayırt edici olan yıl. İki yıl da biliniyorsa `|fark| <= 1` **şart**
(ad eşitliği tek başına yetmez); sağlayıcıda yıl yoksa ad eşitliğine düşülür.
TMDB dönemindeki "ad VEYA yıl" kuralı burada YETMİYOR, çünkü bu API aramada `year`
parametresi kabul etmiyor: 2019 "Chernobyl" mini dizisi sorulduğunda 2024 yapımı
başka bir "Chernobyl" filmi yalnızca ad eşitliğiyle kapıdan geçti (canlı probe,
16 Ağustos 2026). Bedeli bilinçli: Claude'un yılı 2+ sene yanlışsa doğru eser de düşer.

**Ücretsiz yolda merdiven yok:** filtre olmadığı için her aday 0. basamakta ve
`watch_url` bir JustWatch arama linki. Arama linki bir tahmin değil (slug kurmuyoruz),
o yüzden 404 vermez; karşılığında eserin TR'de izlenip izlenemediğini de bilmiyoruz
ve mailde iddia etmiyoruz — platform öneki hiç yazılmaz.

---

## Doğrulama / test

### Kuru çalıştırma (mail GİTMEZ, satır YAZILMAZ)
Üretici Resend'e hiç dokunmaz — kuru çalıştırma bayrakla değil **yapısal** olarak güvenli.
```bash
curl -X POST "$SUPABASE_URL/functions/v1/generate-weekly-picks" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"week":"2026-08-21","only_user_id":"<uuid>","dry_run":true}'
```
Yanıtta `films`, `relaxations`, `claude_calls`, `watch_calls`, `filtered` gelir.
`filtered: false` = ücretsiz yol (API çağrılmadı). **Blurb'ları oku** — bu aynı
zamanda prompt kalite döngüsü.

### Erişilebilirliği Claude'suz dene
```bash
-d '{"mode":"services"}'    # TR servisleri + yanlış/eksik service_id'ler
-d '{"mode":"probe","titles":[
      {"title":"Chungking Express","title_en":"Chungking Express","year":1994,"media_type":"movie"},
      {"title":"Fargo","title_en":"Fargo","year":2014,"media_type":"tv"}]}'
```
**Dönen her linki tarayıcıda aç** — hem `options[].link` (premium yolun deep link'i)
hem `free_path_url` (ücretsiz yolun arama linki). Bütün entegrasyonun var olma sebebi
bu test. Zor vaka koy: Türkçe adlı yabancı film, `movie` diye etiketlenmiş mini dizi.

### Platform filtresi
Filtre **yalnızca premium'da** uygulanır; testten önce paketi aç:
```sql
update user_preferences set plan = 'premium' where user_id='<sen>';  -- service_role ile
update user_preferences set platforms = null        where user_id='<sen>'; -- Tümü (API çağrılmaz)
update user_preferences set platforms = '{netflix}' where user_id='<sen>';
update user_preferences set platforms = '{mubi}'    where user_id='<sen>'; -- kasten dar
```
`{netflix}` ile **her** öğenin `providers`'ı `netflix` içermeli — asıl doğruluk iddiası bu.
`{mubi}` ile `relaxations` hangi basamakların kullanıldığını söylemeli.

Paketi `free`'ye geri alıp aynı kullanıcıyı tekrar çalıştır: `filtered` **false**,
`watch_calls` **0**, `watch_url` bir `justwatch.com/tr/arama?q=…` linki olmalı.
`platforms` satırı tabloda **durmalı** (tercih kaybolmaz, sadece uygulanmaz).

Geçersiz durumlar imkânsız olmalı:
```sql
update user_preferences set platforms = '{}'        where user_id='<sen>'; -- CHECK ihlali
update user_preferences set platforms = '{netflex}' where user_id='<sen>'; -- trigger patlar
```

### Kapatma linki — dördü de zorunlu
1. **Oturumsuz GET** (gizli pencere): sayfa açılmalı, `weekly_picks_enabled` false olmalı.
   *Oturum açıkken denemek hiçbir şeyi test etmez — hata tam olarak oturumsuz yol.*
2. **One-Click POST:**
   `curl -i -X POST "<url>" -H "Content-Type: application/x-www-form-urlencoded" --data "List-Unsubscribe=One-Click"`
   → 200, boş gövde.
3. **Kurcalama:** token'ın bir karakterini değiştir → **403 ve YAZMA YOK**.
   Başka kullanıcının `u`'su + bu token → 403.
4. Gerçek bir gönderimde **Gmail'in listeden çıkarma düğmesini gösterdiğini** gör.

### Cron'u bir hafta beklemeden test
```sql
select cron.schedule('lens-tmp-test','* * * * *', $$select net.http_post(
  url := lens_private.fn_url('generate-weekly-picks'),
  headers := lens_private.fn_headers(),
  body := jsonb_build_object('mode','digest','week',
    to_char((now() at time zone 'Europe/Istanbul')::date,'YYYY-MM-DD')))$$);
-- 1-2 dakika sonra:
select status_code, content::text from net._http_response order by created desc limit 3;
select cron.unschedule('lens-tmp-test');
```
**Vault sırları girilmemişse her tik 403 alır ve pg_net hiçbir hata YÜKSELTMEZ** —
sessiz başarısızlık. `net._http_response` bunu görmenin tek yolu.

---

## Elle müdahale (kaçış kapıları)

Otomasyon devre dışıyken ya da bir haftayı elle kurmak için — **eski akış duruyor**:

```sql
insert into weekly_picks (user_id, week, films) values (
  '<uuid>', '2026-08-21',
  '[{"title":"Chungking Express","year":1994,"blurb":"...",
     "watch_url":"https://mubi.com/tr/films/chungking-express",
     "media_type":"movie","providers":["mubi"],"offer_type":"subscription",
     "tags":{"tone":0.1,"popularity":-0.3,"era":-0.4,"genre":"romantik"}}]'::jsonb
);
```
```bash
# limit gövdede YOKSA davranış eskisiyle birebir aynı: o haftanın tüm draft'ları
curl -X POST "$SUPABASE_URL/functions/v1/send-weekly-picks" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
  -H "Content-Type: application/json" -d '{"week":"2026-08-21"}'
```
`tags` olmadan da çalışır (v1 satır) — o satır yalnızca eksen ayarına katkı vermez.
Link alanı **`watch_url`**; eski satırlardaki `justwatch_url` da okunmaya devam eder
(okuma sırası `watch_url ?? justwatch_url`, hem mailde hem panelde).

Takvimi tamamen durdurmak:
```sql
select cron.unschedule(jobname) from cron.job where jobname like 'lens-%';
```

---

## Sınırlar (bilinçli)

- **Mailde görsel YOK** (afiş/poster). Harici resim Gmail'de Promotions riskini artırır.
- **Link tavanı 5:** 3 izleme linki + 1 panel + 1 kapatma. Yeni link eklenecekse biri
  çıkar — erişilebilirlik künyesi bu yüzden mailde değil Ayarlar'da.
- **Ücretsiz yolda eserin TR'de izlenebilirliği doğrulanmıyor.** Arama linki kırık
  olmaz ama sonuç boş çıkabilir. Bedeli bilerek kabul edildi: alternatif, her
  ücretsiz kullanıcı için ücretli API kotası harcamaktı.
- **Haftası geçmiş seçki gönderilmez** (`overpast`, 7 gün). Opt-out'tan dönen kullanıcı
  birikmiş seçkileri toplu almaz; geri-doldurma yalnızca `allow_overpast: true` ile.
- **Kullanıcı başına en fazla 2 Claude çağrısı.** Maliyet patlamasına kapalı kapı.
- **Çakışan cron tikleri engellenmiyor** (pg_cron bunu yapmaz). 5 dakika aralık vs
  ~60s parti: olasılık düşük, ve fikirdeşlik katmanları bunu doğruluk değil token
  maliyetine çeviriyor. Planlı borç.
- **Geri bildirimi olan satırın `films` dizisi yeniden yazılmaz.** Slot bağlaması dizi
  indeksi; sıralamayı değiştirmek geçmiş sinyalleri yanlış eserlere atar.

## Maliyet

`claude-sonnet-4-6` ($3/$15 per MTok): kullanıcı başına ~2.700 girdi + ~850 çıktı
token ≈ **$0,021/çağrı**, ×1,2 efektif çağrı ≈ **$0,11/kullanıcı/ay**.
10 kullanıcı ≈ $1, 100 ≈ $11, 1.000 ≈ $109. Opt-out kullanıcı **$0** (aday değil).

Erişilebilirlik API'si (movieofthenight): ücretsiz katman **1.000 istek/ay**, ticari
kullanıma açık. Aday başına 1 istek, kullanıcı başına ~9 aday, 4 hafta → **~36
istek/ay/premium kullanıcı**, yani ücretsiz katman ≈ **27 premium kullanıcıya** kadar
$0. Sonrası $49/ay (25.000 istek). Ücretsiz paketteki kullanıcı bu kotadan **hiç**
harcamaz — API onlar için çağrılmıyor.

Maliyet gerçekten sorun olursa ilk kaldıraç **Batch API** (%50 indirim, üretim
asenkron ve gecikmeye duyarsız): 1.000 kullanıcıda ~$55/ay. Prompt caching atlandı —
paylaşılan önek Sonnet 4.6'nın 1.024 token cache minimumunun hemen üstünde, kazanç
yazma primini karşılamıyor.
