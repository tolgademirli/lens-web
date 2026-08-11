-- US-05 — Geri bildirim sistemi ve öneri motorunun beslenmesi
--
-- Model: "Sinyal defteri append-only, profil türetilmiş".
--   discovery_feedback = kullanıcının keşif kartlarına verdiği her sinyal. ÜZERİNE YAZILMAZ.
--   list_items         = "Listem" (Bekleyenler / Bitirdiklerim).
--   taste_profile      = biriken ağırlıklı sinyallerden TÜRETİLEN eksen profili. Kaybolursa
--                        defterden yeniden hesaplanabilir; defter kaybolursa hiçbir şey geri gelmez.
--
-- En kritik iş kuralı ağırlıklandırmadır. Üç sinyal tipi asla eşit işlenmez:
--   rezonans (1x)   — "ilgimi çekti/çekmedi". TÜKETİM ÖNCESİ verilir: kullanıcı aslında kartta
--                     yazan gerekçenin ikna gücünü oylar, eseri değil.
--   zevk (3x)       — "bunu biliyorum -> sevdim/sevmedim".
--   kalibrasyon (5x)— "bitirdim -> isabet miydi".
-- Eşitlenirse motor "daha isabetli eser seçmeyi" değil "daha ikna edici blurb yazmayı" öğrenir.
-- Rezonans bol ve ucuz üretilir; 50 zayıf sinyal 3 güçlü sinyali bastırır.
--
-- Geriye dönük uyumluluk: mevcut hiçbir tablo bozulmuyor. daily_discoveries'e yalnızca `items`
-- kolonu, user_preferences'a yalnızca `plan` kolonu ekleniyor; eski kolonlar aynen okunmaya devam.


-- ===========================================================================
-- 1. lens_work_key — eser kimliği
-- ===========================================================================
-- Bu fonksiyon özelliğin en yüksek pratik riskini kapatır.
--
-- Anahtar, LLM'in HER GÜN YENİDEN ÜRETTİĞİ serbest metne dayanıyor. Bugün
-- "Fargo (Dizi)", yarın "Fargo" gelirse anahtar tutmaz, "tekrar önerme" filtresi
-- SESSİZCE delinir ve kullanıcı az önce reddettiği eseri tekrar görür — özelliğin
-- güvenini tek başına yıkabilecek senaryo budur. lower(trim(...)) yetmez.

CREATE OR REPLACE FUNCTION lens_name_key(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    lower(
      -- 2) Diyakritikleri KATLA. lower()'dan ÖNCE, çünkü katlamanın kendisi
      --    locale'e bağlı olmamalı.
      --
      --    Noktasız büyük "I" haritada olmak ZORUNDA: Türkçe collation altında
      --    lower('I') = 'ı' ve 'ı' [a-z] dışında kaldığı için 3. adımda silinir.
      --    Somut sonuç: "Into the Wild" -> "ntothewild". Ekrandaki gerçek bir eser.
      translate(
        -- 1) Parantezli ekleri at: "Fargo (Dizi)" = "Fargo"
        regexp_replace(COALESCE(p_raw, ''), '\s*\([^)]*\)', '', 'g'),
        'çÇğĞıİöÖşŞüÜâÂîÎûÛI',
        'ccggiioossuuaaiiuui'
      )
      -- 3) Collation'ı da açıkça sabitle. lower() Postgres'te IMMUTABLE işaretlidir
      --    AMA locale'e duyarlıdır; tam olarak bu yüzden sessiz bir bombadır.
      COLLATE "C"
    ),
    -- 4) Alfanümerik olmayan her şeyi sil: "J.D. Salinger" = "jdsalinger"
    '[^a-z0-9]', '', 'g'
  );
$$;

