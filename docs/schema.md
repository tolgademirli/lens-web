# Veritabanı Şeması

Supabase Postgres. Şema değişikliklerini `supabase/migrations/` altında migration olarak ekle.

---

## `reports`

Claude API tarafından üretilen estetik kimlik raporları. `analyze` edge function her çağrıda bir satır insert eder.

| Kolon             | Tip          | Notlar |
|-------------------|--------------|--------|
| `id`              | UUID PK      | gen_random_uuid() |
| `created_at`      | TIMESTAMPTZ  | default NOW() |
| `user_id`         | UUID         | nullable — `auth.users(id)`. Anonim rapor oluşturulabilir. |
| `telegram_user_id`| INTEGER      | nullable — bot kaynaklı raporlarda dolu, web'de null |
| `source`          | TEXT         | `"web"` \| `"telegram"` |
| `books`           | JSONB        | `[{title: string, author: string}]` — title boş olabilir (sadece yazar girilmişse) |
| `films`           | JSONB        | `[{title: string, director: string}]` |
| `songs`           | JSONB        | `[{title: string, artist: string}]` |
| `hero`            | JSONB        | `{archetype: string, archetype_qualifier?: string, archetype_core?: string, summary: string}` |
| `texture`         | JSONB        | `{descriptions: string[], colors: [{name, hex, description}]}` — tam 3 renk |
| `threads`         | JSONB        | `[{title: string, description: string}]` — 2-3 öğe |
| `contrasts`       | JSONB        | `[{left: ContrastSide, right: ContrastSide, explanation: {title, text}}]` — 1-2 öğe |
| `shadow`          | JSONB        | `[{type: "Kitap"\|"Film"\|"Müzik", title: string\|null, author_or_artist: string, year: string\|null, description: string}]` — tam 3 öğe |
| `is_public`       | BOOLEAN      | default false. true ise auth'suz okunabilir. |
| `public_since`    | TIMESTAMPTZ  | nullable. `is_public` false→true olduğunda **trigger** damgalar, true→false olduğunda NULL'lanır. Client yazamaz (`lens_touch_public_since` gönderilen değeri ezer). |

> **`hero.archetype` her zaman DÜZ STRING'dir.** Üretici prompt'u onu
> `{full, qualifier, core}` nesnesi olarak ister ama `analyze` insert'ten önce
> düzleştirir (`normalizeArchetype`). Nesne olarak saklanamaz: dokuz frontend
> noktası ve `daily-discovery`'nin kendi Claude prompt'u onu string olarak
> okuyor, nesne yazılsa orada sessizce `[object Object]` oluşurdu.
> `archetype_qualifier` / `archetype_core` yalnızca posterdeki iki katmanlı
> başlık için var ve **yalnızca 2026-08-13'ten sonraki raporlarda dolu**;
> ikisi de boşsa poster tek katmana düşer. `ContrastSide.poster` da aynı
> şekilde opsiyoneldir (posterdeki tek kelimelik kutup etiketi).

> **`is_public` varsayılanı yazıcılar tarafından hiç kullanılmıyor.** Her iki insert yolu da değeri açıkça veriyor: `analyze` edge function `false`, lens bot `true` (`bot.py`). Yani Telegram kaynaklı raporlar **herkese açık doğar** — bu bir ürün kararı, varsayılanın yan etkisi değil. Varsayılan yalnızca ileride `is_public` vermeyi unutan bir insert yolu eklenirse devreye girer.

**RLS:** `is_public = true` olan raporlar herkese açık. Özel raporlar yalnızca `auth.uid() = user_id` koşuluyla okunabilir. Bkz. `src/lib/supabase.ts → fetchReport`.

Politikalar: iki SELECT (herkese açık raporlar / kendi raporları) + bir UPDATE (kendi raporu). INSERT ve DELETE policy'si **yok** — yazma yalnızca `service_role_key` ile edge function'dan yapılır.

---

## `user_works`

Kullanıcının eser havuzu. Edinim yolu ne olursa olsun (ekran görüntüsü, yapıştırma, manuel, eski form) **her eser** buraya yazılır — üst sınır yok. Rapora giren eser sayısı bounded'dır (kategori başına 3–8), havuz değil.

