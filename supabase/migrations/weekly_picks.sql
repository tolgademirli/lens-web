-- user_preferences + weekly_picks
-- Haftalık film seçkisi gönderim pipeline'ı. Supabase Dashboard > SQL Editor'de çalıştırın.
--
-- Model: "Kürasyon manuel, gönderim otomatik".
--   weekly_picks      = o hafta kime hangi filmlerin gideceği. Satırlar ELLE (veya dışarıda
--                       üretilmiş JSON ile) girilir. Hiçbir kod buraya film SEÇMEZ.
--   user_preferences  = kullanıcının kendi tercihi. Tek iş: gönderimden çıkabilmek.
--
-- Geriye dönük uyumluluk: mevcut hiçbir tablo (reports, user_works, daily_discoveries)
-- değişmiyor. Bu migration yalnızca iki yeni tablo ekler; form ve rapor akışı etkilenmez.


-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------
-- Satırın YOKLUĞU "varsayılan kabul" anlamına gelir — kullanıcı toggle'a hiç
-- dokunmadıysa burada satırı olmaz ve weekly_picks_enabled = true varsayılır.
-- Gönderim sorgusu bunu bilerek yazılmıştır (bkz. send-weekly-picks).
-- Satır ancak kullanıcı ayarı değiştirdiğinde upsert ile oluşur.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_picks_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca KENDİ tercihini görür.
DROP POLICY IF EXISTS "Users see own preferences" ON user_preferences;
CREATE POLICY "Users see own preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT gerekli: toggle upsert ile çalışır, ilk dokunuşta satırı kullanıcı yaratır.
-- WITH CHECK, başkası adına satır açmayı engeller.
DROP POLICY IF EXISTS "Users insert own preferences" ON user_preferences;
CREATE POLICY "Users insert own preferences" ON user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own preferences" ON user_preferences;
CREATE POLICY "Users update own preferences" ON user_preferences
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE policy YOK: tercihi silmek anlamsız, kapatmak yeterli.

-- updated_at'i uygulamaya bırakmıyoruz — opt-out zamanı sinyal, kaybolmasın.
CREATE OR REPLACE FUNCTION set_user_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_user_preferences_updated_at();


-- ---------------------------------------------------------------------------
-- weekly_picks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_picks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- reports.user_id'den farklı olarak NOT NULL: seçki kişiye özel küre edilir,
  -- anonim alıcı diye bir şey yok. Sahipsiz satır = gönderilemeyecek satır.
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- O haftanın işareti (örn. gönderim Cuma'sı). Fonksiyon bu tarihe göre çeker.
  week          DATE NOT NULL,

  -- v1 (elle girilmiş): [{ "title": str, "year": int, "blurb": str, "justwatch_url": str }]
  -- v2 (generate-weekly-picks): link alanı `watch_url`, ek olarak media_type,
  -- show_id, providers, offer_type, tags. Okuyucular `watch_url ?? justwatch_url`
  -- sırasını izler (docs/schema.md).
  films         JSONB NOT NULL,

  -- Mail giriş paragrafını belirler:
  --   'standart' = yakın zamanda rapor almış kullanıcı
  --   'sessiz'   = Lens'i denemiş ama uzaklaşmış kullanıcı
  intro_variant TEXT NOT NULL DEFAULT 'standart'
                CHECK (intro_variant IN ('standart', 'sessiz')),

  -- 'overpast' = haftası geçtiği için artık gönderilmeyecek. Terminal durum:
  -- bayat seçki, geç gelen seçkiden iyidir. Bkz. dosya sonundaki süpürme notu.
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'sent', 'failed', 'overpast')),

  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Aynı kullanıcıya aynı hafta iki seçki girilmesini engeller. Çift mail,
  -- gönderim hatasından daha pahalı bir hata.
  CONSTRAINT weekly_picks_one_per_week UNIQUE (user_id, week)
);

-- Gönderim sorgusunun tam eriştiği yol: "şu haftanın draft satırları".
CREATE INDEX IF NOT EXISTS weekly_picks_week_status_idx
  ON weekly_picks (week, status);

ALTER TABLE weekly_picks ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca kendi seçkilerini okuyabilir.
DROP POLICY IF EXISTS "Users see own weekly picks" ON weekly_picks;
CREATE POLICY "Users see own weekly picks" ON weekly_picks
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE policy YOK — bilerek. Seçkiyi yalnızca service_role
-- (edge function / SQL Editor) yazar ve status'ü yalnızca o günceller.
-- Kullanıcı kendi seçkisini 'sent' işaretleyip gönderimi atlatamamalı.


-- ---------------------------------------------------------------------------
-- 'overpast' statüsü — daha önce bu migration'ı çalıştırdıysan
-- ---------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS mevcut tabloyu değiştirmez, o yüzden CHECK kısıtını
-- ayrıca tazeliyoruz. Blok idempotent: hem sıfırdan kurulumda hem de tablo
-- zaten varken doğru sonucu verir.
ALTER TABLE weekly_picks DROP CONSTRAINT IF EXISTS weekly_picks_status_check;
ALTER TABLE weekly_picks ADD CONSTRAINT weekly_picks_status_check
  CHECK (status IN ('draft', 'sent', 'failed', 'overpast'));

-- Süpürme kuralı (send-weekly-picks her çağrıda uygular):
--   haftası 7 günden fazla geçmiş 'draft' satırlar -> 'overpast'.
-- Amaç: opt-out yüzünden atlanan ya da hiç çağrılmamış satırlar tabloda
-- süresiz birikip, kullanıcı tercihini geri açtığında toplu halde patlamasın.
-- Kullanıcı Ağustos'ta kapatıp Ekim'de açtıysa Ekim'den SONRAKİ haftaları alır;
-- aradaki haftalar 'overpast' olarak kapanır ve bir daha değerlendirilmez.
