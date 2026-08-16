-- Haftalık seçki otomasyonu — şema katmanı (Migration A).
--
-- Bu dosya kullanıcıya dönük hiçbir şey değiştirmez; üretim fonksiyonunun ve
-- Ayarlar ekranının dayanacağı zemini kurar:
--   1) user_preferences.platforms — platform tercihi (NULL = "Tümü")
--   2) watch_providers           — platform sözlüğü (slug -> sağlayıcı servis id'si)
--   3) lens_weekly_pick_candidates — bu hafta için kime seçki üretilecek
--   4) lens_active_signals       — haftalık seçki etiketlerini de okuyacak hâle gelir
--
-- Zamanlama (pg_cron) BU DOSYADA DEĞİL; ayrı bir migration'da, üretim akışı elle
-- doğrulandıktan sonra kurulur.
--
-- 2026-08-16 REVİZYONU: erişilebilirlik sağlayıcısı TMDB'den movieofthenight'a
-- taşındı (TMDB ticari kullanım $149/ay; Lens'in premium paketi var, "kişisel
-- kullanım" beyanı yanlış beyan olurdu). Bu dosya PRODUCTION'A HİÇ GİTMEDİĞİ için
-- yeni bir migration eklemek yerine yerinde düzeltildi; tmdb_providers yalnızca
-- lokal stack'lerde var olduğundan aşağıda açıkça düşürülüyor.


-- ===========================================================================
-- 1. user_preferences.platforms — platform tercihi
-- ===========================================================================
-- NULL = "Tümü" (filtre yok). DEFAULT bilinçli olarak YOK: tablonun mevcut
-- doktrini "yokluk = varsayılan" (weekly_picks.sql:16-19) ve src/lib/preferences.ts
-- içindeki DEFAULT_PREFERENCES.platforms = null bununla birebir aynı kalmalı.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS platforms TEXT[];

-- BOŞ DİZİ YASAK. '{}' "hiçbir platform kabul değil" demektir — filtre semantiğinin
-- tam tersi — ve `platforms && adaylar` gibi her doğal dizi yüklemi '{}' için false
-- döner. Yani kullanıcı hiçbir hata görmeden HER HAFTA sıfır film alırdı. Yokluk
-- NULL ile ifade edilir; '{}' temsil edilemez olmalı.
--
-- 'all' gibi bir sentinel de kullanılmıyor: {'all','netflix'} gibi geçersiz durumlar
-- doğurur ve her okuyucu sihirli string'i özel-durum yapmak zorunda kalır. NULL
-- hiçbir şeyle birleşemez.
-- COALESCE ŞART, `array_length(...) BETWEEN 1 AND 24` tek başına YETMEZ:
-- array_length('{}', 1) sıfır DEĞİL **NULL** döner, `NULL BETWEEN 1 AND 24` NULL'dır
-- ve CHECK kısıtları NULL'ı GEÇİRİR. Yani tam olarak yasaklamak istediğimiz boş dizi
-- sessizce kabul edilirdi. (Bu ilk yazımda böyleydi ve yerel test yakaladı.)
--
-- İkinci koşul dizi içindeki NULL elemanı yakalar: '{netflix,NULL}' geçerli bir
-- TEXT[] ve aşağıdaki trigger onu YAKALAYAMAZ — `NULL NOT IN (...)` NULL üretir,
-- EXISTS eşleşmez, eleman süzülür ve hiçbir zaman çözülmeyen bir platform olur.
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_platforms_check;
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_platforms_check
  CHECK (
    platforms IS NULL
    OR (
      COALESCE(array_length(platforms, 1), 0) BETWEEN 1 AND 24
      AND array_position(platforms, NULL) IS NULL
    )
  );

COMMENT ON COLUMN user_preferences.platforms IS
  'Haftalık seçkinin sınırlanacağı platform slug''ları (watch_providers.slug). '
  'NULL = Tümü. Boş dizi CHECK ile yasak: sessizce sıfır öneri demek olurdu. '
  'Filtre yalnızca plan = premium iken UYGULANIR (lens_weekly_pick_candidates).';


-- ===========================================================================
-- 2. watch_providers — platform sözlüğü
-- ===========================================================================
-- Sözlük neden TS sabiti değil TABLO:
--   * Yeni platform eklemek tek INSERT — deploy gerekmez.
--   * UI, üretimin filtreleyemediği bir platformu asla teklif edemez (ikisi aynı
--     kaynaktan okur).
--
-- Neden sağlayıcının id'sini değil KENDİ slug'ımızı user_preferences'ta saklıyoruz:
-- sağlayıcılar servis kimliklerini yeniden adlandırabiliyor ve bir gün yine
-- sağlayıcı değiştirebiliriz (TMDB -> movieofthenight geçişi tam olarak bu oldu).
-- Kendi slug'ımızı saklamak, kullanıcının tercihinin o gün sessizce bozulmamasını
-- garantiler: değişen tek şey bu tablodaki service_id olur.
--
-- tmdb_providers YALNIZCA lokal stack'lerde vardı (üretime hiç gitmedi); adı ve
-- kolon şekli değiştiği için burada düşürülüyor. Üretimde bu satır no-op.
DROP TABLE IF EXISTS tmdb_providers;

CREATE TABLE IF NOT EXISTS watch_providers (
  -- BİZİM kelime dağarcığımız. user_preferences.platforms bunu saklar.
  slug       TEXT PRIMARY KEY,
  -- Ayarlar ekranında görünen ad. Türkçe metin bizim elimizde kalsın.
  label_tr   TEXT NOT NULL,
  -- movieofthenight'ın servis id'si ("netflix", "prime", "apple"...). Sağlayıcı
  -- zaten SLUG döndürdüğü için runtime çözümleme katmanı YOK — TMDB'de gereken
  -- provider_id araması burada anlamsız.
  --
  -- NULL = bu platformun sağlayıcıdaki karşılığı HENÜZ DOĞRULANMADI. Ayarlar
  -- ekranı NULL olan satırı GÖSTERMEZ: filtreleyemeyeceğimiz bir platformu
  -- teklif etmek, kullanıcıya tutamayacağımız bir söz vermektir. Doğrulama
  -- yolu: generate-weekly-picks `mode: "services"` (TR'de tanınan servisleri döker).
  service_id TEXT,
  sort_order INT NOT NULL DEFAULT 100
);

ALTER TABLE watch_providers ENABLE ROW LEVEL SECURITY;

-- Sözlük gizli değil: Ayarlar ekranı oturum açmış kullanıcıya bunu gösterecek.
DROP POLICY IF EXISTS "Anyone reads providers" ON watch_providers;
CREATE POLICY "Anyone reads providers" ON watch_providers
  FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE policy'si YOK: yazım yalnızca service_role ve postgres.

-- service_id yalnızca CANLI OLARAK DOĞRULANMIŞ slug'lar için yazılıyor; gerisi NULL.
-- Tahmini bir id sessizce YANLIŞ platformu filtreler ya da filtreyi boşaltır, ikisi
-- de kullanıcıya hiç görünmeden olur.
--
-- 16 Ağustos 2026, `mode: "services"` çıktısı — sağlayıcının TÜRKİYE'de tanıdığı
-- servislerin TAMAMI şunlar:
--   netflix · prime · disney · hbo · mubi · curiosity · crunchyroll · zee5
--
-- Bunun iki sonucu var ve ikisi de kasıtlı olarak NULL'a yazılmış durumda:
--   * APPLE TV+ LİSTEDE YOK. İlk seed'de 'apple' yazılmıştı (sağlayıcının genel
--     belgesinden); TR kataloğunda karşılığı olmadığı için filtreye giremez.
--     Türkiye'de gerçekten var olan bir platform ama BİZ filtreleyemiyoruz, o
--     yüzden Ayarlar'da da teklif etmiyoruz.
--   * Türkiye'ye özgü servislerin (BluTV, Exxen, Gain, tabii, TOD) ve YouTube
--     Premium'un karşılığı YOK. Satırları duruyor ki sağlayıcı bir gün eklerse
--     tek UPDATE ile açılsın.
-- curiosity / crunchyroll / zee5 sözlüğümüzde YOK — eklemek ürün kararı, tek INSERT.
INSERT INTO watch_providers (slug, label_tr, service_id, sort_order) VALUES
  ('netflix',            'Netflix',         'netflix', 10),
  ('amazon_prime_video', 'Prime Video',     'prime',   20),
  ('disney_plus',        'Disney+',         'disney',  30),
  ('apple_tv_plus',      'Apple TV+',       NULL,      40),
  ('hbo_max',            'HBO Max',         'hbo',     50),
  ('mubi',               'MUBI',            'mubi',    60),
  ('blutv',              'BluTV',           NULL,      70),
  ('exxen',              'Exxen',           NULL,      80),
  ('gain',               'Gain',            NULL,      90),
  ('tabii',              'tabii',           NULL,     100),
  ('tod',                'TOD',             NULL,     110),
  ('youtube_premium',    'YouTube Premium', NULL,     120)
ON CONFLICT (slug) DO UPDATE
  SET label_tr   = EXCLUDED.label_tr,
      sort_order = EXCLUDED.sort_order;
      -- service_id KASTEN korunur: doğrulama sonrası elle doldurulan bir id'yi
      -- migration'ı yeniden koşturmak NULL'a döndürmemeli.


-- ===========================================================================
-- 3. platforms slug doğrulaması — CHECK değil TRIGGER
-- ===========================================================================
-- Sözlük bir tabloda yaşadığı için CHECK kullanılamaz (alt sorgu içeremez).
CREATE OR REPLACE FUNCTION guard_user_preferences_platforms()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bilinmeyen slug SESSİZCE o kullanıcının filtresini boşaltır ve üreticinin
  -- gevşetme merdiveni bunu "platform dışı öneri" diye gizler. Yazım anında
  -- yüksek sesle patlaması çok daha iyi.
  --
  -- Denetim BÜTÜN roller için geçerli (guard_user_preferences_plan'ın aksine):
  -- yazık bir slug bir client hatası kadar bizim edge function hatamız da olabilir.
  IF NEW.platforms IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.platforms) AS s
    WHERE s NOT IN (SELECT slug FROM watch_providers)
  ) THEN
    RAISE EXCEPTION 'Bilinmeyen platform slug''ı: %', NEW.platforms;
  END IF;
  RETURN NEW;