| Kolon              | Tip          | Notlar |
|--------------------|--------------|--------|
| `id`               | UUID PK      | gen_random_uuid() |
| `user_id`          | UUID         | nullable — `auth.users(id)`. Anonim akış için null; login sonrası sahiplenilir. |
| `telegram_user_id` | BIGINT       | nullable — bot kaynaklı edinim |
| `type`             | TEXT         | `"book"` \| `"film"` \| `"song"` (CHECK) |
| `creator`          | TEXT         | nullable — yazar / yönetmen / sanatçı |
| `title`            | TEXT         | nullable — çoğu zaman boş |
| `source`           | TEXT         | `"screenshot"` \| `"paste"` \| `"manual"` \| `"form"` (CHECK). `manual` ve `paste` **ayrı** tutulur; edinim analitiği buna bağlı. |
| `batch_id`         | UUID         | nullable — tek çıkarım işleminden gelen eserleri gruplar |
| `confidence`       | TEXT         | nullable — `"high"` \| `"medium"` \| `"low"`. Vision per-item güven sinyali; manuel girişte null. |
| `deleted_at`       | TIMESTAMPTZ  | nullable — soft delete. Dolu satırlar havuz listelemesinde gizlenir, provenance korunur. |
| `created_at`       | TIMESTAMPTZ  | default NOW() |

**Kısıt:** `CHECK (creator IS NOT NULL OR title IS NOT NULL)` — satır üç biçimde gelebilir (yalnız yaratıcı / yalnız eser / ikisi), ama tamamen boş olamaz.

**RLS:** Kullanıcı yalnızca kendi satırlarını görür/yazar/günceller/siler (`auth.uid() = user_id`). `user_id` null olan satırlar hiçbir client'a görünmez — yalnızca `service_role_key` erişir.

---

## `report_works`

Bir raporun hangi havuz kayıtlarından üretildiği (provenance). **Many-to-many** — aynı eser zaman içinde birden çok rapora girebilir; "havuzdan seçerek yeni rapor üret" özelliği buna dayanır.

| Kolon        | Tip          | Notlar |
|--------------|--------------|--------|
| `report_id`  | UUID         | `reports(id)` ON DELETE CASCADE — PK'nin parçası |
| `work_id`    | UUID         | `user_works(id)` ON DELETE CASCADE — PK'nin parçası |
| `created_at` | TIMESTAMPTZ  | default NOW() |

**Kısıt:** `PRIMARY KEY (report_id, work_id)`.  
**RLS:** Kullanıcı yalnızca kendi raporlarının bağlantılarını okuyabilir. Insert yalnızca `service_role_key` ile (edge function).

> **Geriye dönük uyumluluk:** `reports.books/films/songs` JSONB kolonları değişmedi ve raporun donmuş anlık görüntüsü olmaya devam ediyor. `report_works` yalnızca kökeni kaydeder — eski raporlarda bu tabloda satır yoktur, bu normaldir.

---

## `daily_discoveries`

Günlük keşif önerileri önbelleği. `daily-discovery` edge function, her kullanıcı–gün çifti için bir kez Claude çağırır; sonraki isteklerde cache'den döner.

| Kolon        | Tip          | Notlar |
|--------------|--------------|--------|
| `id`         | UUID PK      | gen_random_uuid() |
| `user_id`    | UUID NOT NULL| `auth.users(id)` |
| `date`       | DATE NOT NULL| Istanbul timezone (`Europe/Istanbul`) olarak hesaplanır |
| `report_id`  | UUID         | nullable — keşfi oluştururken baz alınan rapor |
| `book`       | TEXT NOT NULL| `"Kitap Adı - Yazar"` formatı |
| `film`       | TEXT NOT NULL| `"Film Adı - Yönetmen"` formatı |
| `music`      | TEXT NOT NULL| Sanatçı adı |
| `reasons`    | JSONB        | `{book: string, film: string, music: string}` — her öneri için max 12 kelime açıklama |
| `items`      | JSONB        | `[{slot, title, creator, reason, genre, tone, popularity, era}]` — nullable, eski satırlarda yok |
| `created_at` | TIMESTAMPTZ  | default NOW() |

> **`items` yeni kaynak, `book`/`film`/`music` ondan türetilir.** Eski TEXT kolonları
> (`"Başlık - Yaratıcı"`) değişmedi ve yazılmaya devam ediyor — Telegram botu ve eski
> satırlar okumayı sürdürsün diye. Client önce `items`'a bakar; yoksa eski string'i
> böler (yalnızca geriye dönük okuma yolu, `src/lib/discovery.ts → splitLegacy`).
>
> `tone` / `popularity` / `era` [-1, 1] aralığında normalize edilir
> (aydınlık→karanlık, niş→popüler, klasik→çağdaş), `genre` kısa bir tür etiketidir.
> Bu etiketler **eksen ayarının girdisidir**: "Fazla karanlık" tek başına yönü verir, ama
> olumlu bir sinyalin profili hangi yöne çekeceği ancak eserin kendi etiketlerinden okunur.

