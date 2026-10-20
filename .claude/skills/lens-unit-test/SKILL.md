---
name: lens-unit-test
description: Lens deposunun unit test paketini koşar, eksik testleri tarar, eksikleri yazar, yazılan testin gerçekten ısırdığını mutasyonla kanıtlar ve testleri belli aralıklarla koşturur. Lens'te testlerle ilgili HER işte bu skill'i yükle — kullanıcı "testleri koş", "unit test", "npm test", "bir şey bozuldu mu / kırdım mı", "eksik test var mı", "test taraması", "kapsam / coverage", "regresyon", "test yaz", "düşen testi çöz", "deploy/lansman öncesi kontrol", "testleri periyodik koş" dediğinde; src/lib, api/, supabase/functions ya da bir kapı taşıyan bileşende (giriş, rıza, hesap silme) değişikliği bitirip doğrulamak istediğinde; ya da hukuki metinlere, rıza akışına, yeni bir dış servise, yeni bir localStorage anahtarına ya da CLAUDE.md kurallarına dokunduğunda — açıkça "test" demese bile. Argümanlar — run · scan · fill · watch [aralık]; argümansız çağrı run + scan yapar.
---

# Lens unit testleri

Lens'in testleri `tests/` altında, Vitest ile koşar. Ağ yok, Supabase yok, Claude kredisi yok:
bütün paket lokalde bir dakikanın altında döner (boş makinede ~25 sn). Testlerin çoğu CLAUDE.md'deki bir "Kritik kural"ın, canlıya
çıkmış bir hatanın ya da kullanıcıya verilmiş bir sözün (hukuki metin) karşılığıdır — o yüzden düşen
bir test çoğu zaman "test eskidi" değil, "kural çiğnendi" demektir.

| Komut | Ne yapar |
|---|---|
| `npm run test:report` | Hepsini koşar; önceki koşuyla karşılaştırır (yeni düşen, son yeşilden beri değişen dosyalar) |
| `npm run test:scan` | Kapsam ölçümüyle koşar; testlerin hiç çalıştırmadığı kodu raporlar |
| `npm run test:mutate -- …` | Bir satırı geçici olarak bozar, ilgili testin DÜŞTÜĞÜNÜ doğrular, geri yazar |
| `npm test` / `npm run test:watch` | Çıplak koşu / dosya değiştikçe yeniden koşan izleme modu |
| `npx vitest run tests/functions/analyze.test.ts` | Tek dosya |

| Klasör | Ne sınar |
|---|---|
| `tests/lib/` | İstemci mantığı (`src/lib`) |
| `tests/api/` | Poster, OG ve link önizlemesi (`api/`) |
| `tests/functions/` | Edge function'lar — üretim kodu değişmeden, Node'da |
| `tests/ui/` | Bileşenlerdeki **kapılar**: rıza kutusu, giriş kapısı, analitik bandı, hesap silme, Hesabım |
| `tests/guards/` | Kaynak taraması: CLAUDE.md kuralları, elle-senkron kopyalar, hukuki metin ↔ kod, test yalıtımı |