CREATE OR REPLACE FUNCTION lens_work_key(p_type TEXT, p_creator TEXT, p_title TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_type || '|' || lens_name_key(p_creator) || '|' || lens_name_key(p_title);
$$;

COMMENT ON FUNCTION lens_work_key(TEXT, TEXT, TEXT) IS
  'Eser kimliği. discovery_feedback ve list_items''ta GENERATED kolon olarak kullanılır — '
  'hesaplama client''a ya da RPC''ye bırakılmaz ki iki tarafın normalizasyonu ayrışamasın.';


-- ===========================================================================
-- 2. Karar sözlüğü — sinyal tipi, ağırlık, valans
-- ===========================================================================
-- AĞIRLIK ve VALANS ayrı şeylerdir:
--   ağırlık = güven kütlesi (eşiğe ve hafızaya ne kadar sayılır)
--   valans  = yön ve şiddet (profili ne kadar sert çeker)
-- "partial" (kısmen isabet) tam kalibrasyon kütlesiyle sayılır ama ekseni "hit"in
-- yarısı kadar çeker. "known_neutral" kütle katar, ekseni hiç oynatmaz.

CREATE OR REPLACE FUNCTION lens_signal_type(p_decision TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_decision
    WHEN 'interested'      THEN 'resonance'
    WHEN 'not_interested'  THEN 'resonance'
    WHEN 'known_liked'     THEN 'taste'
    WHEN 'known_disliked'  THEN 'taste'
    WHEN 'known_neutral'   THEN 'taste'
    WHEN 'hit'             THEN 'calibration'
    WHEN 'partial'         THEN 'calibration'
    WHEN 'miss'            THEN 'calibration'
  END;
$$;

CREATE OR REPLACE FUNCTION lens_signal_weight(p_decision TEXT)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lens_signal_type(p_decision)
    WHEN 'resonance'   THEN 1
    WHEN 'taste'       THEN 3
    WHEN 'calibration' THEN 5
  END::SMALLINT;
$$;

CREATE OR REPLACE FUNCTION lens_signal_valence(p_decision TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_decision
    WHEN 'interested'     THEN  1.0
    WHEN 'not_interested' THEN -1.0
    WHEN 'known_liked'    THEN  1.0
    WHEN 'known_neutral'  THEN  0.0
    WHEN 'known_disliked' THEN -1.0
    WHEN 'hit'            THEN  1.0
    WHEN 'partial'        THEN  0.5
    WHEN 'miss'           THEN -1.0
  END::NUMERIC;
$$;


-- ===========================================================================
-- 3. discovery_feedback — append-only sinyal defteri
-- ===========================================================================
CREATE TABLE IF NOT EXISTS discovery_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Önerilen eser user_works'e YAZILMAZ: havuz kullanıcının zevk girdisidir,
  -- tüketilmemiş bir öneri değil. Oraya yazmak sonraki raporu sessizce zehirlerdi.
  work_type     TEXT NOT NULL CHECK (work_type IN ('book', 'film', 'song')),
  work_creator  TEXT,
  work_title    TEXT,
  work_key      TEXT GENERATED ALWAYS AS
                (lens_work_key(work_type, work_creator, work_title)) STORED,

  decision      TEXT NOT NULL CHECK (decision IN (
                  'interested', 'not_interested',
                  'known_liked', 'known_disliked', 'known_neutral',
                  'hit', 'partial', 'miss')),
  signal_type   TEXT NOT NULL CHECK (signal_type IN ('resonance', 'taste', 'calibration')),

  -- Türetilmez, SAKLANIR: ileride ağırlıklar değişirse geçmiş satırlar bozulmasın.
  weight        SMALLINT NOT NULL,

  reason        TEXT CHECK (reason IN ('too_dark', 'too_popular', 'mood_mismatch', 'genre_mismatch')),

  -- "Ruh halime uymadı" eseri ELEMEZ, erteler. Ayrı kuyruk tablosu yok:
  -- kuyruk zaten bu kolonun kendisi.
  defer_until   TIMESTAMPTZ,

  origin        TEXT NOT NULL CHECK (origin IN
                ('daily_discovery', 'weekly_pick', 'chat', 'onboarding')),

  -- ON DELETE SET NULL bilinçli: sinyal, onu doğuran kartı AŞMALI. CASCADE olsaydı
  -- eski bir keşif satırı temizlendiğinde motorun hafızası sessizce silinirdi.
  daily_discovery_id UUID REFERENCES daily_discoveries(id) ON DELETE SET NULL,
  weekly_pick_id     UUID REFERENCES weekly_picks(id) ON DELETE SET NULL,
  slot          TEXT,

  -- Çakışma kaydı. Dolu satır "bu sinyal daha güçlü bir sinyalle aşıldı" demektir —
  -- SİLİNMİŞ demek değildir. "İlgimi çekti -> bitirdim -> isabet değildi" zinciri
  -- motorun kendi öngörü hatasını görebildiği TEK veridir.
  superseded_by UUID REFERENCES discovery_feedback(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT discovery_feedback_needs_name
    CHECK (work_creator IS NOT NULL OR work_title IS NOT NULL)
);

-- Yasak küme ve çakışma sorgusunun tam eriştiği yol.
CREATE INDEX IF NOT EXISTS discovery_feedback_user_work_idx
  ON discovery_feedback (user_id, work_key);

CREATE INDEX IF NOT EXISTS discovery_feedback_user_created_idx
  ON discovery_feedback (user_id, created_at DESC);

-- Erteleme kuyruğu küçük bir azınlık; kısmi indeks yeterli.
CREATE INDEX IF NOT EXISTS discovery_feedback_defer_idx
  ON discovery_feedback (user_id, defer_until) WHERE defer_until IS NOT NULL;

ALTER TABLE discovery_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own feedback" ON discovery_feedback;
CREATE POLICY "Users see own feedback" ON discovery_feedback
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE policy'si YOK — bilerek. Yazma yalnızca aşağıdaki RPC'lerden.
-- Doğrudan INSERT açılsaydı client kendi ağırlığını seçebilir, 50 rezonansı 5x
-- ağırlıkla yollayabilirdi. Ağırlık sunucuda kararlardan türer.


-- ===========================================================================
-- 4. list_items — "Listem"
-- ===========================================================================
CREATE TABLE IF NOT EXISTS list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  work_type     TEXT NOT NULL CHECK (work_type IN ('book', 'film', 'song')),
  work_creator  TEXT,
  work_title    TEXT,
  -- discovery_feedback ile AYNI fonksiyondan türer; iki taraf ayrışamaz.
  work_key      TEXT GENERATED ALWAYS AS
                (lens_work_key(work_type, work_creator, work_title)) STORED,

  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),

  -- Bitirdiklerim'deki rozet. Yanıt sonrası öğe SİLİNMEZ, arşive geçer.
  hit_result    TEXT CHECK (hit_result IN ('hit', 'partial', 'miss')),

  added_from    TEXT NOT NULL CHECK (added_from IN
                ('daily_discovery', 'weekly_pick', 'chat', 'onboarding')),
  daily_discovery_id UUID REFERENCES daily_discoveries(id) ON DELETE SET NULL,
  weekly_pick_id     UUID REFERENCES weekly_picks(id) ON DELETE SET NULL,
  slot          TEXT,

  completed_at  TIMESTAMPTZ,

  -- SOFT delete. Satır gerçekten silinseydi eser tekrar önerilebilir hale gelirdi;
  -- kural "listeye eklenen eser tekrar önerilmez" diyor. Kullanıcı listeden çıkarır,
  -- motor unutmaz.
  removed_at    TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Aynı eser hem günlük keşiften hem haftalık seçkiden gelirse çift satır olmasın.
  CONSTRAINT list_items_one_per_work UNIQUE (user_id, work_key),
  CONSTRAINT list_items_needs_name
    CHECK (work_creator IS NOT NULL OR work_title IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS list_items_user_status_idx
  ON list_items (user_id, status, created_at DESC);

ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;

-- Listem eylemleri düz tablo yazımı — burada türetilecek bir ağırlık yok, RPC gerekmez.
DROP POLICY IF EXISTS "Users see own list" ON list_items;
CREATE POLICY "Users see own list" ON list_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own list" ON list_items;
CREATE POLICY "Users insert own list" ON list_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own list" ON list_items;
CREATE POLICY "Users update own list" ON list_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- DELETE policy YOK — çıkarma removed_at ile (yukarıdaki soft delete notu).


-- ===========================================================================
-- 5. taste_profile — eksen ayarının çıktısı
-- ===========================================================================
CREATE TABLE IF NOT EXISTS taste_profile (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- {tone, popularity, era}, her biri [-1, 1]:
  --   tone       -1 aydınlık .. +1 karanlık
  --   popularity -1 niş      .. +1 popüler
  --   era        -1 klasik   .. +1 çağdaş
  -- NULL = henüz eşik dolmadı, profil hiç yazılmadı. Ücretsiz kullanıcının ilk
  -- anlık hesaplaması bu kolonun NULL'lığına bakar (satır varlığına DEĞİL —
  -- eşik altı çağrılar satırı zaten açıyor).
  axes          JSONB,

  -- {"<tür>": ağırlık}. "Türü bana göre değil" burayı kalıcı olarak aşağı çeker.
  genre_weights JSONB,

  -- Bayatlama sonrası toplam ağırlık. Eksen ayarı eşiği (5) buna bakar.
  signal_weight_total NUMERIC NOT NULL DEFAULT 0,

  -- Arketip revizyonu eşiği (15) için sayaç. BU İTERASYONDA OKUNMUYOR —
  -- US-07/US-09'un (drift uyarısı, evrim kartı) girdisi olarak birikiyor.
  calibration_weight_total NUMERIC NOT NULL DEFAULT 0,

  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_through TIMESTAMPTZ
);

ALTER TABLE taste_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own taste profile" ON taste_profile;
CREATE POLICY "Users see own taste profile" ON taste_profile
  FOR SELECT USING (auth.uid() = user_id);

-- Yazma policy'si YOK — profil türetilmiş veridir, elle yazılmaz.


-- ===========================================================================
-- 6. daily_discoveries.items — yapılandırılmış öneri
-- ===========================================================================
-- [{slot, title, creator, reason, genre, tone, popularity, era}]
-- tone/popularity/era [-1,1] normalize; genre kısa etiket.
--
-- Bu etiketler EKSEN AYARININ GİRDİSİDİR: "Fazla karanlık" tek başına yönü verir,
-- ama olumlu bir sinyalin (sevdim / isabetliydi) profili hangi yöne çekeceği
-- ancak eserin kendi etiketlerinden okunabilir.
--
-- book/film/music TEXT kolonları DEĞİŞMİYOR: Telegram botu ve eski satırlar
-- okumaya devam eder. Client önce items'a bakar, yoksa eski string'i böler.
ALTER TABLE daily_discoveries ADD COLUMN IF NOT EXISTS items JSONB;


-- ===========================================================================
-- 7. user_preferences.plan — paket
-- ===========================================================================
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_plan_check;
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_plan_check
  CHECK (plan IN ('free', 'premium'));

-- GÜVENLİK: user_preferences'ın mevcut UPDATE policy'si WITH CHECK (auth.uid() = user_id).
-- Yani kullanıcı KENDİ satırını yazabiliyor — plan kolonu korunmasaydı herkes tek
-- UPDATE ile kendini premium yapabilirdi. Policy'yi daraltmak yerine trigger:
-- haftalık seçki toggle'ının upsert'i (setWeeklyPicksEnabled) bozulmadan çalışsın.
CREATE OR REPLACE FUNCTION guard_user_preferences_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Kilit YALNIZCA client rolleri için. service_role (edge function), postgres
  -- (SQL Editor) ve bakım rolleri planı yazabilmeli — aksi halde ödeme akışının
  -- (US-08) yazacağı yol da kapanırdı.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.plan := 'free';
  ELSE
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_preferences_guard_plan ON user_preferences;
CREATE TRIGGER user_preferences_guard_plan
  BEFORE INSERT OR UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION guard_user_preferences_plan();


-- ===========================================================================
-- 8. Eksen ayarı
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- lens_private — API'ye AÇILMAYAN şema
-- ---------------------------------------------------------------------------
-- PostgreSQL 17.6'da GERÇEK BİR HATA var: EXECUTE yetkisi olmayan bir rol,
-- IMMUTABLE OLMAYAN (STABLE/VOLATILE) bir fonksiyonu çağırdığında backend
-- "permission denied" döndürmek yerine SEGFAULT ediyor ve veritabanı crash
-- recovery'ye giriyor. Üç satırlık `RETURNS INT LANGUAGE sql STABLE ... SELECT 1`
-- gövdesiyle de yeniden üretilir; bu kodun içeriğiyle ilgisi yoktur.
-- (IMMUTABLE fonksiyonlarda ve ŞEMA seviyesindeki USAGE reddinde sorun yok.)
--
-- Sonucu bizim için ciddi: public şemadaki her fonksiyon PostgREST üzerinden
-- /rest/v1/rpc/<ad> olarak çağrılabilir. Yani "yetkiyi geri al" savunması, oturumu
-- olan HERHANGİ bir kullanıcının tek istekle veritabanını düşürmesi demek olurdu.
--
-- BU YÜZDEN KURAL ŞU:
--   1) public şemadaki IMMUTABLE olmayan her fonksiyona EXECUTE yetkisi VERİLİR
--      (anon dahil) — izin reddi yolu hiç oluşmasın diye. Koruma yetkiyle değil,
--      gövdedeki auth.uid() DENETİMİYLE sağlanır.
--   2) Kimsenin çağırmaması gereken şeyler public'te DURMAZ; API'ye açılmayan
--      bu şemada durur. PostgREST lens_private'i hiç görmez, `authenticated`
--      şemaya USAGE alamaz ve şema reddi güvenli şekilde hata döndürür.
--
-- Buradaki bir fonksiyonu public'e taşımadan ya da public'te bir fonksiyondan
-- yetki geri almadan önce yukarıyı tekrar oku.
CREATE SCHEMA IF NOT EXISTS lens_private;
REVOKE ALL ON SCHEMA lens_private FROM PUBLIC;
GRANT USAGE ON SCHEMA lens_private TO postgres, service_role;

