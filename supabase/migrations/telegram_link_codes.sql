-- telegram_link_codes: Telegram bot'un ürettiği tek kullanımlık bağlantı kodları
-- Bot bu tabloya yazar; link-telegram edge function kodu okur, kullanır ve siler.

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code TEXT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_link_codes_expires_at_idx
  ON telegram_link_codes (expires_at);

ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;
-- Policy tanımlanmıyor: hiçbir policy = client erişimi tamamen kapalı.
-- Bot ve edge function service_role_key ile RLS'i bypass eder.

-- daily_discoveries(user_id, date) unique constraint
-- Tablo daily_discoveries.sql migration'ı ile oluşturulduysa bu constraint zaten mevcuttur.
-- Eksikse ekler; varsa hata verir — Dashboard'dan kontrol edin.
ALTER TABLE daily_discoveries
  ADD CONSTRAINT IF NOT EXISTS daily_discoveries_user_id_date_key
  UNIQUE (user_id, date);