Durum `tmp/unit-test/` altında tutulur (`tmp/` .gitignore'da): `last-run.json`, `last-green.json`,
`history.jsonl`, `scan.json`.

## Hangi mod?

Argümana bak; yoksa kullanıcının cümlesinden çıkar.

- **argümansız** → `run`, yeşilse ardından `scan` özeti.
- **`run`** → koş ve raporla.
- **`scan`** → eksikleri belirle ve raporla. Test YAZMA; kullanıcı yalnızca neyin eksik olduğunu sordu.
- **`fill`** (ya da "eksikleri kapat / yaz / tamamla") → `scan`, sonra eksik testleri yaz ve mutasyonla doğrula.
- **`watch [aralık]`** → aralıklı koşu kur.

## run — koş ve raporla

`npm run test:report` çalıştır. Çıkış kodu: 0 yeşil · 1 düşen test var · 2 koşu hiç başlayamadı.

**Yeşilse** tek satır yeter: kaç test, kaç saniye, son yeşilden beri dosya değişti mi. Bin testin
adını sayma.

**Düşen varsa** her yeni düşen için teşhis koy, sonra raporla:

1. Testi ve sınadığı kodu oku. Betiğin "son yeşil koşudan beri değişen dosyalar" listesi şüpheliyi
   çoğu zaman doğrudan verir.
2. Karar ver: **kod mu bozuldu, kural mı bilerek değişti?** Varsayılan birincisi. İkincisinin kanıtı
   kodda değil niyettedir — CLAUDE.md'de güncellenmiş bir kural, değişen satırın yanındaki gerekçeli
   yorum, kullanıcının bu oturumdaki isteği ya da commit mesajı. Kanıt yoksa kural değişmemiştir.
3. Kod bozulduysa: neyin, hangi satırda, hangi kuralı çiğnediğini söyle. Üretim kodunu **kullanıcı
   istemeden düzeltme** — özellikle lansman/deploy öncesinde "neyin değişeceğine" o karar verir;
   düzeltmeyi öner, onay gelince yap.
4. Kural bilerek değiştiyse: testi kuralla BİRLİKTE güncelle ve neyi neden değiştirdiğini söyle.
   Güncellerken uygulamayı aynalama (`beklenen = kodun yaptığı hesap`); değişmeyeni sına.

Bir testi geçsin diye doğrulamasını gevşetme, `skip`/`todo` yapma ya da silme. Yeşil bir paket ancak
kırmızı olabildiği sürece bilgi taşır; susturulan test, bir dahaki sefere aynı hatayı sessizce geçirir.

**Kod değişmeden düşen test kararsızdır** ("son yeşil koşudan beri değişen dosya yok" + düşen test).
Yeniden koşup yeşili görünce geçme: kararsız test, paketin verdiği her sonucun değerini düşürür.
Dosyayı tek başına birkaç kez koş (`npx vitest run <dosya>`), `tmp/unit-test/vitest.json`'da o dosyanın
İLK düşen testine ve sürelere bak. Betik zaman aşımını ayrıca işaretler: zaman aşımına düşen bir test
arkasında yarım iş bırakır ve aynı dosyadaki sonraki testleri de düşürür — zincirin ilk halkasını çöz,
gerisi kendiliğinden düzelir. Bilinen kök nedenler `references/test-yazimi.md` → Tuzaklar'da.

Koşu başlamadıysa (kod 2) en sık iki sebep: yeni bir import'un `tests/`'teki sahteleriyle uyuşmaması
(çıktının sonunu oku) ve bellek darlığı ("Failed to start forks worker" — `vitest.config.ts`'teki
`maxWorkers` bu yüzden 3; makine doluysa tek dosyayla dene).

## scan — eksik testleri belirle

`npm run test:scan` çalıştır. Rapor dört bölümdür:

1. **Çekirdekte hiç testi olmayan dosyalar** — `src/lib`, `api`, `supabase/functions` altında tek
   satırı bile çalışmamış. Genellikle yeni eklenmiş modül. Bunlar eksiktir.
2. **Çekirdekte kısmen sınanan dosyalar** — hiç çalışmayan fonksiyon adları ve satır aralıklarıyla.
   `DEĞİŞTİ` işaretliler son yeşil koşudan beri dokunulmuş olanlardır: önce onlar.
3. **Bileşenler ve sayfalar** — hangisini bir test çiziyor, hangisini çizmiyor. Bileşen testi yalnızca
   KAPI için yazılır, o yüzden "çizilmeyen" sayısı eksik sayısı değildir. Ama her çizilmeyen (özellikle
   `DEĞİŞTİ` işaretli) dosya için şunu sor: **içinde "X olmadan Y başlamaz" diyen bir kural var mı?**
   Giriş, rıza, ödeme, silme, paylaşım/gizlilik onayı varsa eksiktir.
4. **Ölçümün göremediği yerler** — SQL fonksiyonları, prompt çıktı kalitesi. Bunları "eksik test" diye
   sayma ama raporda TUT: "kapsam %98" cümlesi, o %98'in neyin yüzdesi olduğu söylenmeden yanıltır.

Kapsam bir alt sınırdır, kanıt değil: çalışmış satır doğru sınanmış satır demek değildir. Betiğin
göremediği dört şeye ayrıca bak:

- **Yeni kurallar.** CLAUDE.md'ye son eklenenleri oku (`git diff -- CLAUDE.md` ve
  `git log -p -8 -- CLAUDE.md`): hem "Kritik kurallar" hem "Veri akışı" bölümleri. Kodla
  denetlenebilen her kural için `tests/`'te karşılığını ara (`Grep` ile kuralın anahtar kelimesini).
  Yoksa eksik testtir — kapsam %100 olsa bile.
