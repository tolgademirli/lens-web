-- user_works + report_works
-- Screenshot-to-DNA altyapısı. Supabase Dashboard > SQL Editor'de çalıştırın.
--
-- Model: "Kütüphane sınırsız, rapor bounded".
--   user_works  = kullanıcının eser havuzu. Edinim yolu ne olursa olsun (ekran görüntüsü,
--                 yapıştırma, manuel, eski form) HER eser buraya yazılır. Üst sınır yok.
--   report_works = hangi raporun hangi havuz kayıtlarından üretildiği (provenance).
--                 Many-to-many: aynı eser zaman içinde birden çok rapora girebilir.
--
-- Geriye dönük uyumluluk: reports.books/films/songs JSONB kolonları DEĞİŞMİYOR.
-- Onlar raporun donmuş anlık görüntüsü olmaya devam eder; report_works yalnızca
-- kökeni kaydeder. Eski form akışı bu migration'dan etkilenmez.


-- ---------------------------------------------------------------------------
-- user_works
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_works (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sahiplik: reports tablosuyla aynı desen. İkisi de nullable —
  -- anonim web akışı ve bot kaynaklı edinim veri kaybetmeden yazılabilsin.
  -- Anonim satırlar login sonrasında user_id doldurularak sahiplenilir.
  user_id          UUID REFERENCES auth.users(id),
  telegram_user_id BIGINT,

  type             TEXT NOT NULL CHECK (type IN ('book', 'film', 'song')),

  -- Creator-first ama ikisi de opsiyonel: gerçek listelerde satır üç biçimde gelir
  -- (yalnız yaratıcı / yalnız eser / ikisi). En az biri dolu olmalı.
  creator          TEXT,
  title            TEXT,

  -- Edinim yolu. 'manual' ile 'paste' AYRI tutulur — hangi yolun tuttuğunu
  -- ölçen analitik tamamen buna bağlı. 'form' = Screenshot-to-DNA öncesi akış.
  source           TEXT NOT NULL CHECK (source IN ('screenshot', 'paste', 'manual', 'form')),

  -- Tek bir çıkarım işleminden gelen eserleri gruplar (onay ekranındaki
  -- "yüklediğin görsel ↔ çıkarılan satırlar" eşlemesi ve sonraki analiz için).
  batch_id         UUID,

  -- Vision çıkarımının per-item güven sinyali. Manuel girişlerde null.
  confidence       TEXT CHECK (confidence IN ('high', 'medium', 'low')),

  -- Soft delete: kullanıcı havuzdan kayıt çıkardığında satır silinmez,
  -- işaretlenir. Böylece geçmiş raporların provenance'ı bozulmaz.
  deleted_at       TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT user_works_needs_name CHECK (creator IS NOT NULL OR title IS NOT NULL)
);

-- Havuz listeleme: kullanıcının bir kategorideki eserleri, yeniden eskiye.
CREATE INDEX IF NOT EXISTS user_works_user_type_created_idx
  ON user_works (user_id, type, created_at DESC);

-- Tek çıkarımın satırlarını toplama.
CREATE INDEX IF NOT EXISTS user_works_batch_id_idx
  ON user_works (batch_id);

-- Bot kaynaklı edinimleri kullanıcıya bağlama.
CREATE INDEX IF NOT EXISTS user_works_telegram_user_id_idx
  ON user_works (telegram_user_id);

ALTER TABLE user_works ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca kendi kayıtlarını görür ve yönetir.
-- user_id NULL olan (anonim/bot) satırlar hiçbir client'a görünmez;
-- onlara yalnızca service_role_key ile edge function erişir.
DROP POLICY IF EXISTS "Users see own works" ON user_works;
CREATE POLICY "Users see own works" ON user_works
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own works" ON user_works;
CREATE POLICY "Users insert own works" ON user_works
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own works" ON user_works;
CREATE POLICY "Users update own works" ON user_works
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own works" ON user_works;
CREATE POLICY "Users delete own works" ON user_works
  FOR DELETE USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- report_works
-- ---------------------------------------------------------------------------
-- Bir rapor hangi havuz kayıtlarından üretildi. Many-to-many olması kasıtlı:
-- user_works üzerinde tek bir report_id kolonu, "havuzdan seçerek yeni rapor
-- üret" özelliği geldiğinde yanlış olurdu (aynı eser birden çok rapora girer).
CREATE TABLE IF NOT EXISTS report_works (
  report_id  UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  work_id    UUID NOT NULL REFERENCES user_works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (report_id, work_id)
);

-- Ters yön: "bu eser hangi raporlara girdi" — kimlik drift takibi bunu kullanır.
CREATE INDEX IF NOT EXISTS report_works_work_id_idx
  ON report_works (work_id);

ALTER TABLE report_works ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca kendi raporlarının bağlantılarını görür.
DROP POLICY IF EXISTS "Users see own report links" ON report_works;
CREATE POLICY "Users see own report links" ON report_works
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM reports r
      WHERE r.id = report_works.report_id
        AND r.user_id = auth.uid()
    )
  );

-- INSERT: yalnızca edge function, service_role_key ile. Policy tanımlanmıyor.
