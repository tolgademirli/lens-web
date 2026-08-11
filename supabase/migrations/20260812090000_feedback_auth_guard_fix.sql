-- GÜVENLİK DÜZELTMESİ — 20260811090000_feedback_engine.sql'deki yetki kontrolü hatalı.
--
-- HATA: p_user_id alan public fonksiyonlarda koruma şu varsayıma dayanıyordu:
--   "auth.uid() NULL ise çağıran service_role'dür (edge function)."
-- Bu YANLIŞ. `anon` rolünde de auth.uid() NULL'dır.
--
-- Sonucu: oturum açmamış biri, herkese açık anon anahtarıyla
--   POST /rest/v1/rpc/lens_blocked_works {"p_user_id": "<baskasinin id'si>"}
-- çağırıp o kullanıcının reddettiği / bildiği / listesine aldığı TÜM eserleri
-- okuyabiliyordu. user_id bulmak da zor değil: `reports` tablosunda is_public = true
-- satırlar herkese açıktır ve user_id taşır. Zincirlenebilir bir kişisel veri sızıntısı.
--
-- lens_refresh_profile_if_due ise aynı boşluktan yazma tarafına geçiyordu: anonim
-- çağıran herhangi bir kullanıcı için profil hesaplaması tetikleyebiliyor ve dönen
-- signals_until_profile değerinden o kullanıcının ne kadar geri bildirim verdiğini
-- öğrenebiliyordu.
--
-- DÜZELTME: "JWT'si yok" ile "service_role" birbirine karıştırılmaz. Rol, JWT
-- claim'inden AÇIKÇA okunur. Yetkili olmak için ya service_role olmak ya da
-- istenen satırın sahibi olmak gerekir.


-- ---------------------------------------------------------------------------
-- Ortak yetki yüklemi
-- ---------------------------------------------------------------------------
-- lens_private'te: dışarıdan çağrılmasına gerek yok, çağıranlar SECURITY DEFINER
-- olduğu için gövde sahibin haklarıyla çalışır ve buna erişebilir.
--
-- current_user KULLANILAMAZ: SECURITY DEFINER içinde her zaman fonksiyon sahibidir
-- (postgres), yani herkesi yetkili sayardı. Rol yalnızca JWT claim'inden okunur.
CREATE OR REPLACE FUNCTION lens_private.lens_may_act_for(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  -- Dıştaki COALESCE ŞART. auth.uid() NULL olduğunda `auth.uid() = p_user_id`
  -- FALSE değil NULL üretir; `false OR NULL` = NULL, `NOT NULL` = NULL ve
  -- plpgsql'de `IF NOT ... THEN` bloğu hiç çalışmaz — yani yetkisiz çağrı
  -- sessizce geçerdi. WHERE yüklemi olarak kullanıldığında NULL satırı elediği
  -- için sorun görünmez; hata yalnızca IF tarafında ortaya çıkar.
  SELECT COALESCE(
    COALESCE(
      NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
      ''
    ) = 'service_role'
    OR auth.uid() = p_user_id,
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION lens_private.lens_may_act_for(UUID) FROM PUBLIC;

COMMENT ON FUNCTION lens_private.lens_may_act_for(UUID) IS
  'p_user_id adına işlem yapılabilir mi. service_role JWT claim''inden tanınır — '
  '"auth.uid() NULL" testi anon rolünü de kapsadığı için kullanılamaz.';


-- ---------------------------------------------------------------------------
-- lens_blocked_works — sızıntının kapatılması
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lens_blocked_works(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'work_key',     b.work_key,
           'work_type',    b.work_type,
           'work_creator', b.work_creator,
           'work_title',   b.work_title,
           'why',          b.why
         )), '[]'::JSONB)
  FROM (
    SELECT DISTINCT ON (u.work_key)
           u.work_key, u.work_type, u.work_creator, u.work_title, u.why
    FROM (
      SELECT f.work_key, f.work_type, f.work_creator, f.work_title,
             CASE
               WHEN f.decision = 'known_disliked' THEN 'disliked'
               WHEN f.decision LIKE 'known_%'     THEN 'known'
               ELSE 'rejected'
             END AS why,
             f.created_at
      FROM discovery_feedback f
      WHERE f.user_id = p_user_id
        -- Yetki yüklemi: sahibi ya da service_role değilse hiçbir satır dönmez.
        AND lens_private.lens_may_act_for(p_user_id)
        AND f.superseded_by IS NULL
        AND f.decision IN ('not_interested', 'known_disliked', 'known_liked', 'known_neutral')
        AND (f.reason IS DISTINCT FROM 'mood_mismatch' OR f.defer_until > NOW())

      UNION ALL

      SELECT l.work_key, l.work_type, l.work_creator, l.work_title, 'listed' AS why,
             l.created_at
      FROM list_items l
      WHERE l.user_id = p_user_id
        AND lens_private.lens_may_act_for(p_user_id)
    ) u
    ORDER BY u.work_key, (u.why = 'disliked') DESC, u.created_at DESC
  ) b;
$$;

GRANT EXECUTE ON FUNCTION lens_blocked_works(UUID) TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- lens_refresh_profile_if_due — yazma ve sayaç sızıntısının kapatılması
-- ---------------------------------------------------------------------------
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

  SELECT COALESCE(plan, 'free') INTO v_plan FROM user_preferences WHERE user_id = p_user_id;
  v_plan := COALESCE(v_plan, 'free');

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
