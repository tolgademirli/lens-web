# Geliştirici Rehberi

Lokal ortamı ayağa kaldırma, test etme ve production'a çıkarma. Şema detayı için [`schema.md`](schema.md).

---

## Ortamlar

| | Lokal | Production |
|---|---|---|
| Uygulama | http://localhost:5173 | https://lensestetik.com |
| Supabase API | http://127.0.0.1:54321 | `lubqjfyumqlkippeijah.supabase.co` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Supabase yönetiyor |
| Studio (tablo/SQL) | http://127.0.0.1:54323 | Supabase Dashboard |
| E-posta | Mailpit → http://127.0.0.1:54324 | Resend (gerçek gönderim) |
| Hosting | Vite dev sunucusu | Vercel |
| Env dosyası | `.env.localdb` | `.env.local` |

**İki ortam tamamen ayrıdır.** Lokalde ürettiğin rapor canlıya gitmez, canlı veriyi lokalde göremezsin.

Telegram botu ayrı bir depodadır (`lens`, Railway'de çalışır) ama **production veritabanını paylaşır**. Şema değişikliği yaparken botu da etkileyebileceğini unutma.

### Hangi komut hangi ortama bakıyor

```
npm run dev:local   →  LOKAL Supabase        ← geliştirme ve test bunun üstünde
npm run dev         →  PRODUCTION Supabase   ← canlı veriye bakmak gerektiğinde
npm run build       →  PRODUCTION Supabase   ← deploy çıktısı
```

`npm run dev` canlı veritabanına yazar ve gerçek Anthropic kredisi harcar. Bilerek kullan.

---

## İlk kurulum (bir kez)

Gerekenler: Node 20+, Docker Desktop (çalışır durumda), Supabase CLI (`npx supabase` yeterli, ayrı kurulum gerekmez).

```bash
cd lens-web
npm install
npx supabase start          # ilk seferde imajları indirir, 5-10 dk sürebilir
```

Edge function'ları lokalde çalıştıracaksan:

```bash
cp supabase/functions/.env.example supabase/functions/.env
# ANTHROPIC_API_KEY satırını doldur, RESEND_API_KEY'i BOŞ bırak
npx supabase stop && npx supabase start
```

`RESEND_API_KEY` doluysa lokal test **gerçek e-posta gönderir**. Boş bırak; mailleri Mailpit'te gör.

---

## Günlük çalışma

```bash
npx supabase start     # stack'i aç
npm run dev:local      # uygulamayı aç → localhost:5173
```

Bitince `npx supabase stop`. Veri korunur, bir dahaki `start`'ta yerinde durur.

**Giriş yapmak:** e-posta adresini gir, magic link'i http://127.0.0.1:54324 (Mailpit) adresinde bul. Google OAuth lokalde çalışmaz — o akışı test etmen gerekiyorsa production'a bakman gerekir.

---

## Geliştirme ve test döngüsü

### Frontend değişikliği

`npm run dev:local` açıkken kaydet, tarayıcı kendini günceller. Bitince:

```bash
npm run build          # TypeScript hatalarını burada yakalarsın (ayrı test komutu yok)
```

### Edge function değişikliği

Fonksiyon kodunu düzenle, sonra stack'i yeniden başlat:

```bash
npx supabase stop && npx supabase start
```

Edge runtime kodu ve `functions/.env`'i **yalnızca başlangıçta** okur. Kaydetmek yetmez, yeniden başlatman gerekir.

Fonksiyonu doğrudan çağırarak test edebilirsin:

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/analyze \
  -H "Authorization: Bearer <kullanıcı_token>" \
  -H "Content-Type: application/json" \
  -d '{"books":[...],"movies":[...],"music":[...]}'
```

### Şema değişikliği

**Asla Studio'dan elle tablo değiştirme.** Değişiklik migration dosyası olarak yazılır, yoksa production'a taşınamaz ve bir sonraki `db reset`'te kaybolur.

```bash
# 1. Zaman damgalı dosya oluştur — bu isim formatı ZORUNLU
#    <YYYYMMDDHHMMSS>_kisa_aciklama.sql
touch supabase/migrations/$(date -u +%Y%m%d%H%M%S)_yaptigim_degisiklik.sql

# 2. SQL'i yaz

# 3. Veritabanını sıfırdan kur ve migration'ı doğrula
npx supabase db reset
```

`db reset` lokal veriyi **siler** ve tüm migration'ları baştan uygular. Migration'ın gerçekten çalıştığının tek kanıtı budur.

> `supabase/migrations/` içindeki zaman damgasız eski `.sql` dosyaları (`user_works.sql` vb.) CLI tarafından atlanır — tarihsel kayıt olarak duruyorlar, çalıştırılmıyorlar. "Skipping migration" uyarıları normaldir.

### Prod'a çıkmadan önce kontrol listesi

- [ ] `npm run build` hatasız geçiyor
- [ ] Değişiklik `dev:local` üstünde (lokal DB'ye bağlı) test edildi
- [ ] Şema değiştiyse `npx supabase db reset` temiz geçiyor
- [ ] RLS'e dokunduysan: private rapor anon kullanıcıya **görünmüyor**

---

## Production'a çıkış

Üç bileşen **ayrı ayrı** deploy edilir. Biri diğerini götürmez.

### 1. Şema (varsa, önce bu)

```bash
npx supabase db push
```

Yalnızca uygulanmamış migration'ları gönderir. Onay ister, listeyi okuyup onayla.

**Sıralama önemli:** yeni kolon bekleyen bir frontend'i şemadan önce yayınlarsan canlı hata alırsın. Önce şema, sonra kod.

### 2. Edge function (değiştiyse)

```bash
npx supabase functions deploy analyze     # yalnızca değişen fonksiyonu
```

Fonksiyonlar Vercel deploy'una **dahil değildir**. Frontend'i yayınlamak edge function'ı güncellemez.

Yeni bir secret gerekiyorsa:

```bash
npx supabase secrets set YENI_ANAHTAR=deger
```

Secret'lar geri okunamaz (`secrets list` yalnızca hash gösterir) — değeri kendi kasanda sakla.

### 3. Frontend

```bash
git push origin main
```

`lensestetik.com`'u besleyen Vercel projesi **`lens-web-9a4e`**. GitHub bağlantısı onda, `main` dalına push otomatik deploy tetikler. Deploy durumunu Vercel panosundan takip et.

> **Vercel panosunda iki proje var: `lens-web` ve `lens-web-9a4e`. Canlı olan ikincisi.**
> `lens-web` eski bir kayıt; hiçbir domain'e bağlı değil ve env değişkenleri eksik.
>
> Bu yüzden **CLI ile deploy etmeden önce `.vercel/project.json`'a bak.** Yanlış projeye
> bağlıysa `npx vercel --prod` "başarılı" der ve canlıda hiçbir şey değişmez — sessiz bir
> tuzak. Düzeltmek için:
>
> ```bash
> npx vercel link --yes --project lens-web-9a4e
> ```
>
> `.vercel` gitignore'da olduğu için bu bağlantı her makinede ayrı ayrı kurulur ve yeni
> bir klonda yanlış olabilir.

Otomatik deploy beklediğin gibi çalışmıyorsa Vercel panosunda projenin GitHub bağlantısını ve production dalı ayarını kontrol et.

### Sonrasında

Canlıda hızlı doğrulama: bir rapor üret, `/report/:id` açılıyor mu, paylaşım toggle'ı çalışıyor mu.

Geri alma: Vercel panosundan önceki deploy'a dönebilirsin. **Migration'ın otomatik geri alması yoktur** — geri almak için ters yönde yeni bir migration yazman gerekir. Şema değişikliklerini bu yüzden küçük ve geriye uyumlu tut.

---

## Bilmen gereken tuzaklar

**`.env.local`'a dokunma.** Production anahtarlarını tutar. Lokal ayarlar `.env.localdb`'de. Yeni bir env değişkeni eklersen `.env.example`'a belgele.

**Anahtar/secret değiştirdiysen stack'i yeniden başlat.** Edge runtime onları yalnızca başlangıçta okur.

**Docker Desktop açık olmalı.** Kapalıysa `supabase start` anlaşılmaz hatalar verir.

**Studio'nun "Logs" sekmesi lokalde çalışmaz.** Analytics container'ı Windows'ta sağlık kontrolünü geçemediği ve tüm stack'i düşürdüğü için `config.toml`'da kapalı. Kasıtlı.

**`supabase start` ilk denemede bazen başarısız olur** (container sağlık kontrolü). Genelde ikinci deneme çalışır.

**Lokal anahtarlar gizli değil.** `.env.localdb` içindeki JWT'ler her Supabase kurulumunda aynı olan herkese açık demo anahtarlarıdır; commit edilmeleri sorun değil.

**`ANTHROPIC_API_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` yalnızca edge function ortamında yaşar.** Client koduna asla import edilmez.

**Rapor üretimi 30-40 saniye sürer.** Bu normaldir, takılma değil.

**Bütün AI özellikleri aynı anda 400 dönüyorsa** önce Anthropic kredisine bak, koda dalma.