**Kısıt:** `UNIQUE(user_id, date)` — bir kullanıcı günde bir keşif alır.  
**RLS:** Kullanıcı yalnızca kendi satırlarını okuyabilir. Insert yalnızca `service_role_key` ile yapılır (edge function).

---

## `user_preferences`

Kullanıcının kendi tercihleri ve üyelik paketi.

| Kolon                  | Tip          | Notlar |
|------------------------|--------------|--------|
| `user_id`              | UUID PK      | `auth.users(id)` ON DELETE CASCADE |
| `weekly_picks_enabled` | BOOLEAN      | NOT NULL, default true |
| `plan`                 | TEXT         | NOT NULL, default `free`. `free` \| `premium` (CHECK) |
| `platforms`            | TEXT[]       | nullable, **DEFAULT YOK**. `watch_providers.slug` listesi. NULL = "Tümü". Yalnızca `plan = 'premium'` iken UYGULANIR |
| `updated_at`           | TIMESTAMPTZ  | NOT NULL, default NOW(); BEFORE UPDATE trigger'ı tazeler |

> **`platforms`: NULL = Tümü, BOŞ DİZİ YASAK.** `'{}'` "hiçbir platform kabul değil"
> demektir — filtre semantiğinin tam tersi — ve `platforms && adaylar` gibi her doğal
> dizi yüklemi `'{}'` için false döner, yani kullanıcı hiçbir hata görmeden her hafta
> **sıfır öneri** alırdı. CHECK bunu temsil edilemez yapıyor:
> `COALESCE(array_length(platforms,1),0) BETWEEN 1 AND 24 AND array_position(platforms,NULL) IS NULL`.
> `COALESCE` şart — `array_length('{}',1)` sıfır değil **NULL** döner ve CHECK NULL'ı geçirir.
> `'all'` gibi bir sentinel de kullanılmıyor: `{'all','netflix'}` geçersiz durumlar doğurur.
>
> Slug doğrulaması CHECK değil **trigger** (`guard_user_preferences_platforms`), çünkü
> sözlük `watch_providers` tablosunda yaşıyor. Bilinmeyen slug sessizce filtreyi boşaltır
> ve gevşetme merdiveni bunu gizler — yazım anında patlaması daha iyi.
>
> **Filtre PREMIUM özelliği ve zorlama TEK NOKTADA:**
> `lens_weekly_pick_candidates`, `plan <> 'premium'` olan kullanıcı için `platforms`'ı
> **NULL** döndürür. Değer tabloda durmaya devam eder — premium'dan düşen kullanıcı
> tercihini kaybetmez, yeniden abone olunca geri gelir. Yazma tarafına ikinci bir kapı
> KONMADI: iki kapı zamanla ayrışır ve düşen kullanıcı tercihini düzenleyemez hâle gelir.

> **`plan`'ı kullanıcı kendi değiştiremez.** RLS, kullanıcının kendi satırını UPDATE
> etmesine izin verir (toggle bunu gerektiriyor), dolayısıyla tek başına yeterli değildi:
> `guard_user_preferences_plan` BEFORE INSERT/UPDATE trigger'ı, çağıran rol `authenticated`
> ya da `anon` ise `plan` değişimini sessizce yutar (INSERT'te `free`'ye sabitler).
> `service_role`, `postgres` ve bakım rolleri yazabilir — ödeme akışı (US-08) buradan yazacak.
> Okuma tek noktadan: `src/lib/entitlements.ts → fetchPlan()`.

**Satırın yokluğu = varsayılan.** Kullanıcı ayara hiç dokunmadıysa burada satırı olmaz ve `weekly_picks_enabled = true` varsayılır. Satır ancak toggle'a ilk dokunuşta (upsert) doğar. Hem client (`src/lib/preferences.ts → DEFAULT_PREFERENCES`) hem gönderim fonksiyonu aynı varsayımı kullanır — birini değiştirirken diğerini de değiştir.

