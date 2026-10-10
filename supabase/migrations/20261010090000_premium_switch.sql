-- PREMIUM ANAHTARI (2026-10-10, lansman öncesi).
--
-- NE DEĞİŞTİ: paket ayrımının (free / premium) DAVRANIŞA dokunduğu her nokta tek
-- bir anahtara bağlandı: `lens_private.premium_switch.enabled`. Varsayılan KAPALI.
--
--   KAPALI -> herkes tek davranışta: 30 günlük hafıza, haftalık eksen ayarı,
--             platform filtresi yok. `user_preferences.plan` ne derse desin.
--   AÇIK   -> bu migration'dan önceki davranışın birebir aynısı.
--
-- Lansmanda premium'un satılıp satılmayacağı belli değil. Kapalı hâl bugünkü
-- ücretsiz davranıştır ve bugün herkes zaten ücretsiz — yani canlıda değişen bir
-- şey yok, yalnızca "premium" artık tek bir satırla açılıp kapanabiliyor.
--
-- AÇMA:    select lens_private.set_premium(true,  'lansman');
-- KAPATMA: select lens_private.set_premium(false, 'neden');
-- Web aynı anahtarı `lens_entitlements()` üzerinden okur; deploy gerekmez.
--
-- ---------------------------------------------------------------------------
-- NEDEN `user_preferences.plan` TOPLU GÜNCELLENMEDİ
-- ---------------------------------------------------------------------------
-- `update user_preferences set plan = 'free'` "kim premium'du" bilgisini siler ve
-- geri alınamaz. Anahtar kolonu OLDUĞU GİBİ bırakır: açıldığında herkes kendi
-- paketiyle, platform tercihiyle ve sinyal geçmişiyle kaldığı yerden döner.
-- `guard_user_preferences_plan` trigger'ı da yerinde — kolon hâlâ korunmalı.
--
-- ---------------------------------------------------------------------------
-- NEDEN DÖRT FONKSİYON YENİDEN TANIMLANDI
-- ---------------------------------------------------------------------------
-- Paketi okuyan dört yer vardı ve hepsi kolonu doğrudan okuyordu:
--   record_feedback · retract_feedback · lens_refresh_profile_if_due ·
--   lens_weekly_pick_candidates
-- Artık hepsi anahtarı bilen tek kaynaktan okuyor (`lens_private.effective_plan`
-- / `premium_enabled`). Gövdeler önceki tanımların birebir kopyası; TEK fark
-- paketin nereden geldiği. Edge function'larda paket okuyan kod yok — hepsi bu
-- fonksiyonların döndürdüğüne göre davranıyor, o yüzden deploy gerekmiyor.
--
-- Anahtar çevrildiğinde profiller TOPLU yeniden hesaplanmaz: pencere değişimi
-- her kullanıcının bir sonraki hesaplamasında (geri bildirim ya da haftalık
-- tazeleme) kendiliğinden uygulanır.


-- ===========================================================================
-- 1. Anahtar
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lens_private.premium_switch (
  -- Tek satır: CHECK + PK birlikte ikinci satırı imkânsız kılar.
  singleton  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lens_private.premium_switch (singleton, enabled, note)
VALUES (TRUE, FALSE, 'Lansman öncesi: premium kapalı, herkes tek davranışta (2026-10-10)')
ON CONFLICT (singleton) DO NOTHING;

-- Satır yoksa SESSİZCE KAPALI: yanlışlıkla silinen bir satır kimseye premium açmamalı.
CREATE OR REPLACE FUNCTION lens_private.premium_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT s.enabled FROM lens_private.premium_switch s WHERE s.singleton),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION lens_private.premium_enabled() FROM PUBLIC;

