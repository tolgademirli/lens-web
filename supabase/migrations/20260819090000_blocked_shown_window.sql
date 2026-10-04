-- ===========================================================================
-- Keşifte 30 günlük özgünlük penceresi
-- ===========================================================================
-- SORUN: `lens_blocked_works` bugüne kadar yalnızca kullanıcının BİR ŞEY SÖYLEDİĞİ
-- eserleri biliyordu (discovery_feedback + list_items). "Gösterildi ama kullanıcı
-- dokunmadı" diye bir kayıt yoktu; o eser ertesi gün hiç önerilmemiş sayılıyordu.
--
-- Prompt her gün birebir aynı olduğu için (aynı arketip, aynı rapor, aynı eksenler)
-- model de aynı cevabı veriyordu: aynı kullanıcıya haftalarca "Bulantı - Sartre" ve
-- "Stalker - Tarkovski". Model kusurlu davranmıyordu, biz aynı soruyu soruyorduk.
--
-- ÇÖZÜM: yasak kümeye üçüncü bir kaynak — SON 30 GÜNDE GÖSTERİLEN öneriler.
-- İmza değişmiyor: hem daily-discovery hem generate-weekly-picks aynı çağrıyı
-- yapmaya devam eder, prompt'un TAVANI da değişmez (bkz. trimBlocked katmanları).
--
-- 'shown' ötekilerden farklı olarak KALICI DEĞİL, PENCERELİ. Dokunulmamış öneri
-- "reddedildi" demek değil, "o gün tutmadı" demek — 30 gün sonra yeniden aday olur.
-- mood_mismatch'in 60 günlük ertelemesiyle aynı felsefe.

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
  --
  -- jsonb_agg'ın SIRASI artık anlamlı: prompt kırpması (trimBlocked) diziyi baştan
  -- okur. Eskiden sıra DISTINCT ON'dan miras kalan work_key alfabetik sırasıydı,
  -- yani 80'lik kırpma pratikte RASTGELE seçiyordu — dün gösterilen eser prompt'a
  -- girmeyip altı aylık bir "listeye aldım" kaydı girebiliyordu.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'work_key',     b.work_key,
             'work_type',    b.work_type,
             'work_creator', b.work_creator,
             'work_title',   b.work_title,
             'why',          b.why
           )
           ORDER BY CASE b.why WHEN 'disliked' THEN 0 WHEN 'shown' THEN 1 ELSE 2 END,
                    b.created_at DESC
         ), '[]'::JSONB)
  FROM (
    -- DISTINCT ON: aynı eser hem reddedilmiş hem listede olabilir, tek satır dönmeli.
    -- Sıralamada 'disliked' öne alınır — prompt kırpması o kayıtları asla düşürmemeli
    -- (kullanıcının açıkça sevmediği eserler).
    --
    -- 'shown' ise dedupe'ta EN GERİYE atılır: aynı eser hem gösterilmiş hem listeye
    -- alınmışsa etiket 'listed' kalmalı. Anahtar her iki durumda da engellenir (kalıcı
    -- satır UNION'da durmaya devam eder), ama etiketin kendisi doğru kalsın istiyoruz.
    SELECT DISTINCT ON (u.work_key)
           u.work_key, u.work_type, u.work_creator, u.work_title, u.why, u.created_at
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

    UNION ALL

    -- Son 30 günde GÖSTERİLEN günlük keşifler (yapılandırılmış yol).
    -- Anahtar yine lens_work_key'den geçer: normalizasyon Deno'ya kopyalanmaz.
    -- 'music' slotu motorda 'song' tipinde yaşar (work_type CHECK'i böyle).
    SELECT lens_work_key(s.work_type, s.creator, s.title),
           s.work_type, NULLIF(s.creator, ''), NULLIF(s.title, ''), 'shown' AS why,
           d.created_at
    FROM daily_discoveries d
    -- Tip denetimi WHERE'de DEĞİL burada: jsonb_array_elements bir SRF ve satır
    -- WHERE'e ulaşmadan değerlendirilir; `items` yanlışlıkla nesne olarak yazılmış
    -- tek bir satır tüm keşfi hataya düşürürdü.
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.items) = 'array' THEN d.items ELSE '[]'::JSONB END
    ) AS i
    CROSS JOIN LATERAL (
      SELECT CASE i->>'slot' WHEN 'music' THEN 'song' ELSE i->>'slot' END AS work_type,
             TRIM(COALESCE(i->>'creator', '')) AS creator,
             TRIM(COALESCE(i->>'title', ''))   AS title
    ) s
    WHERE d.user_id = p_user_id
      AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
      AND d.date >= CURRENT_DATE - 30
      AND (i->>'slot') IN ('book', 'film', 'music')
      AND (s.creator <> '' OR s.title <> '')

    UNION ALL

    -- Aynısının ESKİ satırlar için karşılığı. `items` kolonu 2026-08-11'de geldi;
    -- ondan önceki satırlarda yalnızca "Başlık - Yaratıcı" TEXT'i var.
    --
    -- GEÇİCİ KOL: 30 günlük pencere yüzünden 2026-09-10 civarında kendiliğinden
    -- ölü koda dönüşür, o zaman silinebilir. src/lib/discovery.ts → splitLegacy'nin
    -- SQL karşılığı ama onun kopyası değil: burada bölünen şey bir NORMALİZASYON
    -- değil bir AYRIŞTIRMA, ve yanlış bölünen satır (içinde " - " geçen bir başlık)
    -- yalnızca anahtarı tutturamaz — engellemez, zarar da vermez (fail-open).
    SELECT lens_work_key(s.work_type, s.creator, s.title),
           s.work_type, NULLIF(s.creator, ''), NULLIF(s.title, ''), 'shown' AS why,
           d.created_at
    FROM daily_discoveries d
    CROSS JOIN LATERAL (VALUES
      ('book', d.book), ('film', d.film), ('song', d.music)
    ) AS raw(work_type, raw_text)
    CROSS JOIN LATERAL (
      SELECT raw.work_type AS work_type,
             CASE
               WHEN POSITION(' - ' IN raw.raw_text) > 0
                 THEN TRIM(SUBSTR(raw.raw_text, POSITION(' - ' IN raw.raw_text) + 3))
               -- Ayıraç yoksa müzikte tamamı sanatçı adıdır (music kolonuna zaten
               -- yalnızca creator yazılır); kitap/filmde ise eser adıdır.
               WHEN raw.work_type = 'song' THEN TRIM(raw.raw_text)
               ELSE ''
             END AS creator,
             CASE
               WHEN POSITION(' - ' IN raw.raw_text) > 0
                 THEN TRIM(LEFT(raw.raw_text, POSITION(' - ' IN raw.raw_text) - 1))
               WHEN raw.work_type = 'song' THEN ''
               ELSE TRIM(raw.raw_text)
             END AS title
    ) s
    WHERE d.user_id = p_user_id
      AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
      AND d.date >= CURRENT_DATE - 30
      AND d.items IS NULL
      AND (s.creator <> '' OR s.title <> '')

    UNION ALL

    -- Son 30 GÜNÜN haftalık seçkileri. Cuma maili gelen film Pazar günü keşif
    -- kartında tekrar çıkmasın diye: kullanıcı için iki yüzey değil tek bir Lens var,
    -- tekrarın hangi yüzeyden geldiği umurunda değil.
    --
    -- v1 (elle girilmiş) satırlarda `director` yoktur: anahtar creator'sız üretilir
    -- ve v2 adayıyla eşleşmez. O satırlar sessizce engellemez — kabul edilen maliyet,
    -- v1 zaten kapanmış bir dönem.
    SELECT lens_work_key('film', s.creator, s.title),
           'film', NULLIF(s.creator, ''), NULLIF(s.title, ''), 'shown' AS why,
           w.created_at
    FROM weekly_picks w
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.films) = 'array' THEN w.films ELSE '[]'::JSONB END
    ) AS f
    CROSS JOIN LATERAL (
      SELECT TRIM(COALESCE(f->>'director', '')) AS creator,
             TRIM(COALESCE(f->>'title', ''))    AS title
    ) s
    WHERE w.user_id = p_user_id
      AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
      AND w.week >= CURRENT_DATE - 30
      AND s.title <> ''
    ) u
    ORDER BY u.work_key,
             (u.why = 'disliked') DESC,
             (u.why = 'shown'),
             u.created_at DESC
  ) b;
$$;

COMMENT ON FUNCTION lens_blocked_works(UUID) IS
  '"Tekrar önerme" kuralının tek tanımı: reddedilenler + listedekiler + son 30 günde '
  'gösterilen keşif/seçki öğeleri. Dizi prompt kırpması için SIRALI döner: '
  'disliked > shown > diğerleri, her katman içinde yeniden eskiye.';

-- Yetki herkese verilir, koruma gövdedeki auth.uid() denetimindedir (PG 17.6 notu).
GRANT EXECUTE ON FUNCTION lens_blocked_works(UUID) TO anon, authenticated, service_role;

-- Pencere sorgusu keşif/seçki üretiminde bir kez çalışır; kullanıcı başına ~30 satır.
CREATE INDEX IF NOT EXISTS daily_discoveries_user_date_idx
  ON daily_discoveries (user_id, date DESC);
CREATE INDEX IF NOT EXISTS weekly_picks_user_week_idx
  ON weekly_picks (user_id, week DESC);
