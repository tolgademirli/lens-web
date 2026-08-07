-- reports tablosunda iki düzeltme. İkisi de davranış değiştirmez —
-- mevcut yazıcıların hepsi is_public'i açıkça veriyor ve kaldırılan
-- politika, korunanın birebir kopyası.

-- 1) is_public varsayılanı false.
--    Production'da default true'ydu; docs/schema.md ise baştan beri
--    "default false" diyordu. Gerçeği dokümana uyduruyoruz.
--    Bugün sızıntı yok çünkü her iki yazıcı da değeri açıkça veriyor
--    (analyze/index.ts → false, lens bot.py → true). Amaç, is_public
--    vermeyi unutan yeni bir insert yolunun raporu public doğurmaması.
ALTER TABLE "public"."reports" ALTER COLUMN "is_public" SET DEFAULT false;

-- 2) Çift SELECT politikasını tekilleştir.
--    reports üzerinde USING (is_public = true) koşullu iki özdeş politika
--    vardı. Türkçe olan korunuyor (tablodaki diğer politikalar da Türkçe);
--    İngilizce kopya düşüyor. Politikalar permissive ve özdeş olduğu için
--    erişim davranışı değişmez.
DROP POLICY IF EXISTS "Public reports are viewable by everyone" ON "public"."reports";