- **Yeni sözler.** Hukuki metinler (`src/pages/Legal.tsx`, `src/lib/legal.ts`), rıza cümlesi ve
  analitik bandı kullanıcıya söz verir. Metne giren her yeni somut iddia (bir süre, bir servis, bir
  "saklanmaz") için `tests/guards/kvkk.test.ts`'te karşılık ara.
- **Yeni elle-senkron kopyalar.** Kodda "elle senkron" diye geçen her sayı/sözlük
  `tests/guards/sync.test.ts`'te karşılığını bulmalı (`Grep "elle senkron|ELLE senkron"`).
- **Yüzeysel testler.** Riskli bir dosyanın (yetki, gizlilik, para, mail) kapsamı tam görünüyorsa
  bile testine göz at: kapıyı sınıyor mu ("çağrılMAdı", "yazılMAdı"), yoksa yalnızca mutlu yolu mu?
  Emin değilsen kapı satırını `npm run test:mutate` ile boz; test düşmüyorsa eksiktir.

Raporu şu kalıpla ver; uzun dökümü değil, karar verdireni:

```
Testler: N geçti / M düştü · çekirdek kapsam satır %X · fonksiyon %Y
Eksikler (öncelik sırasıyla):
1. <dosya ya da kural> — <neyin sınanmadığı, bir cümle> — <neden önemli: hangi kural / hangi risk>
2. ...
Kapsam dışı: <SQL · sınanmayan bileşenler · prompt çıktısı — bir satır>
Öneri: <sıradaki somut adım>
```

## fill — eksik testleri yaz

Yazmadan önce `references/test-yazimi.md`'yi oku: yerleşim, yardımcılar, kalıplar ve bu depoya özgü
tuzaklar orada. Sıra:

