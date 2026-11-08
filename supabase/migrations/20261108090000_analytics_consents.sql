-- ANALİTİK KARARININ HESAPTAKİ KAYDI (2026-11-08).
--
-- NE DEĞİŞTİ: kullanım ölçümü (PostHog) için verilen karar artık yalnızca tarayıcıda
-- (`localStorage["lens_analytics_consent"]`) değil, giriş yapan kişinin hesabında da
-- durur. Tarayıcıdaki kayıt cihaza ve tarayıcıya bağlıydı: başka bir cihazda, başka
-- bir tarayıcıda ya da Instagram'ın uygulama içi tarayıcısında kayıt yoktu ve bant
-- her seferinde yeniden soruyordu. Web girişte bu tablodan okur ve hesabında kararı
-- olan kişiye bir daha sormaz (`src/lib/analyticsConsent.ts`).
--
-- NEDEN `user_consents` DEĞİL: oradaki rıza (yurt dışı aktarım) geri alınamaz;
-- geri almanın yolu hesap silmek ve tablo yalnızca verilmiş rızayı tutar. Analitik
-- izni ise istenildiği an açılıp kapanır ve "hayır" da bir karardır. Kayıt bu
-- yüzden bir DEFTER: her karar yeni bir satırdır, geçerli olan en sonuncusudur.
-- Satır üzerine yazılmaz; kişinin ne zaman izin verip ne zaman geri aldığı
-- geçmişiyle birlikte durur.
--
-- SIRA: önce bu migration, sonra web. Tablo yokken web fail-open çalışır
-- (tarayıcıdaki karar geçerli kalır) ama karar hesaba yazılmaz.

CREATE TABLE IF NOT EXISTS public.analytics_consents (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('granted', 'denied')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.analytics_consents IS
  'Kullanım ölçümü (PostHog) için verilen kararların defteri. Her karar yeni bir satır; '
  'geçerli olan kullanıcının en son satırı. decided_at trigger ile damgalanır.';

-- Web her girişte "bu kişinin en son kararı" diye sorar.
CREATE INDEX IF NOT EXISTS analytics_consents_user_latest
  ON public.analytics_consents (user_id, decided_at DESC);

ALTER TABLE public.analytics_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own analytics consents" ON public.analytics_consents;
CREATE POLICY "Users see own analytics consents" ON public.analytics_consents
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users record own analytics consents" ON public.analytics_consents;
CREATE POLICY "Users record own analytics consents" ON public.analytics_consents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE ve DELETE politikası BİLEREK YOK: kararı değiştirmek yeni bir satır
-- eklemektir. Verilmiş bir kararın kaydı sonradan oynanamaz, kullanıcı tarafından
-- bile; satırlar yalnızca hesapla birlikte (CASCADE) gider.

-- Neden trigger: satırı RLS altında KULLANICI yazıyor ve web "en son karar geçerli"
-- kuralını bu damgaya göre uyguluyor. Damga client'a bırakılsaydı geleceğe tarihli
-- bir satır sonraki her kararı ezerdi (`user_consents.granted_at` ile aynı gerekçe).
CREATE OR REPLACE FUNCTION public.lens_stamp_analytics_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.decided_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analytics_consents_stamp ON public.analytics_consents;

CREATE TRIGGER analytics_consents_stamp
  BEFORE INSERT ON public.analytics_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.lens_stamp_analytics_consent();
