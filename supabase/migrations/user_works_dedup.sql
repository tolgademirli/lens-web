-- user_works tekilliği: aynı eser kullanıcı başına bir kez.
-- Supabase Dashboard > SQL Editor'de çalıştırın.
--
-- Havuz bir kütüphane; aynı listeyi ikinci kez import etmek yeni satır açmamalı.
-- Eserin ikinci bir rapora girmesi report_works'te yeni BAĞLANTI olarak durur
-- (ilişki zaten çoka-çok), user_works'te yeni KAYIT olarak değil.
--
-- Bu script iki iş yapar: (1) mevcut çiftleri report_works bağlantılarını
-- kaybetmeden birleştirir, (2) tekrarını engelleyen unique index'i kurar.

BEGIN;

-- Her (kullanıcı, tür, yaratıcı, eser) grubunda en eski kayıt temsilci seçilir.
-- Karşılaştırma küçük harfe indirgenir ve NULL'lar '' sayılır; aksi halde
-- "Albert Camus" ile "albert camus" ayrı kayıt olarak kalırdı.
CREATE TEMP TABLE dup_map ON COMMIT DROP AS
SELECT
  id,
  first_value(id) OVER w AS keep_id,
  row_number()    OVER w AS rn
FROM user_works
WHERE deleted_at IS NULL
WINDOW w AS (
  PARTITION BY user_id, type,
               lower(coalesce(creator, '')),
               lower(coalesce(title, ''))
  ORDER BY created_at, id
);

-- Aynı rapora hem temsilci hem fazlalık bağlıysa, taşımak PK ihlali yaratırdı;
-- önce o çakışan bağlantıyı sil.
DELETE FROM report_works rw
USING dup_map d
WHERE rw.work_id = d.id
  AND d.rn > 1
  AND EXISTS (
    SELECT 1 FROM report_works x
    WHERE x.report_id = rw.report_id AND x.work_id = d.keep_id
  );

-- Kalan bağlantılar temsilciye taşınır — provenance kaybolmaz.
UPDATE report_works rw
SET work_id = d.keep_id
FROM dup_map d
WHERE rw.work_id = d.id AND d.rn > 1;

-- Fazlalık kayıtlar silinir.
DELETE FROM user_works
WHERE id IN (SELECT id FROM dup_map WHERE rn > 1);

-- Bundan sonra tekrarı veritabanı engeller.
-- Partial index: soft-delete edilmiş kayıt tekrar eklenebilsin.
CREATE UNIQUE INDEX IF NOT EXISTS user_works_unique_per_user
  ON user_works (user_id, type, lower(coalesce(creator, '')), lower(coalesce(title, '')))
  WHERE deleted_at IS NULL;

COMMIT;


-- Havuza yazarken tekilliği uygulayan fonksiyon.
-- Girdi sırasını koruyarak id dizisi döner; çağıran bu id'lerle report_works
-- bağlantısını kurar. Mevcut kayıt varsa INSERT atılmaz, id'si yeniden kullanılır.
--
-- SECURITY INVOKER (varsayılan): RLS aynen geçerli, kullanıcı yalnızca kendi
-- satırlarını görür/yazar. user_id parametre olarak ALINMAZ — auth.uid()
-- kullanılır, yoksa bir kullanıcı başkasının kütüphanesine yazabilirdi.
CREATE OR REPLACE FUNCTION upsert_user_works(
  p_type     TEXT,
  p_batch_id UUID,
  p_works    JSONB
)
RETURNS UUID[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  UUID[] := '{}';
  w         JSONB;
  v_creator TEXT;
  v_title   TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;

  FOR w IN SELECT * FROM jsonb_array_elements(p_works)
  LOOP
    v_creator := nullif(btrim(coalesce(w->>'creator', '')), '');
    v_title   := nullif(btrim(coalesce(w->>'title', '')), '');

    IF v_creator IS NULL AND v_title IS NULL THEN
      CONTINUE;  -- tamamen boş kayıt anlamsız
    END IF;

    SELECT uw.id INTO v_id
    FROM user_works uw
    WHERE uw.user_id = v_user_id
      AND uw.type = p_type
      AND uw.deleted_at IS NULL
      AND lower(coalesce(uw.creator, '')) = lower(coalesce(v_creator, ''))
      AND lower(coalesce(uw.title, ''))   = lower(coalesce(v_title, ''))
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO user_works (user_id, type, creator, title, source, confidence, batch_id)
      VALUES (
        v_user_id, p_type, v_creator, v_title,
        w->>'source',
        nullif(w->>'confidence', ''),
        p_batch_id
      )
      RETURNING id INTO v_id;
    END IF;

    v_result := v_result || v_id;
  END LOOP;

  RETURN v_result;
END;
$$;
