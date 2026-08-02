-- extraction_quota: extract-works için günlük kota sayacı.
-- Supabase Dashboard > SQL Editor'de çalıştırın.
--
-- extract-works anonim erişime açık (kullanıcı onboarding'de henüz giriş yapmamış
-- oluyor). Vision çağrıları maliyetli olduğu için kimlik varsa kullanıcıya, yoksa
-- IP'ye günlük tavan uygulanır.
--
-- Bu migration ÇALIŞTIRILMAZSA endpoint yine çalışır: quotaExceeded() fail-open
-- yazıldı, tablo yoksa istek engellenmez. Yani kota koruması opsiyoneldir,
-- ama üretimde çalıştırılması önerilir.

CREATE TABLE IF NOT EXISTS extraction_quota (
  client_key TEXT NOT NULL,          -- auth.users(id) ya da IP adresi
  date       DATE NOT NULL,          -- Europe/Istanbul gününe göre
  count      INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_key, date)
);

ALTER TABLE extraction_quota ENABLE ROW LEVEL SECURITY;
-- Policy tanımlanmıyor: hiçbir policy = client erişimi tamamen kapalı.
-- Yalnızca edge function service_role_key ile erişir.

-- Sayacı atomik artırır ve yeni değeri döner.
CREATE OR REPLACE FUNCTION bump_extraction_quota(p_client_key TEXT, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO extraction_quota (client_key, date, count)
  VALUES (p_client_key, p_date, 1)
  ON CONFLICT (client_key, date)
  DO UPDATE SET count = extraction_quota.count + 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

-- Eski satırları temizlemek için (opsiyonel, elle ya da cron ile):
--   DELETE FROM extraction_quota WHERE date < CURRENT_DATE - INTERVAL '7 days';
