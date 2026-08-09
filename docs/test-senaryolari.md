# Fonksiyonel Test Senaryoları — "6 sinyal, dağılım serbest"

Onboarding'in 3+3+3 zorunluluğundan toplam-6 eşiğine geçişi ve yazar/eser ayrı
düzenleme özelliği için. Genel geliştirme akışı: [`gelistirme.md`](gelistirme.md).

**İşaretler:** ✅ = uygulama sırasında doğrulandı, tekrar bakman şart değil ·
🔍 = senin bakman gereken · ⚠️ = en kolay bozulan yer

---

## 0. Ön koşullar

```bash
npx supabase start          # Docker Desktop açık olmalı
npm run dev:local           # http://localhost:5173 → LOKAL Supabase
```

Kontrol et: Vite banner'ında **`localdb`** yazmalı. `npm run dev` (localdb'siz)
**production'a** bağlanır ve gerçek Anthropic kredisi harcar.

| Ne | Nerede |
|---|---|
| Uygulama | http://localhost:5173 |
| Magic link mailleri | http://127.0.0.1:54324 (Mailpit) |
| Tablo / SQL | http://127.0.0.1:54323 (Studio) |

Rapor üretimi **30–40 saniye** sürer, takılma değil. Günlük kota **kullanıcı başına
3 rapor** — bitince farklı bir e-postayla giriş yap.

Her senaryodan önce temiz başlamak için DevTools → Application → Storage → **Clear site data**.

---

## A. Eşik ve serbest dağılım — işin özü

### A1 🔍 Boş form
`/start` → sayaç **`0/6`**, altı segment sönük, CTA **pasif** ve `6 sinyal daha ekle`.
`Film & Diziler` sekmesinde sayı görünmez (0 iken sayı çıkmaz).

### A2 🔍 Eşiğin altı
3 kitap ekle → sayaç `3/6`, CTA `3 sinyal daha ekle`, hâlâ pasif.
Sekmede `Kitaplar 3` görünür.

### A3 ⚠️ **Film hiç girmeden rapor** — bu değişikliğin varlık sebebi
3 kitap + 3 müzik, **film sekmesine hiç dokunma** → sayaç yeşile döner,
`Hazırım. İstersen birkaç şey daha ekleyebilirsin · 6 sinyal`, CTA `Arketipimi göster` aktif.
Listenin altında not: *"Film & Diziler tarafında veri vermedin…"*
Devam et → rapor açılmalı. ✅ (uçtan uca üretildi)

### A4 🔍 Tek kategoriden 6
Yalnız 6 kitap → CTA aktif olmalı. ✅ (sunucuda 200 döndü)

### A5 🔍 Kategori tavanı
Bir kategoriye 8 sinyal ekle → giriş satırı ve *"Ekran görüntüsü ya da liste yapıştır"*
linki **gizlenir**, yerine *"Bu kategori dolu. Diğer sekmelerden devam edebilirsin."*
Diğer sekmelerde ekleme devam etmeli.

### A6 🔍 Silince eşik geri düşer
6 sinyalden birini `×` ile sil → CTA tekrar pasifleşip `1 sinyal daha ekle` demeli.

---

## B. Yazar / eser ayrı düzenleme — yeni gereksinim

### B1 ⚠️ Yazar bozulmadan eser adı eklemek
`Tezer Özlü` yaz (ayırıcısız → yazar alanına gider) → satırda ✎ →
**iki ayrı input** açılmalı: `Yazar / yönetmen / sanatçı` dolu, `Eser adı — boş kalabilir` boş.
Eser alanına `Yaşamın Ucuna Yolculuk` yaz → `Kaydet` →
satır `Tezer Özlü · Yaşamın Ucuna Yolculuk` olmalı. ✅

### B2 🔍 Kaynak rozeti düzenlemeden etkilenmez
İçe aktarımla gelmiş (`ekran görüntüsü` rozetli) bir satırı düzenle →
kaydettikten sonra rozet **hâlâ** `ekran görüntüsü` olmalı.
*Edinim yolu tarihsel bir gerçek; kullanıcının sonradan düzeltmesi onu değiştirmez.*

### B3 🔍 İki alan da boşken kaydedilemez
✎ → her iki alanı da temizle → `Kaydet` **pasif** olmalı. `Vazgeç` eski hâle döndürür. ✅

### B4 ⚠️ Yalnız eser adı doğru kolona yazılıyor mu
`Bulantı - ` gibi bir şey yazma; içe aktarımla ya da B1'deki gibi düzenlemeyle
yazarı boş, eseri dolu bir satır oluştur → raporu üret → Studio'da:

```sql
select type, creator, title, source from user_works order by created_at desc limit 8;
```

