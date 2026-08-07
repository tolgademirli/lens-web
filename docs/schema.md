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
| `hero`            | JSONB        | `{archetype: string, summary: string}` |
| `texture`         | JSONB        | `{descriptions: string[], colors: [{name, hex, description}]}` — tam 3 renk |
| `threads`         | JSONB        | `[{title: string, description: string}]` — 2-3 öğe |
| `contrasts`       | JSONB        | `[{left: ContrastSide, right: ContrastSide, explanation: {title, text}}]` — 1-2 öğe |
| `shadow`          | JSONB        | `[{type: "Kitap"\|"Film"\|"Müzik", title: string\|null, author_or_artist: string, year: string\|null, description: string}]` — tam 3 öğe |
| `is_public`       | BOOLEAN      | default false. true ise auth'suz okunabilir. |

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
| `created_at` | TIMESTAMPTZ  | default NOW() |

**Kısıt:** `UNIQUE(user_id, date)` — bir kullanıcı günde bir keşif alır.  
**RLS:** Kullanıcı yalnızca kendi satırlarını okuyabilir. Insert yalnızca `service_role_key` ile yapılır (edge function).

---

## `user_preferences`

Kullanıcının kendi tercihleri. Şu an tek alan: haftalık film seçkisi opt-out'u.

| Kolon                  | Tip          | Notlar |
|------------------------|--------------|--------|
| `user_id`              | UUID PK      | `auth.users(id)` ON DELETE CASCADE |
| `weekly_picks_enabled` | BOOLEAN      | NOT NULL, default true |
| `updated_at`           | TIMESTAMPTZ  | NOT NULL, default NOW(); BEFORE UPDATE trigger'ı tazeler |

**Satırın yokluğu = varsayılan.** Kullanıcı ayara hiç dokunmadıysa burada satırı olmaz ve `weekly_picks_enabled = true` varsayılır. Satır ancak toggle'a ilk dokunuşta (upsert) doğar. Hem client (`src/lib/preferences.ts → DEFAULT_PREFERENCES`) hem gönderim fonksiyonu aynı varsayımı kullanır — birini değiştirirken diğerini de değiştir.

**RLS:** Kullanıcı yalnızca kendi satırını SELECT / INSERT / UPDATE edebilir (`auth.uid() = user_id`). DELETE policy'si yok — tercihi silmek anlamsız, kapatmak yeterli.

---

## `weekly_picks`

Haftalık film seçkileri. **Kürasyon manuel:** satırlar elle (veya dışarıda üretilmiş JSON ile) girilir; hiçbir kod buraya film seçmez. `send-weekly-picks` edge function'ının tek işi bu satırları göndermektir.

| Kolon           | Tip          | Notlar |
|-----------------|--------------|--------|
| `id`            | UUID PK      | gen_random_uuid() |
| `user_id`       | UUID NOT NULL| `auth.users(id)` ON DELETE CASCADE. `reports`'tan farklı olarak nullable **değil** — seçki kişiye özel küre edilir. |
| `week`          | DATE NOT NULL| O haftanın işareti (örn. gönderim Cuma'sı) |
| `films`         | JSONB NOT NULL| `[{title: string, year: int, blurb: string, justwatch_url: string}]` |
| `intro_variant` | TEXT         | `"standart"` \| `"sessiz"` (CHECK), default `standart`. Mail giriş paragrafını belirler. |
| `status`        | TEXT         | `"draft"` \| `"sent"` \| `"failed"` \| `"overpast"` (CHECK), default `draft` |
| `sent_at`       | TIMESTAMPTZ  | nullable — başarılı gönderimde dolar |
| `created_at`    | TIMESTAMPTZ  | NOT NULL, default NOW() |

**Kısıt:** `UNIQUE(user_id, week)` — aynı kullanıcıya aynı hafta iki seçki girilemez. Çift mail, gönderim hatasından pahalı.

**RLS:** Kullanıcı yalnızca kendi seçkilerini SELECT edebilir. INSERT/UPDATE/DELETE policy'si **bilerek yok** — yalnızca `service_role_key` yazar. Aksi halde kullanıcı kendi satırını `sent` işaretleyip gönderimi atlatabilirdi.

> **`overpast` = haftası geçti, artık gönderilmeyecek.** `send-weekly-picks` her çağrıda, haftası 7 günden fazla geçmiş tüm `draft` satırları bu duruma çeker. Opt-out yapan kullanıcının satırı o hafta içinde `draft` kalır (tercihini hemen geri açarsa seçki hâlâ gidebilir), sonra kapanır. Böylece Ağustos'ta kapatıp Ekim'de açan kullanıcı **yalnızca Ekim sonrası haftaları** alır; aradaki seçkiler birikip toplu halde gitmez. Bilinçli geri-doldurma için gönderim gövdesinde `allow_overpast: true` gerekir.

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

## `extraction_quota` — **production'da YOK**

`extract-works` edge function günlük çıkarım kotası için `bump_extraction_quota(p_client_key, p_date)` RPC'sini çağırır (`DAILY_EXTRACTIONS = 30`). `supabase/migrations/extraction_quota.sql` hem tabloyu hem fonksiyonu tanımlar, **ancak bu dosya production'a hiç uygulanmamıştır** — ne tablo ne fonksiyon canlıda mevcut.

Fonksiyon **fail-open** tasarlanmış (`extract-works/index.ts → quotaExceeded`): RPC hata verirse `false` döner ve istek geçer. Dolayısıyla çökme yok — ama **günlük 30 çıkarım limiti şu an hiç uygulanmıyor.** Her kullanıcı sınırsız ekran görüntüsü/yapıştırma çıkarımı yapabilir; her biri bir Claude vision çağrısı maliyetindedir.

Kotayı devreye almak için `extraction_quota.sql` içeriğinin zaman damgalı bir migration'a taşınıp `supabase db push` ile uygulanması gerekir. Bu bir **davranış değişikliğidir** (bugün limitsiz olan kullanıcılar limite tabi olur), o yüzden bilinçli karar ister.

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