-- Aktif sinyaller, bayatlaması ve valansı uygulanmış hâlde. Hem eksen hesabı hem
-- eşik sayacı bu tek kaynaktan okur — iki yerde ayrı ayrı hesaplanırsa ayrışırlar.
CREATE OR REPLACE FUNCTION lens_private.lens_active_signals(
  p_user_id UUID, p_window_days INT DEFAULT NULL)
RETURNS TABLE (
  eff_weight  NUMERIC,
  valence     NUMERIC,
  signal_type TEXT,
  reason      TEXT,
  tags        JSONB,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- BAYATLAMA: rezonans 90 günde ağırlığının yarısına iner (ilk izlenim hızlı değişir).
    -- Zevk ve kalibrasyon KALICIDIR (zevk yavaş değişir).
    --
    -- İSTİSNA: reason = 'genre_mismatch' bayatlamaz. Tür reddi bir ilk izlenim değil,
    -- KALICI bir tercih beyanıdır — kural "tür ağırlığı kalıcı düşer" diyor, ama karar
    -- rezonans satırında taşındığı için bayatlama muafiyeti olmadan 90 günde yarılanırdı.
    -- Yaş TAM GÜN olarak alınır (floor). Saniye çözünürlüğü kullanılsaydı az önce
    -- verilmiş bir sinyal 1 değil 0.99999999 ederdi ve 5 taze rezonans toplamı
    -- 4.9999999954'te kalıp eşiği GEÇEMEZDİ — kullanıcı 5 geri bildirim verir,
    -- hiçbir şey olmaz. Gün çözünürlüğü kuralın ifadesiyle de birebir aynı:
    -- "90 günde yarıya iner". Bugünkü sinyal tam 1, 90 günlük sinyal tam 0.5.
    --
    -- power() double precision döner; fonksiyonun dönüş tipi NUMERIC olduğu için
    -- açıkça cast ediyoruz — örtük dönüşüm "return type mismatch"e açık kapı bırakır.
    CASE
      WHEN f.signal_type = 'resonance' AND f.reason IS DISTINCT FROM 'genre_mismatch'
        THEN (f.weight * power(
                0.5,
                floor(EXTRACT(EPOCH FROM (NOW() - f.created_at)) / 86400.0) / 90.0
              ))::NUMERIC
      ELSE f.weight::NUMERIC
    END,
    lens_signal_valence(f.decision),
    f.signal_type,
    f.reason,
    tag.item,
    f.created_at
  FROM discovery_feedback f
  -- Eserin kendi etiketleri: yalnızca günlük keşiften gelenlerde var. Haftalık seçki
  -- manuel küre edildiği için etiketsizdir — o satırlar yalnızca neden tabanlı ayar yapar.
  LEFT JOIN LATERAL (
    SELECT i AS item
    FROM daily_discoveries d
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::JSONB)) AS i
    WHERE d.id = f.daily_discovery_id AND i->>'slot' = f.slot
    LIMIT 1
  ) tag ON TRUE
  WHERE f.user_id = p_user_id
    -- Çakışmada yüksek ağırlıklı kazanır: aşılmış satırlar hesaba GİRMEZ ama
    -- tabloda durmaya devam eder (hata kaydı).
    AND f.superseded_by IS NULL
    AND (p_window_days IS NULL OR f.created_at >= NOW() - make_interval(days => p_window_days));