**RLS:** Kullanıcı yalnızca kendi satırını SELECT / INSERT / UPDATE edebilir (`auth.uid() = user_id`). DELETE policy'si yok — tercihi silmek anlamsız, kapatmak yeterli.

---

## `watch_providers`

Platform sözlüğü: bizim slug'ımız ↔ erişilebilirlik sağlayıcısının servis id'si.
Ayarlar ekranı ve `generate-weekly-picks` aynı tablodan okur — böylece UI, üretimin
**filtreleyemediği** bir platformu kullanıcıya asla teklif edemez.

| Kolon        | Tip      | Notlar |
|--------------|----------|--------|
| `slug`       | TEXT PK  | BİZİM kelime dağarcığımız (`netflix`, `mubi`). `user_preferences.platforms` bunu saklar |
| `label_tr`   | TEXT     | NOT NULL. Ayarlar ekranında ve mailde görünen ad |
| `service_id` | TEXT     | nullable. movieofthenight servis slug'ı (`netflix`, `prime`, `apple`…). NULL = karşılığı **henüz doğrulanmadı** |
| `sort_order` | INT      | NOT NULL default 100 |

**RLS:** herkes SELECT edebilir (Ayarlar ekranı gösteriyor). Yazma policy'si **yok** —
`service_id` SQL Editor'den elle doldurulur.