`creator IS NULL`, `title = 'Bulantı'` olmalı. ✅
*(Eski kodda tam tersi oluyordu: ayırıcısız metin hep yazar sanılıyordu.)*

### B5 🔍 Elle yazarken bölme kuralı
- `Yabancı - Albert Camus` → yazar `Albert Camus`, eser `Yabancı`
- `Sıcak - Soğuk Mevsimler - Camus` → **son** ayırıcıdan bölünür: eser `Sıcak - Soğuk Mevsimler`
- `Franz Kafka` → tamamı yazara gider

Yanlış bölündüyse düzeltme yolu ✎ — kural bu. ✅

---

## C. İçe aktarım (ekran görüntüsü / metin)

### C1 ⚠️ **2 eserlik import artık geçerli** — eski kodda bloklanıyordu
Kitaplar sekmesi → `Ekran görüntüsü ya da liste yapıştır` → metin yapıştır sekmesi →
yalnızca **2 satır** yapıştır → `Eserleri çıkar` → onay ekranında
`2 eserle devam et` butonu **aktif** olmalı.
Sonra 4 şarkı ekle → toplam 6 → CTA açılır.

### C2 🔍 Hiçbiri işaretli değilken
Onay ekranında tüm satırların işaretini kaldır → uyarı:
*"Rapora girecek en az bir eser işaretle…"* ve buton pasif.

### C3 🔍 İçe aktarım sürerken sekmeler kilitli
İçe aktarım açıkken sekme çiplerine bas → tıklanmamalı, altta
*"Önce bu listeyi onayla ya da vazgeç."* yazmalı. Formun alt CTA'sı **gizli** olmalı
(iki birincil buton yan yana durmasın).

### C4 🔍 Yükle/Yapıştır ekranının metinleri
Başlıkta `Yükle / Yapıştır`, üstte `‹ Geri`, sürükle alanında
*"Birden fazla görsel · aynı kategoriden birden çok liste olabilir"* ve
`Bilgisayardan dosya seç`. Buton `Eserleri çıkar`.

### C5 🔍 Dizi çıkarımı
Film sekmesinde bir dizi listesi (örn. Netflix ekran görüntüsü ya da düz metin
`Leyla ile Mecnun`, `The Bear`) yapıştır → diziler de çıkarılmalı, atlanmamalı.
*(`extract-works` artık "film ve dizi" diyor.)*

---

## D. Kalıcılık ve giriş köprüsü

### D1 ⚠️ Sayfa yenileme
4 sinyal gir → **hard reload** (Ctrl+Shift+R) → dördü de yerinde olmalı, sayaç `4/6`. ✅
*(Uygulama sırasında bulunan hata buydu: taslak yalnızca gönderimde yazılıyordu.)*

### D2 ⚠️ **Magic link — yeni sekme.** Asıl köprü testi.
Çıkış yapmış hâlde 6 sinyal gir → `Arketipimi göster` → e-posta modalı →
Mailpit'ten (http://127.0.0.1:54324) linki **yeni bir sekmede** aç.
Yeni sekmenin `sessionStorage`'ı boştur; taşımayı `lens_pending_report` yapar.
→ `/generating` → rapor açılmalı, sinyaller kaybolmamalı.

### D3 🔍 Aynı sekmede giriş
Zaten girişliyken 6 sinyal → CTA → doğrudan `/generating`, modal çıkmamalı.

### D4 🔍 Başarıda depo temizleniyor
Rapor açıldıktan sonra DevTools → Application:
`sessionStorage` içindeki `books`/`movies`/`music` ve `localStorage`'daki
`lens_pending_report` **silinmiş** olmalı.

