-- AÇIK RAPORLAR LİSTELENEBİLİYORDU (2026-10-11, canlı testte bulundu).
--
-- SORUN: `reports` üzerindeki "Herkese acik raporlari herkes okuyabilir" politikası
-- `USING (is_public = true)` idi. RLS satıra bakar, isteğe değil: "bu satırı kimliğini
-- bilerek mi istiyorsun" diye soramaz. Sonuç, oturumsuz bir istemcinin herkese açık
-- anon anahtarıyla
--   GET /rest/v1/reports?select=*
-- çağırıp açık raporların TAMAMINI tek istekte çekebilmesiydi (o gün 35 rapor, 14'ü
-- Telegram kaynaklı) — eser listeleri, `user_id` ve `telegram_user_id` dahil.
--
-- Arayüz ise "bağlantısı olan herkes görebilecek" diyor. Kullanıcının onayladığı şey
-- buydu; "herkes listeleyebilecek" değil. Rapor kimliği tahmin edilemeyen bir UUID,
-- yani bağlantıyı bilmek gerçekten bir şey ifade ediyor — yeter ki tablo dökülemesin.
--
-- ÇÖZÜM: açık raporu YALNIZCA kimliğiyle veren bir fonksiyon, ve politikanın kaldırılması.
-- Tabloda kalan tek SELECT politikası sahiplik (`auth.uid() = user_id`): panel listesi
-- ve görünürlük güncellemesi ona dayanıyor, onlara dokunulmadı.
--
-- SIRA: bu migration web'den ÖNCE gider. Fonksiyon yokken yeni web hiçbir raporu
-- açamaz. Tersinin bedeli küçük: push ile Vercel deploy'u arasındaki birkaç dakikada
-- ESKİ web, sahibi olmayan ziyaretçiye açık raporu "bulunamadı" gösterir (sahibi görür).
--
-- ETKİLENMEYENLER: edge function'lar ve Telegram botu service_role ile okur/yazar,
-- RLS'e takılmaz.


-- ===========================================================================
-- 1. Raporu kimliğiyle veren fonksiyon
-- ===========================================================================
-- Dönen satır `reports` satırının kendisi (SETOF): istemci `select("*")` ile aldığı
-- biçimi almaya devam eder ve tabloya eklenen kolon burada ayrıca yazılmak zorunda
-- kalmaz. plpgsql olması bu yüzden — satır değişkeni kolon listesi istemiyor.
--
-- SAHİBİ OLMAYANA KİMLİK KOLONLARI DÖNMEZ. Raporu görmek için sahibinin kim olduğunu
-- bilmek gerekmiyor, ama `user_id` başka çağrıların anahtarı (bkz.
-- 20260812090000_feedback_auth_guard_fix.sql: zincirin ilk halkası tam olarak buydu)
-- ve `telegram_user_id` doğrudan bir kişisel tanımlayıcı. Web, sahipliği
-- `user_id === oturumdaki kullanıcı` ile sınıyor; sahibi için değer yerinde durur.
-- KİMLİK TAŞIYAN YENİ BİR KOLON EKLENİRSE BURADA DA BOŞALTILIR.
CREATE OR REPLACE FUNCTION public.lens_report_by_id(p_id UUID)
RETURNS SETOF public.reports
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
ROWS 1
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_owner  BOOLEAN;
BEGIN
  SELECT r.* INTO v_report FROM public.reports r WHERE r.id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- COALESCE ŞART (20260812'deki tuzağın aynısı): oturumsuz çağrıda auth.uid() NULL,
  -- karşılaştırma FALSE değil NULL üretir ve `IF NOT NULL` bloğu hiç çalışmaz. Bot
  -- kaynaklı raporda user_id de NULL'dır; `IS DISTINCT FROM` kullansaydık NULL ile
  -- NULL "aynı" sayılır, oturumsuz çağıran o raporun SAHİBİ görünürdü.
  v_owner := COALESCE(v_report.user_id = auth.uid(), FALSE);

  -- "Yok" ile "yetkin yok" aynı cevabı alır: özel bir raporun varlığını doğrulamak da
  -- bir sızıntı.
  IF NOT (v_owner OR COALESCE(v_report.is_public, FALSE)) THEN
    RETURN;
  END IF;

  IF NOT v_owner THEN
    v_report.user_id := NULL;
    v_report.telegram_user_id := NULL;
  END IF;

  RETURN NEXT v_report;
END;
$$;

COMMENT ON FUNCTION public.lens_report_by_id(UUID) IS
  'Raporu kimliğiyle verir: açıksa herkese, özelse yalnızca sahibine. Açık raporların '
  'okunabildiği TEK yol — tabloda is_public koşullu SELECT politikası yok, çünkü o '
  'politika tabloyu listelenebilir yapıyordu. Sahibi olmayana user_id ve '
  'telegram_user_id boş döner.';

-- Yetki herkese verilir (PG 17.6 notu: public'teki IMMUTABLE olmayan fonksiyondan
-- EXECUTE geri alınmaz). Bu fonksiyonun zaten işi oturumsuz çağrılmak.
GRANT EXECUTE ON FUNCTION public.lens_report_by_id(UUID) TO anon, authenticated, service_role;


-- ===========================================================================
-- 2. Listelemeyi açan politika
-- ===========================================================================
-- IF EXISTS BİLEREK YOK: ad tutmazsa migration gürültüyle dursun. Sessizce
-- atlasaydı politika yerinde kalır, fonksiyon eklenmiş olur ve açık kapanmış SANILIRDI.
DROP POLICY "Herkese acik raporlari herkes okuyabilir" ON public.reports;

-- Son koşul. Baseline uzak şemadan döküldü; o günden sonra panelden elle eklenmiş bir
-- politika migration'larda görünmez ve yukarıdaki DROP'tan sağ çıkar. Sahipliğe
-- bakmayan bir SELECT politikası kaldıysa tablo hâlâ listelenebilir demektir.
DO $$
DECLARE
  v_open TEXT;
BEGIN
  SELECT string_agg(p.polname, ', ')
    INTO v_open
    FROM pg_policy p
   WHERE p.polrelid = 'public.reports'::regclass
     AND p.polcmd IN ('r', '*')
     AND COALESCE(pg_get_expr(p.polqual, p.polrelid), 'true') NOT LIKE '%auth.uid()%';

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'reports üzerinde sahipliğe bakmayan SELECT politikası kaldı: %', v_open;
  END IF;
END;
$$;
