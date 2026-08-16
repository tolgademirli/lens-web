-- Haftalık seçki zamanlaması (Migration B).
--
-- ÖNCE ÜRETİM AKIŞINI ELLE DOĞRULA. Bu dosya en son uygulanır: üretim
-- (generate-weekly-picks) dry_run ile doğrulanmadan takvim kurmak, ilk Cuma'da
-- gerçek kullanıcılara doğrulanmamış seçki göndermek demektir.
--
-- ZAMAN DİLİMİ: Türkiye KALICI olarak UTC+3 (2016'dan beri yaz saati yok), yani
-- 14:00 UTC == 17:00 İstanbul HER ZAMAN. Bu yüzden cron ifadeleri UTC yazılır ve
-- yaz saati düzeltmesi gerekmez. (pg_cron sunucu saat diliminde çalışır;
-- Supabase'de bu UTC'dir — deploy sonrası `SHOW timezone;` ile doğrula.)
--
-- SIRLAR GIT'E GİRMEZ: işler URL ve anahtarları Supabase Vault'tan ADIYLA okur.
--
-- ---------------------------------------------------------------------------
-- TAKVİM NEDEN KOŞULLU KURULUYOR
-- ---------------------------------------------------------------------------
-- Bu migration lokal geliştirme veritabanında da koşuyor ve Supabase'in lokal
-- imajı pg_cron'u KURMAYA İZİN VERİYOR. Yani "eklenti var mı" diye bakmak
-- yetmez — ilk yazımda öyleydi ve lokal veritabanına üç PRODUCTION işi kurdu;
-- o işler her Cuma, lokalde bulunmayan Vault sırlarına POST etmeye çalışacaktı.
--
-- Doğru koşul EKLENTİ değil SIR: takvim yalnızca üç Vault sırrı da varsa kurulur.
-- Lokalde sır yok -> yardımcılar ve kurulum fonksiyonu oluşur, İŞ KURULMAZ.
-- Production'da sırları girdikten sonra:
--     select lens_private.install_weekly_cron();
-- Fonksiyon fikirdeş: her çağrıda eski işleri söküp yeniden kurar.

DO $mig$
DECLARE
  v_has_cron BOOLEAN;
  v_has_net  BOOLEAN;
  v_secrets  INT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'),
         EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')
    INTO v_has_cron, v_has_net;

  IF NOT v_has_cron OR NOT v_has_net THEN
    RAISE NOTICE '[lens] pg_cron/pg_net kurulamıyor — zamanlama ATLANDI.';
    RETURN;
  END IF;

  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';

  -- ---------------------------------------------------------------------
  -- Vault yardımcıları: URL/sır tesisatı TEK yerde
  -- ---------------------------------------------------------------------
  -- lens_private'te çünkü PostgREST bu şemayı hiç görmüyor. public'te olsalardı
  -- service_role anahtarını döndüren bir fonksiyon /rest/v1/rpc'ye açılırdı.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION lens_private.fn_url(p_name TEXT)
    RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'lens_project_url') || '/functions/v1/' || p_name;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION lens_private.fn_url(TEXT) FROM PUBLIC';

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION lens_private.fn_headers()
    RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                       WHERE name = 'lens_service_role_key'),
        'x-weekly-picks-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                                  WHERE name = 'lens_weekly_picks_secret'));
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION lens_private.fn_headers() FROM PUBLIC';

  -- ---------------------------------------------------------------------
  -- Kurulum fonksiyonu — fikirdeş, elle de çağrılabilir
  -- ---------------------------------------------------------------------
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION lens_private.install_weekly_cron()
    RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      -- Fikirdeşlik: eski işler önce sökülür.
      PERFORM cron.unschedule(jobname) FROM cron.job
      WHERE jobname IN ('lens-generate-weekly-picks',
                        'lens-weekly-picks-digest',
                        'lens-send-weekly-picks');

      -- 1) ÜRETİM — Cuma 09:00-11:55 İstanbul, 5 dakikada bir.
      -- Kullanıcı başına ~15-25s (Claude + erişilebilirlik) ve edge function duvar saati
      -- ~150s: tek çağrıda herkesi üretmek imkânsız. 36 tik × 3 kullanıcı =
      -- 108 kişi/hafta. Boş tikte fonksiyon tek RPC ile döner, maliyeti yok.
      -- 09:00'da başlıyor ki 17:00'a kadar ~8 saat VETO PENCERESİ kalsın.
      PERFORM cron.schedule('lens-generate-weekly-picks', '*/5 6-8 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('generate-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD')),
          timeout_milliseconds := 130000);
      $job$);

      -- 2) SAHİBE ÖZET — Cuma 12:00 İstanbul. ONAY BEKLEMEZ; veto penceresidir.
      -- Hiçbir şey yapmazsan 17:00'da gider.
      PERFORM cron.schedule('lens-weekly-picks-digest', '0 9 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('generate-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'mode', 'digest',
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD')),
          timeout_milliseconds := 60000);
      $job$);

      -- 3) GÖNDERİM — Cuma 17:00 İstanbul (14:00 UTC), sonra 18:55'e kadar.
      -- 600ms Resend throttle'ı yüzünden 100 alıcı ~110s eder; parti başına 40,
      -- kalanı sonraki tik alır. 'sent' satırlar bir daha seçilmediği için tekrar
      -- mail GİTMEZ; boş tik zararsız.
      PERFORM cron.schedule('lens-send-weekly-picks', '*/5 14-15 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('send-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD'),
            'limit', 40),
          timeout_milliseconds := 130000);
      $job$);

      RETURN 'lens haftalık seçki: 3 iş kuruldu';
    END;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION lens_private.install_weekly_cron() FROM PUBLIC';

  -- ---------------------------------------------------------------------
  -- Takvim: YALNIZCA üç sır da varsa
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_secrets FROM vault.secrets
  WHERE name IN ('lens_project_url', 'lens_service_role_key', 'lens_weekly_picks_secret');

  IF v_secrets < 3 THEN
    RAISE NOTICE '[lens] Vault sırları eksik (%/3) — TAKVİM KURULMADI.', v_secrets;
    RAISE NOTICE '[lens] Lokal geliştirmede beklenen durum bu. Production''da:';
    RAISE NOTICE '[lens]   select vault.create_secret(''https://<ref>.supabase.co'', ''lens_project_url'');';
    RAISE NOTICE '[lens]   select vault.create_secret(''<service_role_key>'',        ''lens_service_role_key'');';
    RAISE NOTICE '[lens]   select vault.create_secret(''<weekly_picks_secret>'',     ''lens_weekly_picks_secret'');';
    RAISE NOTICE '[lens]   select lens_private.install_weekly_cron();';
    RETURN;
  END IF;

  PERFORM lens_private.install_weekly_cron();
  RAISE NOTICE '[lens] Zamanlama kuruldu (3 iş).';
  RAISE NOTICE '[lens] Doğrulama: select * from net._http_response order by created desc limit 5;';
END
$mig$;