$$;

REVOKE ALL ON FUNCTION lens_private.lens_active_signals(UUID, INT) FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- recompute_taste_profile
-- ---------------------------------------------------------------------------
-- p_window_days: hafıza penceresi. NULL = sınırsız (premium), 30 = ücretsiz.
--
-- lens_private'te: p_user_id parametresi aldığı için public'te olsaydı bir kullanıcı
-- başkasının profilini tetikleyebilirdi; yetkiyi geri almak ise (yukarıdaki PG hatası
-- yüzünden) çökme vektörü açardı. Dışarıya açılan yüzü lens_refresh_profile_if_due.
CREATE OR REPLACE FUNCTION lens_private.recompute_taste_profile(
  p_user_id UUID,
  p_window_days INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   NUMERIC := 0;
  v_calib   NUMERIC := 0;
  v_alltime NUMERIC := 0;
  v_through TIMESTAMPTZ;
  v_axes    JSONB;
  v_genres  JSONB;
BEGIN
  -- YÖNLÜ ağırlık toplanır: valansı 0 olan sinyaller (known_neutral = "kararsızım")
  -- eşiğe SAYILMAZ. Eşiğin amacı "profili değiştirecek kadar kanıt var mı" sorusudur
  -- ve kararsızlık bir yön kanıtı değildir. Sayılsaydı iki "kararsızım" 6 ağırlıkla
  -- eşiği açar, profil "hesaplandı" sayılır ama içinde tek bir yön bulunmazdı.
  -- Karttaki sayaç da bu değerden okunur; ikisi ayrışmamalı.
  SELECT COALESCE(SUM(s.eff_weight) FILTER (WHERE s.valence <> 0), 0),
         COALESCE(SUM(s.eff_weight) FILTER (WHERE s.signal_type = 'calibration'), 0),
         MAX(s.created_at)
    INTO v_total, v_calib, v_through
    FROM lens_private.lens_active_signals(p_user_id, p_window_days) s;

  -- EŞİK: 5 ağırlıklı sinyalin altında YENİ profil yazılmaz. Az veriyle sallanan
  -- profil kullanıcıya "beni tanımıyor" hissi verir. Sayaçlar yine de tazelenir ki
  -- "kaç sinyal kaldı" göstergesi ilerlesin.
  IF v_total < 5 THEN
    -- Eşik altına NEDEN düştük? İki hâli ayırmak şart:
    --   a) Sinyaller pencerenin dışında kaldı (defter hâlâ dolu) -> kullanıcı bir
    --      süre sessiz kalmış demektir; mevcut profili SİLMEK haksız olur.
    --   b) Defterde de yeterli sinyal yok -> sinyaller geri ALINMIŞ demektir ve
    --      profil dayanaksız kalır; "geri alınan sinyal motor hesaplamasından da
    --      çıkarılır" kuralı gereği temizlenmeli. Aksi halde kullanıcı geri aldığı
    --      şeyin etkisini önerilerde görmeye devam ederdi.
    SELECT COALESCE(SUM(s.eff_weight) FILTER (WHERE s.valence <> 0), 0) INTO v_alltime
      FROM lens_private.lens_active_signals(p_user_id, NULL) s;

    INSERT INTO taste_profile (user_id, signal_weight_total, calibration_weight_total,
                               computed_at, computed_through)
    VALUES (p_user_id, v_total, v_calib, NOW(), v_through)
    ON CONFLICT (user_id) DO UPDATE
      SET signal_weight_total = EXCLUDED.signal_weight_total,
          calibration_weight_total = EXCLUDED.calibration_weight_total,
          axes = CASE WHEN v_alltime < 5 THEN NULL ELSE taste_profile.axes END,
          genre_weights = CASE WHEN v_alltime < 5 THEN NULL ELSE taste_profile.genre_weights END,
          computed_at = EXCLUDED.computed_at,
          computed_through = EXCLUDED.computed_through;
    RETURN;
  END IF;

  -- Eksenler. Katkı = ağırlık x bayatlama x valans.
  --   * Eserin kendi etiketinden: valans negatifse eser NE İSE ONUN TERSİNE çeker.
  --   * Nedenden: "fazla karanlık" tonu aydınlığa, "çok popüler" popülerliği nişe.
  --   * "Ruh halime uymadı" eksene HİÇ katkı vermez — eser elenmiyor, erteleniyor.
  WITH sig AS (
    SELECT * FROM lens_private.lens_active_signals(p_user_id, p_window_days)
  ), tagged AS (
    -- Etiketli ve eksene katkı verebilecek satırlar. "Ruh halime uymadı" burada
    -- elenir: eser reddedilmiyor, erteleniyor — profili değiştirmemeli.
    SELECT * FROM sig
    WHERE valence <> 0 AND tags IS NOT NULL
      AND reason IS DISTINCT FROM 'mood_mismatch'
  ), pulls AS (
    SELECT 'tone' AS axis,
           eff_weight * valence * (tags->>'tone')::NUMERIC AS num,
           eff_weight * abs(valence) AS den
    FROM tagged WHERE tags ? 'tone'
    UNION ALL
    SELECT 'popularity',
           eff_weight * valence * (tags->>'popularity')::NUMERIC,
           eff_weight * abs(valence)
    FROM tagged WHERE tags ? 'popularity'
    UNION ALL
    SELECT 'era',
           eff_weight * valence * (tags->>'era')::NUMERIC,
           eff_weight * abs(valence)
    FROM tagged WHERE tags ? 'era'
    UNION ALL
    -- Neden tabanlı ayar: etiket gerekmez, yön nedenin kendisinde. Haftalık seçkiden
    -- gelen (etiketsiz) sinyaller motoru ancak bu yoldan besler.
    SELECT 'tone', eff_weight * -1, eff_weight
    FROM sig WHERE reason = 'too_dark'
    UNION ALL
    SELECT 'popularity', eff_weight * -1, eff_weight
    FROM sig WHERE reason = 'too_popular'
  )
  SELECT jsonb_object_agg(axis, value)
    INTO v_axes
    FROM (
      SELECT axis,
             round(greatest(-1, least(1, SUM(num) / NULLIF(SUM(den), 0))), 3) AS value
      FROM pulls
      GROUP BY axis
      HAVING SUM(den) > 0
    ) a;

  -- Tür ağırlıkları. genre_mismatch satırları valansı -1 olduğu için doğal olarak
  -- buraya negatif düşer ve bayatlamadıkları için kalıcı kalır.
  SELECT jsonb_object_agg(genre, weight)
    INTO v_genres
    FROM (
      SELECT s.tags->>'genre' AS genre,
             round(SUM(s.eff_weight * s.valence), 3) AS weight
      FROM lens_private.lens_active_signals(p_user_id, p_window_days) s
      WHERE s.valence <> 0
        AND COALESCE(s.tags->>'genre', '') <> ''
        AND s.reason IS DISTINCT FROM 'mood_mismatch'
      GROUP BY 1
    ) g;

  INSERT INTO taste_profile (user_id, axes, genre_weights, signal_weight_total,
                             calibration_weight_total, computed_at, computed_through)
  VALUES (p_user_id, COALESCE(v_axes, '{}'::JSONB), COALESCE(v_genres, '{}'::JSONB),
          v_total, v_calib, NOW(), v_through)
  ON CONFLICT (user_id) DO UPDATE
    SET axes = EXCLUDED.axes,
        genre_weights = EXCLUDED.genre_weights,
        signal_weight_total = EXCLUDED.signal_weight_total,
        calibration_weight_total = EXCLUDED.calibration_weight_total,
        computed_at = EXCLUDED.computed_at,
        computed_through = EXCLUDED.computed_through;