1. Son değişen ve sınanmayan kod.
2. Kapılar: yetki, gizlilik, rıza, para harcayan çağrılar (Claude, erişilebilirlik API'si), mail, silme.
3. Sözler: metnin koda uyması (hukuki metin, rıza cümlesi, analitik bandı).
4. Saf mantık: ayrıştırma, normalizasyon, biçimlendirme.
5. Gerisi.

Üretim kodunu test edilebilsin diye **değiştirme**. Edge function'ların export edilmeyen
fonksiyonlarına `internals(mod)` ile, handler'larına `edgeHandler()` ile, bileşenlere `mount()` ile
zaten erişiliyor. Erişilemeyen bir şey varsa (bileşen dosyasında kalmış saf fonksiyon gibi) dışarı
almayı öner, kendin yapma.

Yazarken bir hata bulursan — test, kodun CLAUDE.md'de ya da kendi yorumunda yazandan farklı
davrandığını gösteriyorsa — testi geçsin diye beklentiyi koda uydurup geçme. Kullanıcıya bulguyu
söyle; testi ya doğru davranışı bekleyecek şekilde (kırmızı) bırak ya da mevcut davranışı
*gerekçesini yazarak* sabitle. Hangisini seçtiğini raporda belirt.

**Yazdığın her kapı testini mutasyonla doğrula.** İlk koşuda geçen test bir şey kanıtlamaz; kapıyı
sağlayan satırı bozunca düşen test kanıtlar:

```
npm run test:mutate -- --file src/app/components/Login.tsx \
  --find "const [consent, setConsent] = useState(false);" \
  --replace "const [consent, setConsent] = useState(true);" \
  --test tests/ui/transferConsent.test.tsx
```

Birden çok mutasyon için JSON dosyası ver (`[{name, file, find, replace, test}]`; dosyayı scratchpad'e
yaz, depoya değil). Betik dosyayı bellekten geri yazar ve geri yazamazsa bunu söyler (çıkış kodu 3).
`YAKALANMADI` çıkan her satır için iki ihtimal var: test o satırı gerektiren girdiyi içermiyordur
(ekle) ya da mutasyon davranışı değiştirmiyordur (eşdeğer mutant — nedenini bir cümleyle söyle, geç).
Kaynak taraması yapan bekçi testlerini de aynı şekilde doğrula: regex'ler sessizce boşa geçebilir.

Bitince `npm run test:report` ile hepsini koş ve sonucu gerçek sayılarla raporla: kaç test eklendi,
kaç mutasyon yakalandı, ne bulundu, ne bilerek dışarıda bırakıldı.

## Değişiklik türüne göre: hangi test devreye girer

Bir değişikliğin ardından neye bakılacağını, bir test düştüğünde de neden düştüğünü buradan oku.

| Değişiklik | Kendiliğinden düşen bekçi | Senin eklemen gereken |
|---|---|---|
| Yeni dış servis / yeni `https://` adresi | `kvkk.test.ts` → adres sınıflandırması | Kişisel veri gidiyorsa `PROCESSORS` + Aydınlatma Metni; gitmiyorsa listeye `null` ve gerekçe |
| Yeni `localStorage` anahtarı | `kvkk.test.ts` → Çerez Politikası tablosu | Tabloya satır |
| Saklama süresi (kota temizliği, taslak ömrü) | `kvkk.test.ts` → süre ↔ metin | Metindeki sayı; ömrün davranış testi |
| Rıza kapsamı (yeni ülke, yeni alıcı türü) | `tests/lib/transferConsent.test.ts` → sürüm ↔ kapsam | `TRANSFER_CONSENT_VERSION` + `SCOPE_BY_VERSION`'a satır |
| Yeni giriş ekranı / giriş başlatan bileşen | `kvkk.test.ts` → giriş yolları | Rıza kutusu + `tests/ui`'de "kutu boşken başlamaz" |
| PostHog'da yeni veri türü | `kvkk.test.ts` → üç metin | Bant, Hesabım kartı ve Çerez Politikası birlikte |
| Yeni `api/` endpoint'i | `repo-rules.test.ts` → endpoint listesi | Listeyi güncelle + `tests/api`'de handler testi |
| Yeni edge function | — | `tests/functions/<ad>.test.ts` (dosya başına TEK fonksiyon) |
| Yeni üretici prompt | — | `sync.test.ts`'e hassas çıkarım + Türkçe karakter kuralı |
| Yeni migration | `repo-rules.test.ts` → CASCADE, yetki yüklemi, `reports` politikası | Tabloyu okuyan/yazan istemcinin testi; şema ↔ istemci eşleşmesi |
| Yeni rota | `repo-rules.test.ts` → eski rotalar yönlenir | Rota listesine ekle |
| Yeni `VITE_` değişkeni | `repo-rules.test.ts` → `.env.example` | `vitest.config.ts` → `test.env`'e test değeri |
| Elle senkron tutulan yeni sayı/sözlük | — | `sync.test.ts`'e karşılaştırma |

## watch — aralıklı koşu

Kullanıcı testlerin belli aralıklarla koşmasını istediğinde üç yol var; hangisi istendiği belli
değilse birincisini kur, diğer ikisini bir cümleyle söyle.

**1. Oturum içi döngü (varsayılan).** Skill aracıyla `loop` skill'ini şu argümanla çağır:
`<aralık> /lens-unit-test run` — aralık verilmediyse `30m`. Her turda `run` adımlarını uygula ama
sessiz ol: yeşil ve dosya değişmemişse tek satır; yeni düşen varsa tam teşhis. Aynı düşen testi
her turda baştan anlatma — "hâlâ düşüyor" de. Döngü oturum açıkken yaşar.

**2. Değişiklik tetikli.** `npm run test:watch` kullanıcının kendi terminalinde koşar ve dosya
kaydedildikçe ilgili testleri yeniden çalıştırır. Aktif geliştirme sırasında aralıklı koşudan iyidir.

**3. Oturum dışı zamanlama.** Makine düzeyinde bir görev, Claude kapalıyken de koşar ve sonucu
`tmp/unit-test/history.jsonl`'e yazar. Bu sistemde kalıcı bir değişikliktir: **yalnızca kullanıcı
açıkça isterse** kur, komutu göstererek:

```
schtasks /Create /TN "Lens unit testleri" /SC HOURLY /MO 2 /TR "cmd /c cd /d <depo yolu> && npm run test:report >> tmp\unit-test\scheduled.log 2>&1"
schtasks /Delete /TN "Lens unit testleri" /F        (kaldırmak için)
```

Zamanlanmış koşuların sonucunu görmek için `tmp/unit-test/history.jsonl`'i oku (her satır bir koşu:
zaman, commit, toplam, düşen) — bir sonraki `run` zaten "önceki koşu" satırında özetler.