END;
$$;

-- user_preferences_guard_plan ile birlikte çalışır: ikisi de BEFORE, ikisi de
-- RETURN NEW, farklı kolonlara dokunuyorlar. Tetikleme sırası ada göre alfabetik
-- (plan < platforms), ikisi de birbirinin kolonunu okumuyor — etkileşim yok.
DROP TRIGGER IF EXISTS user_preferences_guard_platforms ON user_preferences;
CREATE TRIGGER user_preferences_guard_platforms
  BEFORE INSERT OR UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION guard_user_preferences_platforms();


-- ===========================================================================
-- 4. lens_weekly_pick_candidates — bu hafta kime seçki üretilecek
-- ===========================================================================
-- Neden RPC: auth.users PostgREST'ten okunamaz ve auth.admin.listUsers() de
-- reports / user_preferences / weekly_picks ile join edilemez. Üretici tek çağrıda
-- adaylarını ve her adayın platform tercihini almalı.
--
-- Neden TABLE değil JSONB döner: yukarıdaki PG 17.6 notu (feedback_engine.sql:352-372).
-- public şemadaki fonksiyonlar PostgREST'e açıktır ve yetkisiz çağrıda izin reddi
-- backend'i segfault ettiriyor; skaler dönüş bu yolu hiç açmıyor.
--
-- Adaylık üç koşul:
--   * En az bir raporu var — prompt rapora dayanıyor (daily-discovery de aynı şartı
--     koyuyor: index.ts:525-527). Raporsuz kullanıcıya üretilecek bir şey yok.
--   * Opt-out DEĞİL — satırı olmayan kullanıcı varsayılan olarak AÇIK sayılır,
--     send-weekly-picks'in aynı varsayımı (index.ts:264-279) ile birebir.
--     Opt-out kullanıcı aday listesine hiç girmez: token harcanmaz.
--   * Bu hafta için satırı yok — fikirdeşliğin birinci katmanı; yeniden
--     çalıştırma zaten üretilmiş kullanıcılara SIFIR token harcar.
--
-- PLAN KAPISI: `platforms` yalnızca plan = 'premium' iken döner, aksi halde NULL.
-- Platform filtresi ücretli bir özellik ve filtreyi uygulamanın tek yolu ücretli
-- erişilebilirlik API'sini çağırmak — ücretli özellik ücretli API'yi finanse eder.
-- Kapı NEDEN BURADA, üreticide değil:
--   * Premium'dan düşen kullanıcı için otomatik doğru davranır (downgrade-safe);
--     tercihi tabloda DURUR ve tekrar premium olunca geri gelir.
--   * UI'ı atlayıp doğrudan `platforms` yazan ücretsiz kullanıcının değeri
--     zararsızca yok sayılır.
--   * Üreticinin bunu yanlış yapma imkânı kalmaz: eline zaten NULL geçer.
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
             CASE WHEN p.plan = 'premium' THEN p.platforms ELSE NULL END AS platforms
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
  'kullanıcılar listeye hiç girmez. platforms yalnızca premium pakette döner '
  '(ücretsizde NULL = filtre yok, erişilebilirlik API''si hiç çağrılmaz).';


