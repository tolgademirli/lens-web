-- daily_discoveries tablosu
-- Supabase Dashboard > SQL Editor'de çalıştırın

CREATE TABLE IF NOT EXISTS daily_discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  report_id UUID REFERENCES reports(id),
  book TEXT NOT NULL,
  film TEXT NOT NULL,
  music TEXT NOT NULL,
  reasons JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

ALTER TABLE daily_discoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own discoveries" ON daily_discoveries
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT: edge function service_role_key ile çalışır, RLS bypass edilir.
