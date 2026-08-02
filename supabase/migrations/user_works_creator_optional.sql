-- user_works.creator artık opsiyonel.
-- Supabase Dashboard > SQL Editor'de çalıştırın.
--
-- Gerçek listelerde satır üç biçimde geliyor: yalnız yaratıcı, yalnız eser,
-- ikisi birlikte. "Bulantı" gibi yalnızca eser adı bilinen kayıtlar da havuza
-- girebilmeli; creator NOT NULL olduğu sürece bu kayıtlar yazılamıyordu.
--
-- Not: user_works.sql güncellendi, sıfırdan kuranlar bu dosyaya ihtiyaç duymaz.
-- Bu migration yalnızca tabloyu daha önce oluşturmuş kurulumlar içindir.

ALTER TABLE user_works ALTER COLUMN creator DROP NOT NULL;

-- En az biri dolu olmalı: tamamen boş kayıt anlamsız.
ALTER TABLE user_works
  ADD CONSTRAINT user_works_needs_name
  CHECK (creator IS NOT NULL OR title IS NOT NULL);