-- ===========================================================================
-- 5. lens_active_signals — haftalık seçki etiketlerini de oku
-- ===========================================================================
-- SORUN: Etiketler bugüne kadar yalnızca daily_discoveries.items'tan okunuyordu,
-- çünkü haftalık seçki ELLE küre ediliyordu ve etiketsizdi. Sonuç: haftalık seçkiye
-- verilen geri bildirim yasak kümeyi ve eşik sayacını besliyor ama eksenleri yalnızca
-- too_dark/too_popular üzerinden oynatıyor ve genre_weights'e HİÇ katkı vermiyordu.
-- "İlgimi çekti"nin eksene etkisi tam olarak sıfırdı.
--
-- Artık seçkiyi Claude üretiyor, yani tone/popularity/era/genre etiketlerini de
-- üretebiliyor (films JSONB v2, öğe içinde 'tags' altında). Bu fonksiyon o etiketleri
-- görecek hâle geliyor — yoksa mailde yazacağımız "geri bildirim ver, öneriler
-- keskinleşir" cümlesi yarı yanlış olurdu.
--
-- İmza, dönüş kolonları, BAYATLAMA CASE'i ve ::NUMERIC cast disiplini
-- (feedback_engine.sql:409-416) BİREBİR korunur. Değişen tek şey tag lateral'i.
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
  -- Eserin kendi etiketleri. İKİ kaynak var ve ŞEKİLLERİ FARKLI:
  --   * günlük keşif: etiketler öğenin KENDİ üst seviyesinde, slot = 'book'|'film'|'music'
  --   * haftalık seçki: slot dizinin 0-TABANLI SIRA NUMARASI (string, discovery.ts:86),
  --     etiketler film nesnesinin İÇİNDE 'tags' altında (films JSONB v2)
  -- Bu asimetri YALNIZCA burada yaşıyor; iki kaynağı da tek bir JSONB nesnesine
  -- indiriyoruz ki eksen matematiği (recompute_taste_profile) tek şekil görsün.
  --
  -- v1 (elle girilmiş) seçki satırlarında 'tags' YOKTUR: NULL döner ve o satır
  -- bugünkü gibi yalnızca neden tabanlı (too_dark/too_popular) ayar yapar.
  -- Veri göçü gerekmez.
  LEFT JOIN LATERAL (
    SELECT src.item
    FROM (
      SELECT i AS item
      FROM daily_discoveries d
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::JSONB)) AS i
      WHERE f.daily_discovery_id IS NOT NULL
        AND d.id = f.daily_discovery_id
        AND i->>'slot' = f.slot

      UNION ALL

      -- WITH ORDINALITY şart: haftalık slot bir DİZİ İNDEKSİ, isim değil.
      SELECT film.item -> 'tags' AS item
      FROM weekly_picks w
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.films, '[]'::JSONB))
        WITH ORDINALITY AS film(item, ord)
      WHERE f.weekly_pick_id IS NOT NULL
        AND w.id = f.weekly_pick_id
        AND (film.ord - 1)::TEXT = f.slot
    ) src
    WHERE src.item IS NOT NULL
      -- 'tags' yanlış tipte gelirse (dizi, string, sayı) yok say. Aşağıdaki
      -- ->>'tone' cast'ı aksi halde çalışma anında patlardı.
      AND jsonb_typeof(src.item) = 'object'
    LIMIT 1
  ) tag ON TRUE
  WHERE f.user_id = p_user_id
    -- Çakışmada yüksek ağırlıklı kazanır: aşılmış satırlar hesaba GİRMEZ ama
    -- tabloda durmaya devam eder (hata kaydı).
    AND f.superseded_by IS NULL
    AND (p_window_days IS NULL OR f.created_at >= NOW() - make_interval(days => p_window_days));