## Bu paketin sınamadığı şeyler

Yeşil paket "lansmana hazır" demek değildir. Şunlar burada YOK ve "her şey test edildi" derken
söylenmeli:

- **Veritabanı**: `record_feedback`, `lens_blocked_works` sırası, `lens_work_key`, RLS politikalarının
  gerçekten ne döndürdüğü, CASCADE, trigger'lar, pg_cron işleri, premium anahtarı. Testler bunları
  sahte istemciyle geçer; bekçiler yalnızca migration METNİNE bakar. Doğrulaması lokal Supabase ister
  (`docs/gelistirme.md`, `docs/schema.md`).
- **Arayüzün çoğu**: yalnızca kapı taşıyan beş bileşen sınanıyor. Görünüm, düzen, onboarding akışı,
  rapor sayfası, poster paylaşımı — elle senaryolar `docs/test-senaryolari.md`'de.
- **Üretici çıktısı**: prompt'un Claude'a ne yazdırdığı (Türkçe karakter, uydurma eser, hassas
  çıkarım). Kod değil ölçüm işi; bkz. CLAUDE.md'deki A/B notları.
- **Gerçek entegrasyonlar**: Resend, movieofthenight, Open Library, Wikidata, PostHog, Google girişi —
  hepsi sahte.
- **Hukuki yeterlilik**: bekçiler metnin KODA uyduğunu sınar, kanuna uyduğunu değil.

## Güvenlik

Testler production'a dokunamaz ve dokunmamalı: `.env.local` hiç yüklenmez (`envDir: false`),
mock'lanmamış her `fetch` hata verir, edge function'lar gerçek Supabase istemcisi kuramaz.
`tests/guards/test-env.test.ts` bunu sınar — o dosya düşerse başka hiçbir sonuca güvenme ve önce
onu çöz. Bu skill hiçbir modda `npm run dev`, `supabase`, deploy ya da gerçek API çağrısı gerektirmez.

`test:mutate` üretim dosyasını birkaç saniyeliğine bozar. Başka bir oturum aynı dosya üzerinde
çalışıyorsa (commit edilmemiş, hâlâ değişen iş) o dosyada mutasyon koşma; kullanıcıya söyle.