END;
$$;

REVOKE ALL ON FUNCTION lens_private.recompute_taste_profile(UUID, INT) FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- lens_refresh_profile_if_due — eksen ayarının DIŞARIYA açılan tek yüzü
-- ---------------------------------------------------------------------------
-- Ücretsiz paketin HAFTALIK toplu ayarı. Cron yok: haftanın ilk keşfi hesaplamayı
-- kendisi tetikler. Premium'da hesaplama zaten her geri bildirimde record_feedback
-- içinde yapıldığı için burada tekrarlanmaz.
--
-- Tempo kuralı bilerek SQL'de: edge function'da yaşasaydı, bu fonksiyon istemciye
-- açık olduğu için ücretsiz bir kullanıcı üst üste çağırıp haftalık tempoyu
-- atlayabilirdi. Burada kural çağrının kendisinde.
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
  -- Koruma yetkide değil BURADA: fonksiyon herkese açık olmak zorunda (bkz. PG
  -- 17.6 notu), o yüzden başkasının verisine erişimi gövde reddeder.
  -- service_role'de auth.uid() NULL'dır ve edge function bu yoldan geçer.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'baska kullanicinin profili istenemez';
  END IF;

  SELECT COALESCE(plan, 'free') INTO v_plan FROM user_preferences WHERE user_id = p_user_id;
  v_plan := COALESCE(v_plan, 'free');

  SELECT tp.axes, tp.computed_at INTO v_axes, v_computed
  FROM taste_profile tp WHERE tp.user_id = p_user_id;

  IF v_plan = 'free' AND (v_computed IS NULL OR NOW() - v_computed >= INTERVAL '7 days') THEN
    PERFORM lens_private.recompute_taste_profile(p_user_id, 30);
    v_refreshed := TRUE;
  END IF;

  SELECT tp.axes, tp.signal_weight_total INTO v_axes, v_total
  FROM taste_profile tp WHERE tp.user_id = p_user_id;

  RETURN jsonb_build_object(
    -- İşaret yalnızca profil GERÇEKTEN yazıldıysa: eşik altında hesaplama çalışsa
    -- da ortada bir ayar yok, "güncellendi" demek yanıltıcı olur.
    'profile_refreshed', v_refreshed AND v_axes IS NOT NULL,
    'signals_until_profile', GREATEST(0, 5 - COALESCE(v_total, 0))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION lens_refresh_profile_if_due(UUID) TO anon, authenticated, service_role;


-- ===========================================================================
-- 8b. Anlık filtre — yasak küme
-- ===========================================================================
-- "Tekrar önerme" kuralının TEK tanımı. Edge function bu kümeyi hem prompt'a
-- ipucu olarak (kırpılmış), hem dönen öneriyi doğrulamak için (tam) kullanır.
--
-- Anahtar hesaplama client'a ya da Deno tarafına KOPYALANMAZ: kopyalanan her
-- normalizasyon eninde sonunda ayrışır ve filtre sessizce delinir.
-- JSONB döner, TABLE değil. Bu bir üslup tercihi DEĞİL: public şema PostgREST'e
-- açıktır ve yukarıda anlatılan PG 17.6 hatası yüzünden buradaki bir SRF, yetkisi
-- olmayan bir kullanıcı tarafından çağrıldığında veritabanını düşürürdü.
-- Skaler dönüşte izin reddi düzgün çalışır. TABLE'a çevirme.
CREATE OR REPLACE FUNCTION lens_blocked_works(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Koruma yetkide değil BURADA (bkz. PG 17.6 notu): fonksiyon herkese açık olmak
  -- zorunda, o yüzden başkasının kümesini istemek boş sonuç döndürür. service_role'de
  -- auth.uid() NULL'dır ve edge function bu yoldan geçer.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'work_key',     b.work_key,
           'work_type',    b.work_type,
           'work_creator', b.work_creator,
           'work_title',   b.work_title,
           'why',          b.why
         )), '[]'::JSONB)
  FROM (
    -- DISTINCT ON: aynı eser hem reddedilmiş hem listede olabilir, tek satır dönmeli.
    -- Sıralamada 'disliked' öne alınır — prompt kırpması o kayıtları asla düşürmemeli
    -- (kullanıcının açıkça sevmediği eserler).
    SELECT DISTINCT ON (u.work_key)
           u.work_key, u.work_type, u.work_creator, u.work_title, u.why
    FROM (
    -- Reddedilenler VE zaten bilinenler.
    --
    -- known_* kararlarının ÜÇÜ DE engeller (sevdim / sevmedim / kararsızım):
    -- "bunu biliyorum"un tüm anlamı eseri zaten tanıyor olmaktır, beğenip
    -- beğenmemesi ayrı bir bilgidir. Yalnızca known_disliked engellenseydi,
    -- kullanıcının "biliyorum ve sevdim" dediği eser ertesi gün keşif kartında
    -- yeniden karşısına çıkardı — keşif slotu boşa giderdi.
    --
    -- "Ruh halime uymadı" YALNIZCA erteleme süresi dolmadıysa engeller —
    -- o eser elenmiyor, 60 gün sonra tekrar aday oluyor.
    SELECT f.work_key, f.work_type, f.work_creator, f.work_title,
           CASE
             WHEN f.decision = 'known_disliked' THEN 'disliked'
             WHEN f.decision LIKE 'known_%'     THEN 'known'
             ELSE 'rejected'
           END AS why,
           f.created_at
    FROM discovery_feedback f
    WHERE f.user_id = p_user_id
      AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
      AND f.superseded_by IS NULL
      AND f.decision IN ('not_interested', 'known_disliked', 'known_liked', 'known_neutral')
      AND (f.reason IS DISTINCT FROM 'mood_mismatch' OR f.defer_until > NOW())

    UNION ALL

    -- Listeye alınanlar: bekleyen, bitmiş ve ÇIKARILMIŞ olanlar dahil.
    -- removed_at dolu satırlar da engeller — kullanıcı listeden çıkardı diye
    -- eser yeniden önerilmemeli (soft delete'in varlık sebebi budur).
    SELECT l.work_key, l.work_type, l.work_creator, l.work_title, 'listed' AS why,
           l.created_at
    FROM list_items l
    WHERE l.user_id = p_user_id
      AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
    ) u
    ORDER BY u.work_key, (u.why = 'disliked') DESC, u.created_at DESC
  ) b;
$$;

-- Yetki herkese verilir, koruma gövdedeki auth.uid() denetimindedir (PG 17.6 notu).
GRANT EXECUTE ON FUNCTION lens_blocked_works(UUID) TO anon, authenticated, service_role;

-- Aday önerilerin anahtarlarını toplu üretir: [{type, creator, title}] -> ["key", ...]
-- Edge function dönen öneriyi yasak kümeyle bununla karşılaştırır.
CREATE OR REPLACE FUNCTION lens_work_keys(p_items JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    lens_work_key(i->>'type', i->>'creator', i->>'title') ORDER BY ord
  ), '[]'::JSONB)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) WITH ORDINALITY AS t(i, ord);
$$;


-- ===========================================================================
-- 9. record_feedback — sinyal yazımı
-- ===========================================================================
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

  SELECT COALESCE(plan, 'free') INTO v_plan FROM user_preferences WHERE user_id = v_user;
  v_plan := COALESCE(v_plan, 'free');

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
-- 10. retract_feedback — geri alma
-- ===========================================================================
-- Geri alma ile çakışma FARKLI şeylerdir:
--   geri alma = kullanıcının yanlış dokunuşunu iptal eder -> kayıt gerçekten SİLİNİR
--   çakışma   = sonradan gelen güçlü sinyal              -> eski kayıt KORUNUR
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
  -- Pencere yine pakete göre: ücretsizde 30 gün, premiumda sınırsız.
  SELECT COALESCE(plan, 'free') INTO v_plan FROM user_preferences WHERE user_id = v_user;
  v_plan := COALESCE(v_plan, 'free');

  PERFORM lens_private.recompute_taste_profile(
    v_user,
    CASE WHEN v_plan = 'premium' THEN NULL ELSE 30 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION retract_feedback(UUID) TO anon, authenticated, service_role;