$$;

REVOKE ALL ON FUNCTION lens_private.lens_active_signals(UUID, INT) FROM PUBLIC;


-- ===========================================================================
-- 6. recompute_taste_profile — eksen girdisinde tip sertleştirmesi
-- ===========================================================================
-- DAVRANIŞ DEĞİŞMİYOR. Tek fark: `tags ? 'tone'` yerine
-- `jsonb_typeof(tags->'tone') = 'number'`.
--
-- Neden: `?` operatörü anahtarın VARLIĞINA bakar, tipine değil. Bugün etiketleri
-- yalnızca daily-discovery üretiyor ve axis() clamp'i (index.ts:245-248) sayı
-- garantiliyor — yani mevcut verinin tamamı için sonuç birebir aynı. Ama ileride
-- bir üretici `"tone": null` yazarsa `?` bunu GEÇİRİR ve SAYILAN bir denominatöre
-- NULL numeratör düşer: SUM(num) NULL'a gider, eksen sessizce kaybolur ya da
-- sulanır. Yeni üretici aynı clamp'i kullanacak; bu sigorta, bağımlılık değil.
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
    FROM tagged WHERE jsonb_typeof(tags->'tone') = 'number'
    UNION ALL
    SELECT 'popularity',
           eff_weight * valence * (tags->>'popularity')::NUMERIC,
           eff_weight * abs(valence)
    FROM tagged WHERE jsonb_typeof(tags->'popularity') = 'number'
    UNION ALL
    SELECT 'era',
           eff_weight * valence * (tags->>'era')::NUMERIC,
           eff_weight * abs(valence)
    FROM tagged WHERE jsonb_typeof(tags->'era') = 'number'
    UNION ALL
    -- Neden tabanlı ayar: etiket gerekmez, yön nedenin kendisinde. Etiketsiz
    -- (v1, elle girilmiş) seçki satırları motoru ancak bu yoldan besler.
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