### D5 🔍 Hatada taslak korunuyor
Rapor üretimi hata verirse (örn. kota dolduysa) → `Tekrar dene` `/start`'a
dönmeli ve **sinyaller yerinde durmalı** (`/`'a atmamalı).

### D6 🔍 Eksik taslakla /generating
Depoyu temizle, doğrudan `localhost:5173/generating` aç →
`/start`'a yönlenmeli (pazarlama sayfasına değil).

---

## E. Rota uyumluluğu

### E1 🔍 Eski rotalar
`/books`, `/movies`, `/music` → üçü de `/start`'a yönlenmeli. ✅

### E2 🔍 Giriş noktaları
Şu altı yerden `/start`'a gidilmeli: giriş sayfası `Başla`, Dashboard (2 buton),
ReportsPage (2 buton), rapor sayfasının alt bağlantısı.

---

## F. Rapor çıktısının dürüstlüğü ⚠️

Prompt düzenlemelerinin tek gerçek testi çıktıyı **okumak**.

### F1 ✅ Eksik kategori kabul ediliyor, sitem yok
6 kitap + 0 film + 0 müzik ile üretilen raporda:
- Boşluk **bir kez** ve doğal bir yerde geçmeli (örn. `texture`'ın son cümlesi:
  *"Bu portre bütünüyle okuduklarından çıktı."*)
- Özür / sitem / "şunu da ekle" tonu **olmamalı**
- `threads` ve `contrasts` boşluğa **hiç değinmemeli**
- Olmayan kategoriden konuşulmamalı (film zevkine dair çıkarım yok)

### F2 ✅ Öneriler yine 3 mecradan
`shadow` **tam 3**: 1 Kitap + 1 Film + 1 Müzik — kullanıcı film vermemiş olsa bile.
Film önerisi teşhis değil **davet** tonunda olmalı.
Rapor sayfasında öneri kartları 3'lü ızgarada bozulmadan durmalı.

### F3 🔍 **Regresyon kanaryası: 2+2+2**
Üç kategori de doluyken rapor **normal** okunmalı — dürüstlük cümlesi
buraya **sızmamalı**. İki kez üret ve ikisini de oku.

### F4 🔍 Girdi anlık görüntüsü
Studio'da:
```sql
select jsonb_array_length(books), jsonb_array_length(films),
       jsonb_array_length(songs), jsonb_array_length(shadow)
from reports order by created_at desc limit 3;
```
`films = 0` yasal; `shadow` her satırda **3** olmalı.

---

## G. Sunucu tarafı (doğrudan çağrı)

Token almak için (lokal demo anahtarlarıyla):

```bash
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
TOKEN=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"test@lens.local","password":"lens12345"}' | jq -r .access_token)
```

| # | Gövde | Beklenen | Durum |
|---|---|---|---|
| G1 | toplam 5 sinyal | 400 · *"toplam en az 6 sinyal gerekli"* | ✅ |
| G2 | 6+0+0 | 200 · `reportId` | ✅ |
| G3 | bir kategoride 9 eleman | 400 · *"en fazla 8 sinyal olabilir"* | ✅ |
| G4 | `{title:"",creator:""}` içeren sinyal | 400 · *"en az bir ad olmalı"* | ✅ |
| G5 | 121 karakterlik ad | 400 · *"en fazla 120 karakter"* | ✅ |
| G6 | **eski `string[]` biçimi** + paralel `sources`/`work_ids` | 200 | ✅ |
| G7 | 4. rapor (aynı gün, aynı kullanıcı) | 429 · günlük kota | 🔍 |

G6 önemli: deploy anında 60 dakikalık TTL içinde bekleyen eski kayıtlar bu yoldan tamamlanır.

---

## H. Geriye uyumluluk (deploy anı) ⚠️

### H1 🔍 Eski 9 anahtarlı sessionStorage taslağı
DevTools → Console'da eski akışın bıraktığı hâli taklit et:

```js
sessionStorage.setItem("books", JSON.stringify(["Yabancı - Albert Camus","Bulantı"]));
sessionStorage.setItem("books_sources", JSON.stringify(["screenshot","manual"]));
sessionStorage.setItem("books_work_ids", JSON.stringify(["",""]));
location.href = "/start";
```
İki sinyal listede görünmeli, kaynak rozetleri korunmalı, eski `*_sources` /
`*_work_ids` anahtarları temizlenmiş olmalı. ✅

### H2 🔍 Eski `lens_pending_report`
`localStorage`'a eski biçimi (kategori başına `string[]` + `sources`/`workIds`
nesneleri + `savedAt: Date.now()`) yaz → `/generating` aç → rapor üretilmeli. ✅

---

## I. Mobil (390 px)

### I1 🔍 Yerleşim
Yatay kaydırma **olmamalı**; başlık sarmalı, satırlarda eser adı yazarın altına inmeli. ✅

### I2 🔍 Yapışkan CTA
Alt kenarda tam genişlik, arkasında zemin olmalı (alttaki satırla iç içe geçmemeli).
Sayfanın sonuna kadar kaydırınca boş kategori notu okunabilmeli. ✅

---

## J. Bozulmamış olmalı (regresyon)

- 🔍 Giriş sayfası açılıyor, `Giriş yap` modalı çalışıyor
- 🔍 Dashboard rapor listesi, `/report/:id`, public/private toggle
- ⚠️ **RLS:** `is_public = false` bir rapor, çıkış yapmış bir tarayıcıda (gizli sekme)
  açılmamalı
- 🔍 Günlük keşif (`daily-discovery`) hâlâ öneri döndürüyor
- 🔍 `/settings` haftalık seçki toggle'ı

---

## Bilinen sınırlar

- **Google OAuth lokalde çalışmaz** — magic link ile test et (D2).
- Kota kullanıcı başına günde 3 rapor; F3 için iki rapor gerekiyor, planla.
- `npm run dev` (localdb'siz) **production'a** yazar. Banner'da `localdb` yazdığından emin ol.
