-- Raporun paylaşıma açıldığı anı kaydeder.
--
-- Poster paylaşımı özel bir raporu herkese açık hale getirebiliyor (kullanıcı
-- onayıyla). "Bu karar ne zaman verildi" sorusunun cevabı bir yerde durmalı:
-- destek talebinde, bir sızıntı şüphesinde ya da ileride "şu tarihten sonra
-- açılanlar" gibi bir sorguda tek dayanak bu.
--
-- Neden trigger, neden client değil: `is_public` güncellemesini RLS altında
-- KULLANICI yapıyor (Kullanici kendi raporunu guncelleyebilir politikası).
-- Damgayı client'ın yazdığı bir kolona bıraksaydık kullanıcı oraya istediği
-- tarihi yazabilirdi. Trigger değeri sunucuda üretir, client'ın gönderdiği
-- public_since ne olursa olsun ezilir.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS public_since timestamptz;

-- Halihazırda açık olan raporlar için geçmişe dönük bir tarih uyduramayız;
-- created_at en yakın dürüst tahmin değil, çünkü rapor sonradan açılmış
-- olabilir. NULL bırakılıyor: "bilinmiyor" ile "hiç açılmadı" ayrımı
-- is_public kolonundan zaten okunuyor.

CREATE OR REPLACE FUNCTION public.lens_touch_public_since()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    -- Açıldıysa damga vurulur, kapatıldıysa silinir. Kapatınca silmek kasıtlı:
    -- kolon "şu andan beri açık" demek, "bir zamanlar açılmıştı" değil.
    NEW.public_since := CASE WHEN NEW.is_public THEN now() ELSE NULL END;
  ELSE
    -- is_public'e dokunmayan bir UPDATE damgayı oynatamaz.
    NEW.public_since := OLD.public_since;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_public_since ON public.reports;

CREATE TRIGGER reports_public_since
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.lens_touch_public_since();

-- INSERT için trigger YOK: web raporları is_public = false doğuyor, Telegram
-- botunun açtığı raporlarda ise "paylaşım kararı" diye bir an yok — zaten açık
-- doğuyorlar. Olmayan bir karara damga vurmak veriyi yanlış anlatırdı.
