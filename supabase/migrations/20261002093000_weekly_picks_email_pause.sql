-- Haftalık seçki: ÜRETİM AÇIK, MAİL KAPALI (2026-10-02, lansman öncesi).
--
-- NE DEĞİŞTİ: `lens-send-weekly-picks` cron işi söküldü. Üretim
-- (`lens-generate-weekly-picks`) ve 12:00 özeti OLDUĞU GİBİ duruyor — seçki her
-- Cuma üretilmeye devam ediyor, `weekly_picks` satırları yazılıyor ve panelde
-- görünüyor (`fetchCurrentWeeklyPick` statüye bakmıyor, `draft` satır da görünür).
-- Gitmeyen tek şey e-posta.
--
-- ---------------------------------------------------------------------------
-- NEDEN `user_preferences` TOPLU GÜNCELLENMEDİ
-- ---------------------------------------------------------------------------
-- `update user_preferences set weekly_picks_enabled = false` iki sebeple YANLIŞ
-- kapatmadır:
--   1) Satırı OLMAYAN kullanıcı varsayılan AÇIKTIR (DEFAULT_PREFERENCES ve
--      lens_weekly_pick_candidates aynı varsayımı paylaşır). Toplu update
--      bugünkü satırları kapatır, yarın kaydolan kullanıcıyı kapatmaz.
--   2) Kullanıcının kendi tercihini EZER; lansmanda "kim gerçekten kapatmıştı"
--      bilgisi kaybolur.
-- Üstelik o tercih ÜRETİMİ de durdururdu (opt-out kullanıcı aday listesine hiç
-- girmez) — istenen bu değil.
--
-- ---------------------------------------------------------------------------
-- NEDEN SADECE `cron.unschedule` YETMİYOR
-- ---------------------------------------------------------------------------
-- `install_weekly_cron()` fikirdeş ve runbook onu çağırmayı söylüyor; çıplak bir
-- unschedule'dan sonra o fonksiyonun bir kez çağrılması gönderim işini SESSİZCE
-- geri getirirdi — ve ilk Cuma herkese mail giderdi. O yüzden kapatma bir
-- ANAHTARDA duruyor ve install onu okuyor: fonksiyon artık her zaman güvenle
-- çağrılabilir.

CREATE TABLE IF NOT EXISTS lens_private.weekly_picks_switch (
  -- Tek satır: CHECK + PK birlikte ikinci satırı imkânsız kılar.
  singleton     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lens_private.weekly_picks_switch (singleton, email_enabled, note)
VALUES (TRUE, FALSE, 'Lansman öncesi: üretim açık, mail kapalı (2026-10-02)')
ON CONFLICT (singleton) DO NOTHING;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Lokal geliştirme veritabanında beklenen durum: iş zaten kurulmamıştı.
    -- Anahtar yine de oluştu; production'a push edildiğinde orada iş görür.
    RAISE NOTICE '[lens] pg_cron yok — takvim dokunulmadı, anahtar kuruldu.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- install_weekly_cron() YENİDEN TANIMLANIYOR (20260816 sürümünün yerine).
  -- Fark tek yerde: 3. iş (gönderim) yalnızca anahtar açıkken kuruluyor.
  -- Üretim ve özet işleri birebir aynı — zamanlamaları bilerek kopyalandı,
  -- çünkü iki ayrı tanım zamanla ayrışır ve hangisinin geçerli olduğu
  -- `cron.job`'a bakmadan anlaşılmaz.
  -- -------------------------------------------------------------------------
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION lens_private.install_weekly_cron()
    RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_email BOOLEAN;
    BEGIN
      SELECT email_enabled INTO v_email
      FROM lens_private.weekly_picks_switch WHERE singleton;
      v_email := COALESCE(v_email, FALSE);   -- anahtar yoksa SESSİZCE KAPALI

      -- Fikirdeşlik: eski işler önce sökülür.
      PERFORM cron.unschedule(jobname) FROM cron.job
      WHERE jobname IN ('lens-generate-weekly-picks',
                        'lens-weekly-picks-digest',
                        'lens-send-weekly-picks');

      -- 1) ÜRETİM — Cuma 09:00-11:55 İstanbul, 5 dakikada bir. HER ZAMAN kurulur:
      -- seçki panelde gösteriliyor, mail yalnızca ikinci kanal.
      PERFORM cron.schedule('lens-generate-weekly-picks', '*/5 6-8 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('generate-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD')),
          timeout_milliseconds := 130000);
      $job$);

      -- 2) SAHİBE ÖZET — Cuma 12:00 İstanbul. Kimseye mail atmaz, JSON döndürür.
      PERFORM cron.schedule('lens-weekly-picks-digest', '0 9 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('generate-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'mode', 'digest',
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD')),
          timeout_milliseconds := 60000);
      $job$);

      IF NOT v_email THEN
        RETURN 'lens haftalık seçki: 2 iş kuruldu (üretim+özet). MAİL KAPALI — '
               'anahtar: lens_private.weekly_picks_switch.email_enabled = false';
      END IF;

      -- 3) GÖNDERİM — Cuma 17:00 İstanbul (14:00 UTC), 18:55'e kadar, 40 alıcı/tik.
      PERFORM cron.schedule('lens-send-weekly-picks', '*/5 14-15 * * 5', $job$
        SELECT net.http_post(
          url := lens_private.fn_url('send-weekly-picks'),
          headers := lens_private.fn_headers(),
          body := jsonb_build_object(
            'week', to_char((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE, 'YYYY-MM-DD'),
            'limit', 40),
          timeout_milliseconds := 130000);
      $job$);

      RETURN 'lens haftalık seçki: 3 iş kuruldu (mail AÇIK)';
    END;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION lens_private.install_weekly_cron() FROM PUBLIC';

  -- Anahtarı aç/kapat + takvimi tek adımda tazele. Lansmanda çağrılacak yer burası.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION lens_private.set_weekly_picks_email(p_on BOOLEAN, p_note TEXT DEFAULT NULL)
    RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      INSERT INTO lens_private.weekly_picks_switch (singleton, email_enabled, note, updated_at)
      VALUES (TRUE, p_on, p_note, now())
      ON CONFLICT (singleton) DO UPDATE
        SET email_enabled = EXCLUDED.email_enabled,
            note          = COALESCE(EXCLUDED.note, weekly_picks_switch.note),
            updated_at    = now();

      RETURN lens_private.install_weekly_cron();
    END;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION lens_private.set_weekly_picks_email(BOOLEAN, TEXT) FROM PUBLIC';

  -- Takvimi anahtara göre yeniden kur: gönderim işi burada düşer.
  PERFORM lens_private.install_weekly_cron();

  RAISE NOTICE '[lens] Takvim tazelendi. Kalan işler: %',
    (SELECT COALESCE(string_agg(jobname, ', ' ORDER BY jobname), '(yok)')
     FROM cron.job WHERE jobname LIKE 'lens-%');
END
$mig$;

-- ---------------------------------------------------------------------------
-- BEKLEYEN TASLAKLAR: dokunulmadı.
-- ---------------------------------------------------------------------------
-- `draft` satırlar panelde görünmeye devam ediyor ve gönderim işi artık
-- olmadığı için mail olarak çıkamazlar. `overpast` işaretlemek, "haftası geçti"
-- demek olurdu — oysa sebep bu değil; satırın dürüst hâli `draft`:
-- üretildi, gönderilmedi.
