-- RIZA KAYDI + KOTA SAYACININ SAKLAMA SÜRESİ (2026-10-11, lansman öncesi — KVKK m.9, m.7).
--
-- NE DEĞİŞTİ:
--   1. `user_consents`: yurt dışı aktarımına verilen açık rızanın kaydı.
--   2. `extraction_quota`: 7 günden eski satırlar her gece silinir.
--
-- İkisi aynı dosyada çünkü ikisi de aynı şeyin karşılığı: yayına çıkan Aydınlatma
-- Metni'nde yazan iki cümle ("rızanı giriş yaparken verirsin", "IP adresi 7 gün
-- tutulur"). Metin bir söz; bu dosya o sözü doğru yapan şey.


-- ===========================================================================
-- 1. user_consents
-- ===========================================================================
-- Verinin tamamı yurt dışında işleniyor (Supabase Seul; Anthropic, Vercel, PostHog,
-- Resend ABD). Rıza giriş ekranındaki kutuyla alınıyor; "kim, hangi metne, ne
-- zaman rıza verdi" sorusunun cevabı burada durur.
--
-- `version` metnin sürümüdür (`src/lib/legal.ts` → TRANSFER_CONSENT_VERSION).
-- Rızanın KAPSAMI değişince sürüm değişir ve web, o sürümde satırı olmayan herkese
-- yeniden sorar. Eski sürümün satırı SİLİNMEZ: kişinin neye, ne zaman rıza verdiği
-- geçmişiyle birlikte durur.
--
-- Rızanın geri alınması = hesabın silinmesi (hizmet yurt dışındaki altyapı olmadan
-- çalışamıyor). Satır o yüzden CASCADE ile gider; ayrı bir "geri alındı" kolonu yok.
CREATE TABLE IF NOT EXISTS public.user_consents (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('transfer_abroad')),
  version    TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 32),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, version)
);

COMMENT ON TABLE public.user_consents IS
  'Açık rıza kayıtları (KVKK m.9). version = rıza metninin sürümü; kapsam değişince '
  'yükselir ve herkese yeniden sorulur. granted_at trigger ile damgalanır.';

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own consents" ON public.user_consents;
CREATE POLICY "Users see own consents" ON public.user_consents
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users record own consents" ON public.user_consents;
CREATE POLICY "Users record own consents" ON public.user_consents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE ve DELETE politikası BİLEREK YOK: verilmiş bir rızanın kaydı sonradan
-- oynanamaz, kullanıcı tarafından bile. Kayıt yalnızca hesapla birlikte gider.

-- Neden trigger: satırı RLS altında KULLANICI yazıyor. Damga client'ın yazabildiği
-- bir kolona bırakılsaydı oraya istediği tarihi koyabilirdi (`reports.public_since`
-- ile aynı gerekçe, aynı desen). Client ne gönderirse göndersin ezilir.
CREATE OR REPLACE FUNCTION public.lens_stamp_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.granted_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_consents_stamp ON public.user_consents;

CREATE TRIGGER user_consents_stamp
  BEFORE INSERT ON public.user_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.lens_stamp_consent();


-- ===========================================================================
-- 2. extraction_quota: 7 günlük saklama
-- ===========================================================================
-- Girişsiz `extract-works` çağrısında `client_key` IP adresidir ve o satırlar
-- bugüne kadar HİÇ silinmiyordu (hesap silme de ulaşamıyor: IP'nin kime ait
-- olduğunu bilmiyoruz). Sayaç günlük; dünün satırının işlevi yok. 7 gün, tabloyu
-- kuran migration'ın kendi notundaki süre.
--
-- Haftalık seçki işlerinin aksine bu iş SIR İSTEMEZ (düz SQL, ağ çağrısı yok),
-- o yüzden Vault koşuluna bağlı değil ve lokalde de kurulur — orada yaptığı tek
-- şey lokal sayaç satırlarını silmek.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE '[lens] pg_cron kurulamıyor — kota temizliği ZAMANLANMADI.';
    RETURN;
  END IF;

  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';

  -- Fikirdeşlik: eski iş önce sökülür.
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname = 'lens-purge-extraction-quota';

  -- Her gece 00:20 UTC (03:20 İstanbul).
  PERFORM cron.schedule('lens-purge-extraction-quota', '20 0 * * *', $job$
    DELETE FROM public.extraction_quota WHERE date < CURRENT_DATE - 7;
  $job$);

  RAISE NOTICE '[lens] Kota temizliği kuruldu (lens-purge-extraction-quota).';
END
$mig$;

-- Birikmiş satırlar ilk gece yarısını beklemesin.
DELETE FROM public.extraction_quota WHERE date < CURRENT_DATE - 7;