-- ETKİN paket: anahtar kapalıyken herkes 'free'. Paketi okuyan her fonksiyon
-- kolonu değil BUNU okur — kolonu doğrudan okuyan yeni bir yer anahtarı deler.
CREATE OR REPLACE FUNCTION lens_private.effective_plan(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN lens_private.premium_enabled() THEN COALESCE(
      (SELECT up.plan FROM public.user_preferences up WHERE up.user_id = p_user_id),
      'free'
    )
    ELSE 'free'
  END;
$$;

REVOKE ALL ON FUNCTION lens_private.effective_plan(UUID) FROM PUBLIC;

COMMENT ON FUNCTION lens_private.effective_plan(UUID) IS
  'Kullanıcının ETKİN paketi. Premium anahtarı kapalıyken herkes için free; '
  'açıkken user_preferences.plan (satır yoksa free).';

CREATE OR REPLACE FUNCTION lens_private.set_premium(p_on BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO lens_private.premium_switch (singleton, enabled, note, updated_at)
  VALUES (TRUE, p_on, p_note, now())
  ON CONFLICT (singleton) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        note       = COALESCE(EXCLUDED.note, premium_switch.note),
        updated_at = now();

  RETURN CASE WHEN p_on
    THEN 'lens premium: AÇIK — paket ayrımı uygulanıyor'
    ELSE 'lens premium: KAPALI — herkes tek davranışta'
  END;
END;
$$;

REVOKE ALL ON FUNCTION lens_private.set_premium(BOOLEAN, TEXT) FROM PUBLIC;


-- ===========================================================================
-- 2. lens_entitlements — web'in okuduğu yüz
-- ===========================================================================
-- lens_private PostgREST'e kapalı; web anahtarı buradan okur. Parametre ALMAZ:
-- yalnızca çağıranın kendi paketini döndürür, başkası adına sorulamaz.
-- Oturumsuz çağrıda auth.uid() NULL'dır ve paket 'free' çıkar.
--
-- `plan` ETKİN pakettir (anahtar kapalıyken herkes için 'free'), o yüzden web
-- `user_preferences.plan` kolonunu doğrudan okumamalı.
CREATE OR REPLACE FUNCTION lens_entitlements()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'premium_enabled', lens_private.premium_enabled(),
    'plan',            lens_private.effective_plan(auth.uid())
  );
$$;

-- EXECUTE yetkisi geri ALINMIYOR (PG 17.6 segfault'u). Ayrıntı: feedback_engine.sql:352-372.
GRANT EXECUTE ON FUNCTION lens_entitlements() TO anon, authenticated, service_role;

COMMENT ON FUNCTION lens_entitlements() IS
  'Çağıranın premium anahtarı durumu ve ETKİN paketi: {premium_enabled, plan}. '
  'Web''in paket okuduğu tek yer (src/lib/entitlements.ts).';


-- ===========================================================================
-- 3. record_feedback — tempo artık etkin pakete göre
-- ===========================================================================
-- 20260811090000_feedback_engine.sql'deki gövdenin kopyası. Fark: v_plan
-- user_preferences'tan değil lens_private.effective_plan'dan geliyor.
CREATE OR REPLACE FUNCTION record_feedback(
  p_work_type TEXT,
  p_title TEXT,
  p_creator TEXT,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT 'daily_discovery',
  p_daily_discovery_id UUID DEFAULT NULL,
  p_weekly_pick_id UUID DEFAULT NULL,
  p_slot TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_type    TEXT;
  v_weight  SMALLINT;
  v_key     TEXT;
  v_max     SMALLINT;
  v_winner  UUID;
  v_defer   TIMESTAMPTZ;
  v_reason  TEXT := p_reason;
  v_id      UUID;
  v_plan    TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum gerekli';
  END IF;

  -- Sinyal tipi ve ağırlık SUNUCUDA türer; client ağırlık göndermez.
  v_type := lens_signal_type(p_decision);
  v_weight := lens_signal_weight(p_decision);
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'geçersiz karar: %', p_decision;
  END IF;

  -- Neden yalnızca "ilgimi çekmedi" ile anlamlı.
  IF p_decision <> 'not_interested' THEN
    v_reason := NULL;
  END IF;

  -- "Ruh halime uymadı" ELEMEZ, 60 gün erteler.
  IF v_reason = 'mood_mismatch' THEN
    v_defer := NOW() + INTERVAL '60 days';
  END IF;

  v_key := lens_work_key(p_work_type, p_creator, p_title);

  -- ÇAKIŞMA — work_key başına TEK AKTİF SATIR invaryantı.
  SELECT MAX(weight), (array_agg(id ORDER BY weight DESC, created_at DESC))[1]
    INTO v_max, v_winner
    FROM discovery_feedback
   WHERE user_id = v_user AND work_key = v_key AND superseded_by IS NULL;

  INSERT INTO discovery_feedback (
    user_id, work_type, work_creator, work_title, decision, signal_type, weight,
    reason, defer_until, origin, daily_discovery_id, weekly_pick_id, slot, superseded_by
  ) VALUES (
    v_user, p_work_type, NULLIF(TRIM(COALESCE(p_creator, '')), ''),
    NULLIF(TRIM(COALESCE(p_title, '')), ''),
    p_decision, v_type, v_weight, v_reason, v_defer, p_origin,
    p_daily_discovery_id, p_weekly_pick_id, p_slot,
    -- Yeni sinyal mevcut kazanandan ZAYIFSA doğarken aşılmış olarak açılır:
    -- yüksek ağırlıklı kazanır, ama zayıf sinyal yine de kaydedilir.
    CASE WHEN v_max IS NOT NULL AND v_weight < v_max THEN v_winner ELSE NULL END
  ) RETURNING id INTO v_id;

  -- Yeni sinyal en az mevcut kazanan kadar güçlüyse TÜM aktif satırları kapatır.
  -- Eşitlik dahil: aynı eser hem günlük keşiften hem haftalık seçkiden 'interested'
  -- alırsa (ikisi de 1x) eskisi de kapanmalı, yoksa eksene ÇİFT katkı verirdi.
  IF v_max IS NULL OR v_weight >= v_max THEN
    UPDATE discovery_feedback
       SET superseded_by = v_id
     WHERE user_id = v_user AND work_key = v_key
       AND superseded_by IS NULL AND id <> v_id;
  END IF;

  -- Yalnızca "ilgimi çekti" listeye girer.
  -- BİLİNÇLİ KARAR: "bunu biliyorum -> sevdim" Bitirdiklerim'e GİRMEZ. Arşiv
  -- "LENS İLE bitirdiklerim" anlamını taşır; Lens önermeden önce zaten bilinen bir
  -- eser orada bir başarı kaydı değildir ve "bu yıl N eser bitirdin" bandını şişirirdi.
  IF p_decision = 'interested' THEN
    INSERT INTO list_items (
      user_id, work_type, work_creator, work_title, added_from,
      daily_discovery_id, weekly_pick_id, slot
    ) VALUES (
      v_user, p_work_type, NULLIF(TRIM(COALESCE(p_creator, '')), ''),
      NULLIF(TRIM(COALESCE(p_title, '')), ''),
      CASE WHEN p_origin IN ('daily_discovery', 'weekly_pick', 'chat', 'onboarding')
           THEN p_origin ELSE 'daily_discovery' END,
      p_daily_discovery_id, p_weekly_pick_id, p_slot
    )
    ON CONFLICT ON CONSTRAINT list_items_one_per_work DO UPDATE
      SET removed_at = NULL;
  END IF;

  -- ETKİN paket: premium anahtarı kapalıyken herkes 'free' (haftalık tempo).
  v_plan := lens_private.effective_plan(v_user);

  IF v_plan = 'premium' THEN
    -- Her geri bildirimde, sınırsız hafızayla.
    PERFORM lens_private.recompute_taste_profile(v_user, NULL);
  ELSIF NOT EXISTS (
    SELECT 1 FROM taste_profile WHERE user_id = v_user AND axes IS NOT NULL
  ) THEN
    -- Ücretsizde İLK hesaplama haftalık tempoyu beklemez.
    -- Koşul axes'in NULL'lığı, SATIR YOKLUĞU DEĞİL: eşik altı çağrılar sayaçları
    -- tazelemek için satırı zaten açıyor; "satır yok mu" koşulu 2. sinyalden itibaren
    -- hep false olur ve 5. sinyaldeki anlık hesaplama hiç çalışmazdı. O zaman da
    -- kullanıcının ilk ~14 günü tamamen sessiz kalırdı — tam da kalıp kalmayacağına
    -- karar verdiği pencere. Eşik kontrolü burada TEKRARLANMAZ, recompute içinde yaşar.
    PERFORM lens_private.recompute_taste_profile(v_user, 30);
  END IF;

  RETURN v_id;
END;
$$;

-- anon'a da EXECUTE verilir: yetkiyi geri almak izin reddi yolu açar ve o yol bu
-- Postgres'te backend'i düşürüyor. Oturumsuz çağrı gövdedeki kontrolle reddedilir.
GRANT EXECUTE ON FUNCTION record_feedback(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT)
  TO anon, authenticated, service_role;


-- ===========================================================================
-- 4. retract_feedback — pencere artık etkin pakete göre
-- ===========================================================================
-- 20260811090000_feedback_engine.sql'deki gövdenin kopyası. Fark: v_plan.
CREATE OR REPLACE FUNCTION retract_feedback(p_feedback_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_key      TEXT;
  v_decision TEXT;
  v_winner   UUID;
  v_plan     TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'oturum gerekli';
  END IF;

  DELETE FROM discovery_feedback
   WHERE id = p_feedback_id AND user_id = v_user
   RETURNING work_key, decision INTO v_key, v_decision;

  -- Sahibi değil ya da zaten yok: sessizce çık (geri alma idempotent olmalı).
  IF v_key IS NULL THEN
    RETURN;
  END IF;

  -- TEK AKTİF SATIR invaryantını yeniden kur.
  --
  -- "Ona işaret eden superseded_by'ları NULL'a çekmek" YETMEZ. Zincir:
  -- interested(1x) -> miss(5x) -> tekrar interested(1x, doğarken miss'e bağlı).
  -- miss geri alınırsa iki rezonans satırı BİRDEN aktifleşir ve eksene çift katkı
  -- verirdi — tam olarak eşit-ağırlık kuralında kapattığımız delik.
  --
  -- Sıralama record_feedback ile birebir aynı (yüksek ağırlık kazanır, eşitlikte
  -- en yeni): böylece silinen satır hiç var olmasaydı oluşacak durum üretilir.
  SELECT id INTO v_winner
    FROM discovery_feedback
   WHERE user_id = v_user AND work_key = v_key
   ORDER BY weight DESC, created_at DESC
   LIMIT 1;

  IF v_winner IS NOT NULL THEN
    UPDATE discovery_feedback SET superseded_by = NULL WHERE id = v_winner;
    UPDATE discovery_feedback SET superseded_by = v_winner
     WHERE user_id = v_user AND work_key = v_key AND id <> v_winner
       AND superseded_by IS DISTINCT FROM v_winner;
  END IF;

  -- Listeye girişi de geri al. Yalnızca 'pending': kullanıcı eseri zaten bitirdiyse
  -- kalibrasyon zinciri o satıra bağlıdır, silmek öğrenme verisini kaybettirir.
  IF v_decision = 'interested' THEN
    DELETE FROM list_items
     WHERE user_id = v_user AND work_key = v_key AND status = 'pending';
  END IF;

  -- Profil HER ZAMAN yeniden hesaplanır — pakete BAKILMAZ.
  --
  -- record_feedback'teki tempo kuralını buraya kopyalama dürtüsüne kapılma:
  -- tempo, YENİ bir sinyalin ne zaman işleneceğiyle ilgili bir paket farkıdır.
  -- Geri alma ise bir DÜZELTMEDİR ve düzeltme paket arkasına konamaz — kural
  -- "geri alınan sinyal motor hesaplamasından da çıkarılır" diyor. Ücretsizde
  -- atlanırsa silinen sinyaller haftalık ayara kadar (7 gün) profili beslemeye
  -- devam eder ve kullanıcı geri aldığı şeyin etkisini ekranda görmeye devam eder.
  --
  -- Pencere yine ETKİN pakete göre: ücretsizde 30 gün, premiumda sınırsız
  -- (premium anahtarı kapalıyken herkes 30 gün).
  v_plan := lens_private.effective_plan(v_user);

  PERFORM lens_private.recompute_taste_profile(
    v_user,
    CASE WHEN v_plan = 'premium' THEN NULL ELSE 30 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION retract_feedback(UUID) TO anon, authenticated, service_role;


-- ===========================================================================
-- 5. lens_refresh_profile_if_due — haftalık tempo artık etkin pakete göre
-- ===========================================================================
-- 20260812090000_feedback_auth_guard_fix.sql'deki gövdenin kopyası. Fark: v_plan.
-- Anahtar kapalıyken `plan = 'premium'` satırı olan kullanıcı da haftalık
-- tazelemeye girer — aksi halde profili hiç güncellenmezdi (premium'un anlık
-- hesaplaması record_feedback'te ve o da kapalı).
CREATE OR REPLACE FUNCTION lens_refresh_profile_if_due(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan      TEXT;
  v_axes      JSONB;
  v_computed  TIMESTAMPTZ;
  v_total     NUMERIC;
  v_refreshed BOOLEAN := FALSE;
BEGIN
  IF NOT lens_private.lens_may_act_for(p_user_id) THEN
    RAISE EXCEPTION 'yetkisiz istek';
  END IF;

  v_plan := lens_private.effective_plan(p_user_id);

  SELECT tp.axes, tp.computed_at INTO v_axes, v_computed
  FROM taste_profile tp WHERE tp.user_id = p_user_id;

  -- Premium'da hesaplama zaten her geri bildirimde record_feedback içinde yapıldı.
  IF v_plan = 'free' AND (v_computed IS NULL OR NOW() - v_computed >= INTERVAL '7 days') THEN
    PERFORM lens_private.recompute_taste_profile(p_user_id, 30);
    v_refreshed := TRUE;
  END IF;

  SELECT tp.axes, tp.signal_weight_total INTO v_axes, v_total
  FROM taste_profile tp WHERE tp.user_id = p_user_id;

  RETURN jsonb_build_object(
    'profile_refreshed', v_refreshed AND v_axes IS NOT NULL,
    'signals_until_profile', GREATEST(0, 5 - COALESCE(v_total, 0))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION lens_refresh_profile_if_due(UUID) TO anon, authenticated, service_role;


-- ===========================================================================
-- 6. lens_weekly_pick_candidates — platform filtresi artık anahtara da bağlı
-- ===========================================================================
-- 20260815090000_weekly_picks_automation.sql'deki gövdenin kopyası. Fark:
-- `platforms` yalnızca premium anahtarı AÇIK ve plan = 'premium' iken döner.
-- Plan kapısının TEK noktası hâlâ burası; anahtar kapalıyken üreticinin eline
-- herkes için NULL geçer, yani erişilebilirlik API'si HİÇ çağrılmaz.
CREATE OR REPLACE FUNCTION lens_weekly_pick_candidates(
  p_week DATE,
  p_limit INT DEFAULT 25,
  p_only_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Bir kez okunur: satır başına fonksiyon çağrısı yerine tek değer.
  v_premium BOOLEAN := lens_private.premium_enabled();
BEGIN
  -- Koruma yetkide DEĞİL gövdede (PG 17.6 notu). auth.uid() burada İŞE YARAMAZ:
  -- anon anahtarında da NULL'dır ve o anahtar istemci paketinde açıkta. Bu yüzden
  -- ROL doğrudan JWT claim'inden okunur.
  --
  -- Reddi exception değil BOŞ LİSTE ile ifade ediyoruz: bu fonksiyon tüm
  -- kullanıcıların id'sini döndürüyor, yetkisiz çağırana hata mesajıyla bile
  -- "burada bir şey var" demeye gerek yok.
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
       ''
     ) <> 'service_role' THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'user_id',   c.user_id,
             'report_id', c.report_id,
             'platforms', c.platforms
           ) ORDER BY c.last_report DESC), '[]'::JSONB)
    FROM (
      SELECT lr.user_id,
             lr.report_id,
             lr.last_report,
             CASE WHEN v_premium AND p.plan = 'premium' THEN p.platforms ELSE NULL END AS platforms
      FROM (
        SELECT r.user_id,
               (array_agg(r.id ORDER BY r.created_at DESC))[1] AS report_id,
               MAX(r.created_at) AS last_report
        FROM reports r
        WHERE r.user_id IS NOT NULL
          AND (p_only_user_id IS NULL OR r.user_id = p_only_user_id)
          AND NOT EXISTS (
            SELECT 1 FROM weekly_picks w
            WHERE w.user_id = r.user_id AND w.week = p_week
          )
        GROUP BY r.user_id
      ) lr
      LEFT JOIN user_preferences p ON p.user_id = lr.user_id
      -- Satır yoksa varsayılan AÇIK. Yalnızca açıkça false olan elenir.
      WHERE COALESCE(p.weekly_picks_enabled, TRUE)
      ORDER BY lr.last_report DESC
      LIMIT GREATEST(p_limit, 0)
    ) c
  );
END;
$$;

-- EXECUTE yetkisi geri ALINMIYOR (PG 17.6 segfault'u); koruma gövdedeki rol
-- denetiminde. Ayrıntı: feedback_engine.sql:352-372.
GRANT EXECUTE ON FUNCTION lens_weekly_pick_candidates(DATE, INT, UUID)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION lens_weekly_pick_candidates(DATE, INT, UUID) IS
  'Verilen hafta için seçki üretilecek kullanıcılar. Yalnızca service_role''e '
  'yanıt verir; başka rollere boş dizi döner. Opt-out ve zaten üretilmiş '
  'kullanıcılar listeye hiç girmez. platforms yalnızca premium anahtarı açık VE '
  'paket premium iken döner (aksi halde NULL = filtre yok, erişilebilirlik '
  'API''si hiç çağrılmaz).';
