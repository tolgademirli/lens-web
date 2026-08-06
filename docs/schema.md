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

**RLS:** `is_public = true` olan raporlar herkese açık. Özel raporlar yalnızca `auth.uid() = user_id` koşuluyla okunabilir. Bkz. `src/lib/supabase.ts → fetchReport`.

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
| `status`        | TEXT         | `"draft"` \| `"sent"` \| `"failed"` (CHECK), default `draft` |
| `sent_at`       | TIMESTAMPTZ  | nullable — başarılı gönderimde dolar |
| `created_at`    | TIMESTAMPTZ  | NOT NULL, default NOW() |

**Kısıt:** `UNIQUE(user_id, week)` — aynı kullanıcıya aynı hafta iki seçki girilemez. Çift mail, gönderim hatasından pahalı.

**RLS:** Kullanıcı yalnızca kendi seçkilerini SELECT edebilir. INSERT/UPDATE/DELETE policy'si **bilerek yok** — yalnızca `service_role_key` yazar. Aksi halde kullanıcı kendi satırını `sent` işaretleyip gönderimi atlatabilirdi.

> Opt-out yapan kullanıcının satırı `draft` bırakılır, `failed` yapılmaz. Tercih geri açılırsa sonraki çağrıda kendiliğinden gönderilir.

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
