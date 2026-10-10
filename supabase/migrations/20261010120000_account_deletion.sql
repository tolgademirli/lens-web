-- HESAP SİLME (2026-10-10, lansman öncesi — KVKK m.7 ve m.11).
--
-- NE DEĞİŞTİ: bir kullanıcı `auth.users`'tan silindiğinde ona ait her satır gider.
--
-- Bundan önce silme teknik olarak MÜMKÜN DEĞİLDİ. Dört tablo `auth.users`'a
-- ON DELETE kuralı olmadan (NO ACTION) bağlıydı: raporu olan bir kullanıcıyı
-- Supabase panelinden silmek bile yabancı anahtar hatasıyla duruyordu. Yani
-- "verimi silin" diyen birine verebileceğimiz bir cevap yoktu.
--
-- "Bir kullanıcıyı silmek" artık TEK tanıma sahip ve o tanım burada, veritabanında:
--   1. `user_id` taşıyan her tablo ON DELETE CASCADE ile bağlı.
--   2. Yabancı anahtarın ULAŞAMADIĞI satırları `auth.users` üzerindeki
--      BEFORE DELETE trigger'ı toplar.
-- Böylece üç silme yolu da aynı sonucu verir: `delete-account` edge function'ı
-- (kullanıcının kendi düğmesi), Supabase paneli (e-postayla gelen talep) ve SQL.
-- Tablo tablo DELETE yazan ikinci bir liste YOK — olsaydı ilk yeni tabloda eskirdi.
--
-- YENİ TABLO EKLERKEN: `auth.users`'a bağlanıyorsa ON DELETE CASCADE yaz.
-- Kullanıcıya ait olup `user_id` taşımayan bir satır doğuyorsa (Telegram
-- kimliğiyle, IP ya da e-postayla anahtarlanan her şey) aşağıdaki
-- `purge_user_orphans`'a ekle. İkisinden biri atlanırsa silme ya hata verir
-- ya da — daha kötüsü — sessizce eksik kalır.


-- ===========================================================================
-- 1. Yabancı anahtarlar
-- ===========================================================================
-- DROP'ta IF EXISTS BİLEREK YOK: ad tutmazsa migration gürültüyle dursun.
-- Sessizce atlasaydı eski NO ACTION kısıtı yerinde kalır, yanına ikinci bir
-- kısıt eklenir ve silme yine hata verirdi — bu kez sebebi görünmeden.

ALTER TABLE public.reports
  DROP CONSTRAINT reports_user_id_fkey,
  ADD CONSTRAINT reports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_works
  DROP CONSTRAINT user_works_user_id_fkey,
  ADD CONSTRAINT user_works_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.telegram_users
  DROP CONSTRAINT telegram_users_user_id_fkey,
  ADD CONSTRAINT telegram_users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.daily_discoveries
  DROP CONSTRAINT daily_discoveries_user_id_fkey,
  ADD CONSTRAINT daily_discoveries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Keşif, onu doğuran raporu aşmalı (discovery_feedback'teki SET NULL ile aynı
-- gerekçe): tek bir rapor silindiğinde o rapordan türeyen keşif geçmişi ve
-- ona bağlı "son 30 günde gösterildi" kaydı kaybolmasın. Kullanıcı silinirken
-- keşiflerin kendisi zaten yukarıdaki CASCADE ile gider.
ALTER TABLE public.daily_discoveries
  DROP CONSTRAINT daily_discoveries_report_id_fkey,
  ADD CONSTRAINT daily_discoveries_report_id_fkey
    FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;


-- ===========================================================================
-- 2. Yabancı anahtarın ulaşamadığı satırlar
-- ===========================================================================
-- Bot kaynaklı raporlar ve eserler `user_id` olmadan, yalnızca
-- `telegram_user_id` ile doğabiliyor. Onları kullanıcıya bağlayan TEK şey
-- `telegram_users` eşlemesi — ve o eşleme CASCADE ile silindiği anda bu
-- satırların kime ait olduğu bir daha bulunamaz. Bu yüzden trigger BEFORE:
-- eşleme hâlâ yerindeyken okunmak zorunda.
--
-- `user_id IS NULL` koşulu kasıtlı: bir Telegram hesabı sonradan başka bir Lens
-- hesabına bağlanmış olabilir (`link-telegram` upsert ediyor). Sahibi belli
-- satırlara dokunmuyoruz; onlar kendi sahiplerinin CASCADE'iyle gider.
--
-- `extraction_quota.client_key` girişli kullanıcıda kullanıcı id'sinin metin
-- hâlidir. Anonim çağrının IP'sine buradan ulaşılamaz — hangi IP'nin bu
-- kullanıcıya ait olduğunu bilmiyoruz.
CREATE OR REPLACE FUNCTION lens_private.purge_user_orphans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telegram_ids BIGINT[];
BEGIN
  SELECT array_agg(tu.telegram_user_id)
    INTO v_telegram_ids
    FROM public.telegram_users tu
   WHERE tu.user_id = OLD.id;

  IF v_telegram_ids IS NOT NULL THEN
    DELETE FROM public.reports r
     WHERE r.user_id IS NULL
       AND r.telegram_user_id = ANY (v_telegram_ids);

    DELETE FROM public.user_works w
     WHERE w.user_id IS NULL
       AND w.telegram_user_id = ANY (v_telegram_ids);

    DELETE FROM public.telegram_link_codes c
     WHERE c.telegram_user_id = ANY (v_telegram_ids);
  END IF;

  DELETE FROM public.extraction_quota q
   WHERE q.client_key = OLD.id::TEXT;

  RETURN OLD;
END;
$$;

-- BU FONKSİYONDAN EXECUTE GERİ ALINMIYOR — lens_private'taki diğerlerinin aksine.
-- Trigger'ı ateşleyen rol `supabase_auth_admin` (GoTrue), sahibi `postgres`.
-- PG 17.6'da yetkisiz bir rolün IMMUTABLE olmayan bir fonksiyona düşmesi backend'i
-- segfault ettiriyor (docs/schema.md); bu yolu denemeye değmez. Kaybedilen bir şey
-- de yok: trigger fonksiyonu doğrudan çağrılamaz, şema da PostgREST'e kapalı.

COMMENT ON FUNCTION lens_private.purge_user_orphans() IS
  'auth.users BEFORE DELETE: yabancı anahtarın ulaşamadığı satırları (Telegram '
  'kimliğiyle doğmuş sahipsiz rapor/eser, bağlama kodları, kota sayacı) siler. '
  'user_id taşımayan yeni bir kullanıcı verisi doğarsa buraya eklenir.';

DROP TRIGGER IF EXISTS lens_purge_user_orphans ON auth.users;

CREATE TRIGGER lens_purge_user_orphans
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION lens_private.purge_user_orphans();