> **Runtime çözümleme YOK.** TMDB'de `provider_id` sayısaldı ve her ay tazelenmesi
> gerekiyordu; movieofthenight zaten slug döndürüyor, dolayısıyla `name_pattern` +
> `refreshed_at` katmanı gereksizleşti ve kaldırıldı.
>
> **`service_id IS NULL` olan satır Ayarlar'da GÖSTERİLMEZ** (`fetchPlatformOptions`
> filtreliyor). Filtreleyemeyeceğimiz bir platformu teklif etmek, kullanıcıya
> tutamayacağımız bir söz vermektir: seçer, hiçbir şey değişmez, sebebini de göremez.
> Doğrulama yolu `generate-weekly-picks` `mode: "services"` — TR'de tanınan servisleri
> döker ve yanlış seed'lenmiş id'leri (`unknown_service_ids`) adlandırır.
>
> **Bugün dolu olanlar** (16 Ağustos 2026'da canlı doğrulandı): `netflix`, `prime`,
> `disney`, `hbo`, `mubi`. Sağlayıcının TR'de tanıdığı servislerin tamamı bu beşe ek
> olarak `curiosity`, `crunchyroll`, `zee5` — sözlüğümüzde karşılıkları yok.
> **Apple TV+ dahil DEĞİL:** Türkiye'de var olan bir platform ama sağlayıcının TR
> kataloğunda yok, o yüzden `service_id` NULL ve Ayarlar'da görünmüyor.
>
> **Neden sağlayıcının id'si değil kendi slug'ımız saklanıyor:** sağlayıcı bir gün yine
> değişebilir (TMDB → movieofthenight geçişi tam olarak bu oldu). Kendi slug'ımızı
> saklamak, o gün değişen tek şeyin bu tablodaki `service_id` olmasını garantiler;
> kullanıcının tercihi sessizce bozulmaz.

---

## `weekly_picks`

Haftalık film **ve dizi** seçkileri. Kürasyonu `generate-weekly-picks` yapar (Claude,
premium'da + erişilebilirlik doğrulaması); `send-weekly-picks`'in tek işi bu satırları
göndermektir. Elle giriş kaçış kapısı olarak duruyor (bkz. [`weekly-picks.md`](weekly-picks.md)).

| Kolon           | Tip          | Notlar |
|-----------------|--------------|--------|
| `id`            | UUID PK      | gen_random_uuid() |
| `user_id`       | UUID NOT NULL| `auth.users(id)` ON DELETE CASCADE. `reports`'tan farklı olarak nullable **değil** — seçki kişiye özel küre edilir. |
| `week`          | DATE NOT NULL| O haftanın işareti (örn. gönderim Cuma'sı) |
| `films`         | JSONB NOT NULL| Öğe şeması v2 — aşağıya bak |
| `intro_variant` | TEXT         | `"standart"` \| `"sessiz"` (CHECK), default `standart`. Mail giriş paragrafını belirler. |
| `status`        | TEXT         | `"draft"` \| `"sent"` \| `"failed"` \| `"overpast"` (CHECK), default `draft` |
| `sent_at`       | TIMESTAMPTZ  | nullable — başarılı gönderimde dolar |
| `created_at`    | TIMESTAMPTZ  | NOT NULL, default NOW() |

### `films` öğe şeması (v2)

```jsonc
{
  "title": "Chungking Express", "year": 1994,
  "blurb": "Şehirde iki insanın birbirini ıskalaması, neon hızında.",
  "watch_url": "https://mubi.com/tr/films/chungking-express",
  "director": "Wong Kar-wai",

  // --- v2, HEPSİ OPSİYONEL (elle girilmiş eski satırlarda yok) ---
  "media_type": "movie",          // "movie" | "tv". Yoksa film varsayılır
  "show_id": "8195",              // sağlayıcının show id'si; yalnızca doğrulanmış satırda
  "providers": ["mubi"],          // watch_providers.slug listesi
  "offer_type": "subscription",   // subscription|free|buy|rent|addon|off_platform
  "tags": { "tone": 0.1, "popularity": -0.3, "era": -0.4, "genre": "romantik" }
}
```

**Link alanı iki isimli ve okuma sırası `watch_url ?? justwatch_url`:**
`watch_url` v2 (üretici yazar), `justwatch_url` v1 (elle girilmiş eski satırlar). Eski
satırlar YENİDEN YAZILMAZ — `films` dizisine dokunmak slot bağlamasını riske atar
(aşağıdaki uyarı). Okuyucuların hepsi iki alanı da biliyor: `email.ts → watchUrl()`,
`src/lib/discovery.ts → weeklyPickCards`.

`watch_url`'in **anlamı pakete göre değişir**: premium + platform filtresi varsa
sağlayıcıdan gelen **doğrulanmış servis deep link'i**, aksi halde bir JustWatch **arama**
linki. İkisi de tahmin DEĞİL — elle kurulan `justwatch.com/tr/film/<slug>` URL'leri sık
sık kırılıyordu (7 Ağustos 2026 seçkisinde üç filmin de "Nerede izlenir" satırı bu
yüzden kaybolmuştu). `providers`/`offer_type` yalnızca doğrulanmış yolda yazılır:
ücretsiz yolda o bilgiye sahip değiliz ve mailde iddia etmiyoruz.

`tags` **eksen ayarının girdisidir**, kullanıcıya gösterilmez.
`lens_private.lens_active_signals` bunu `films[slot]->'tags'` yolundan okur; v1
satırlarda `tags` olmadığı için o satırlar yalnızca neden tabanlı
(`too_dark`/`too_popular`) ayar yapar — **veri göçü gerekmez**.

> ⚠️ **SLOT BAĞLAMASI — geri bildirimi olan satırın `films` dizisi YENİDEN YAZILMAZ.**
> `discovery_feedback.slot`, dizinin **0-tabanlı indeksinin string hâli**
> (`src/lib/discovery.ts` → `slot: String(index)`), ve `lens_active_signals` bunu
> `(ord - 1)::TEXT = f.slot` ile eşliyor. Sıralamayı değiştirmek ya da diziyi yeniden
> yazmak, geçmiş **her sinyali sessizce başka bir esere** atar.

**Kısıt:** `UNIQUE(user_id, week)` — aynı kullanıcıya aynı hafta iki seçki girilemez. Çift mail, gönderim hatasından pahalı. Üretici bunu fikirdeşliğin son duvarı olarak kullanır (`ignoreDuplicates`).

**RLS:** Kullanıcı yalnızca kendi seçkilerini SELECT edebilir. INSERT/UPDATE/DELETE policy'si **bilerek yok** — yalnızca `service_role_key` yazar. Aksi halde kullanıcı kendi satırını `sent` işaretleyip gönderimi atlatabilirdi.

> **`overpast` = haftası geçti, artık gönderilmeyecek.** `send-weekly-picks` her çağrıda, haftası 7 günden fazla geçmiş tüm `draft` satırları bu duruma çeker. Opt-out yapan kullanıcının satırı o hafta içinde `draft` kalır (tercihini hemen geri açarsa seçki hâlâ gidebilir), sonra kapanır. Böylece Ağustos'ta kapatıp Ekim'de açan kullanıcı **yalnızca Ekim sonrası haftaları** alır; aradaki seçkiler birikip toplu halde gitmez. Bilinçli geri-doldurma için gönderim gövdesinde `allow_overpast: true` gerekir.

---

## `discovery_feedback`

Keşif kartlarına verilen sinyallerin **append-only** defteri (US-05). Üzerine yazılmaz.

| Kolon | Tip | Notlar |
|-------|-----|--------|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL | `auth.users(id)` ON DELETE CASCADE |
| `work_type` | TEXT | `book` \| `film` \| `song` (CHECK) — `user_works.type` ile aynı sözlük |
| `work_creator`, `work_title` | TEXT | En az biri dolu (CHECK). Öneri `user_works`'e **yazılmaz** |
| `work_key` | TEXT GENERATED STORED | `lens_work_key(work_type, work_creator, work_title)` |
| `decision` | TEXT | `interested`, `not_interested`, `known_liked`, `known_disliked`, `known_neutral`, `hit`, `partial`, `miss` (CHECK) |
| `signal_type` | TEXT | `resonance` \| `taste` \| `calibration` (CHECK) |
| `weight` | SMALLINT NOT NULL | 1 / 3 / 5. Sunucuda karardan türetilir, **saklanır** |
| `reason` | TEXT | `too_dark`, `too_popular`, `mood_mismatch`, `genre_mismatch` (CHECK), nullable |
| `defer_until` | TIMESTAMPTZ | Yalnız `mood_mismatch`: NOW() + 60 gün. Erteleme kuyruğu bu kolonun kendisi |
| `origin` | TEXT | `daily_discovery`, `weekly_pick`, `chat`, `onboarding` (CHECK) |
| `daily_discovery_id`, `weekly_pick_id` | UUID | **ON DELETE SET NULL** |
| `slot` | TEXT | `book`/`film`/`music` ya da seçkideki film indeksi |
| `superseded_by` | UUID | Kendine FK. Dolu = daha güçlü sinyalle aşıldı (**silinmiş değil**) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

**`ON DELETE SET NULL` bilinçli:** sinyal, onu doğuran kartı aşmalı. CASCADE olsaydı eski bir
keşif satırı temizlendiğinde motorun hafızası sessizce silinirdi.

**Çakışma — `work_key` başına tek aktif satır.** Yeni sinyal mevcut kazanandan güçlü ya da eşitse
tüm aktif satırları kapatır; zayıfsa kendisi aşılmış doğar. Eşitlik dahil olması şart: aynı eser
hem günlük keşiften hem seçkiden `interested` alırsa (ikisi de 1×) eksene çift katkı verirdi.
Aşılan satır **asla silinmez** — "ilgimi çekti → bitirdim → isabet değildi" zinciri motorun kendi
öngörü hatasını görebildiği tek veridir.

**RLS:** yalnızca SELECT (kendi satırları). INSERT/UPDATE/DELETE policy'si **yok** — yazma
yalnızca `record_feedback` / `retract_feedback` RPC'lerinden. Doğrudan INSERT açık olsaydı client
kendi ağırlığını seçebilirdi.

---

## `list_items`

"Listem" — Bekleyenler ve Bitirdiklerim.

| Kolon | Tip | Notlar |
|-------|-----|--------|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL | `auth.users(id)` ON DELETE CASCADE |
| `work_type`, `work_creator`, `work_title` | | `discovery_feedback` ile aynı biçim |
| `work_key` | TEXT GENERATED STORED | Aynı `lens_work_key()` — iki tablo ayrışamaz |
| `status` | TEXT | `pending` \| `completed` (CHECK), default `pending` |
| `hit_result` | TEXT | `hit` \| `partial` \| `miss` (CHECK), nullable — arşivdeki rozet |
| `added_from` | TEXT | `origin` ile aynı sözlük |
| `daily_discovery_id`, `weekly_pick_id`, `slot` | | Köken |
| `completed_at`, `removed_at`, `created_at` | TIMESTAMPTZ | |

**Kısıt:** `UNIQUE (user_id, work_key)` — aynı eser hem günlük keşiften hem seçkiden gelirse
çift satır olmaz.

**`removed_at` soft delete:** satır gerçekten silinseydi eser tekrar önerilebilir hale gelirdi;
kural "listeye eklenen eser tekrar önerilmez" diyor. Kullanıcı listeden çıkarır, motor unutmaz.

> **"Bunu biliyorum → Sevdim" buraya satır AÇMAZ** — bilinçli karar. Sinyal 3× zevk ağırlığıyla
> deftere yazılır ama arşiv "**Lens ile** bitirdiklerim" anlamını taşır; Lens önermeden önce
> zaten bilinen bir eser orada bir başarı kaydı değildir.

**RLS:** SELECT / INSERT / UPDATE kendi satırları. DELETE policy'si yok — çıkarma `removed_at` ile.

---

## `taste_profile`

Biriken ağırlıklı sinyallerden **türetilen** eksen profili. Elle yazılmaz; kaybolursa defterden
yeniden hesaplanabilir.

| Kolon | Tip | Notlar |
|-------|-----|--------|
| `user_id` | UUID PK | `auth.users(id)` ON DELETE CASCADE |
| `axes` | JSONB | `{tone, popularity, era}`, her biri [-1, 1]. **NULL = eşik henüz dolmadı** |
| `genre_weights` | JSONB | `{"<tür>": ağırlık}` |
| `signal_weight_total` | NUMERIC | Bayatlama sonrası toplam ağırlık; eksen ayarı eşiği (5) buna bakar |
| `calibration_weight_total` | NUMERIC | Arketip revizyonu eşiği (15) için sayaç — **bu iterasyonda okunmuyor** |
| `computed_at`, `computed_through` | TIMESTAMPTZ | Haftalık tempoyu yönetir |

**RLS:** yalnızca SELECT (kendi satırı). Yazma policy'si yok — türetilmiş veri.

---

## US-05 fonksiyonları

| Fonksiyon | Şema | Notlar |
|-----------|------|--------|
| `lens_work_key(type, creator, title)` | public | IMMUTABLE. Parantez atar, Türkçe diyakritikleri katlar, `COLLATE "C"` ile küçültür, alfanümerik olmayanı siler |
| `lens_signal_type` / `_weight` / `_valence` | public | IMMUTABLE karar sözlüğü. **Ağırlık** = güven kütlesi, **valans** = yön/şiddet (`partial`: 5× kütle, +0.5 valans) |
| `record_feedback(...)` | public | Sinyali yazar, çakışma invaryantını kurar, `interested` ise listeye ekler, tempoya göre profili hesaplar |
| `retract_feedback(id)` | public | Kaydı **siler** ve invaryantı yeniden kurar (`weight DESC, created_at DESC`) |
| `lens_blocked_works(user_id)` | public | JSONB. "Tekrar önerme" kümesinin tek tanımı |
| `lens_refresh_profile_if_due(user_id)` | public | Ücretsizin haftalık tempo kapısı; `{profile_refreshed, signals_until_profile}` döner |
| `lens_work_keys(jsonb)` | public | Aday önerilerin anahtarlarını toplu üretir |
| `lens_active_signals(user_id, window)` | **lens_private** | Bayatlama + valans uygulanmış aktif sinyaller |
| `recompute_taste_profile(user_id, window)` | **lens_private** | Eksen ayarı |

> ### ⚠️ `public` şemadaki fonksiyonlardan yetki GERİ ALMA
> PostgreSQL 17.6'da gerçek bir hata var: EXECUTE yetkisi olmayan bir rol **IMMUTABLE olmayan**
> bir fonksiyonu çağırdığında backend `permission denied` döndürmek yerine **SEGFAULT** ediyor ve
> veritabanı crash recovery'ye giriyor. Üç satırlık `RETURNS INT LANGUAGE sql STABLE ... SELECT 1`
> ile de yeniden üretilir; kod içeriğiyle ilgisi yok. IMMUTABLE fonksiyonlarda ve **şema
> seviyesindeki** USAGE reddinde sorun yok.
>
> `public` şemadaki her fonksiyon PostgREST üzerinden `/rest/v1/rpc/<ad>` olarak çağrılabildiği
> için, "yetkiyi geri al" savunması oturumu olan herhangi bir kullanıcının tek istekle
> veritabanını düşürmesi anlamına gelirdi. Bu yüzden:
> 1. `public`'teki IMMUTABLE olmayan fonksiyonlara `anon` dahil **EXECUTE verilir**; koruma
>    gövdedeki `auth.uid()` denetimindedir (`lens_blocked_works` başkasının kümesi istenince boş
>    döner, `lens_refresh_profile_if_due` hata atar).
> 2. Kimsenin çağırmaması gerekenler `lens_private` şemasında durur — PostgREST orayı görmez.
>
> **Şu an açık bir vektör YOK.** `public` şemadaki IMMUTABLE olmayan sekiz fonksiyonun
> (bu geliştirmeninkiler + `upsert_user_works`, `bump_extraction_quota`, trigger fonksiyonları)
> hepsinde `authenticated` EXECUTE yetkisine sahip, dolayısıyla izin reddi yolu hiç oluşmuyor.
> Risk **gizil**: ileride biri "güvenlik sıkılaştırması" diye bu fonksiyonlardan yetki geri
> alırsa vektör açılır. Denetim sorgusu:
>
> ```sql
> SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS ok
> FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
> WHERE n.nspname = 'public' AND p.provolatile <> 'i' ORDER BY ok;
> ```
> `ok = false` çıkan her satır bir DoS vektörüdür.

---

## `telegram_link_codes`

Telegram hesabı bağlama akışının tek kullanımlık kodları. Bot kodu üretir, kullanıcı `/connect` sayfasında girer, `link-telegram` edge function doğrular ve `telegram_users`'a satır yazar.

| Kolon              | Tip            | Notlar |
|--------------------|----------------|--------|
| `code`             | TEXT PK        | Tek kullanımlık bağlama kodu |
| `telegram_user_id` | BIGINT NOT NULL| Kodu isteyen Telegram kullanıcısı |
| `expires_at`       | TIMESTAMPTZ NOT NULL | Süre sonu; `telegram_link_codes_expires_at_idx` ile indeksli |
| `created_at`       | TIMESTAMPTZ    | default NOW() |

**RLS:** Açık, policy'si **yok** — yalnızca `service_role_key` erişir. Kodlar client'a okutulsaydı başkasının hesabı bağlanabilirdi.

---

## `telegram_users`

Telegram hesabı ↔ Lens hesabı eşlemesi. `link-telegram` edge function `telegram_link_codes` üzerinden doğrulama yaptıktan sonra buraya satır yazar.

| Kolon              | Tip           | Notlar |
|--------------------|---------------|--------|
| `telegram_user_id` | BIGINT PK     | Telegram'ın kullanıcı kimliği |
| `user_id`          | UUID NOT NULL | `auth.users(id)` |
| `created_at`       | TIMESTAMPTZ   | NOT NULL, default NOW() |

**Kısıt:** `PRIMARY KEY (telegram_user_id)` — bir Telegram hesabı en fazla bir Lens hesabına bağlanır.

**RLS:** Açık, ama **hiç policy'si yok.** Bu kasıtlı: hiçbir client (anon ya da authenticated) tabloyu okuyamaz veya yazamaz; erişim yalnızca `service_role_key` ile edge function'dan olur. Eşleme tablosunu client'a açmak, Telegram kimliklerini Lens hesaplarıyla ilişkilendirmeyi mümkün kılardı.

---

## `extraction_quota`

`extract-works` edge function günlük çıkarım kotası için `bump_extraction_quota(p_client_key, p_date)` RPC'sini çağırır (`DAILY_EXTRACTIONS = 30`).

**Production'da uygulanmıştır:** `20260808121924_extraction_quota.sql`, 2026-08-08'de push edilmiş
ve uzak migration geçmişinde kayıtlıdır (`supabase migration list` ile doğrulanabilir). Bu bölüm
bir dönem "production'da YOK" diyordu; o bilgi migration zaman damgalı hâle getirilip
uygulandıktan sonra güncellenmemişti.

Fonksiyon **fail-open** tasarlanmış (`extract-works/index.ts → quotaExceeded`): RPC hata verirse `false` döner ve istek geçer. Yani kota altyapısı bozulursa çıkarım durmaz, sınırsız hâle döner.

---

## `auth.users` (Supabase Auth — yönetilir)

Doğrudan sorgulama yapılmaz. `reports.user_id` ve `daily_discoveries.user_id` bu tabloya referans verir.

Auth yöntemleri: magic link (email OTP) + Google OAuth.  
`src/lib/supabase.ts` → `sendMagicLink`, `signInWithGoogle`, `getCurrentUser`.

---

## TypeScript tipleri

Tüm JSONB kolonlarının TypeScript karşılığı `src/lib/types.ts` içindedir:  
`Report`, `HeroData`, `TextureData`, `ThreadItem`, `ContrastItem`, `ShadowItem`, `DailyDiscovery`,  
`UserWork`, `ReportWork`, `WorkType`, `WorkSource`, `WorkConfidence`,  
`UserPreferences`, `WeeklyPick`, `WeeklyPickFilm`, `WeeklyPickIntroVariant`, `WeeklyPickStatus`.
