# Lens'te unit test yazımı

`fill` modunda ya da elle test yazarken oku. İçindekiler:
[Yerleşim](#yerleşim) · [Saf fonksiyon](#saf-fonksiyon) · [Edge function](#edge-function) ·
[src/lib (Supabase'li)](#srclib-supabaseli) · [api/ endpoint'i](#api-endpointi) ·
[Bileşen (kapı) testleri](#bileşen-kapı-testleri) · [Bekçi testleri](#bekçi-testleri) ·
[Ağ, saat, log](#ağ-saat-log) · [Neyi sına, neyi sınama](#neyi-sına-neyi-sınama) ·
[Mutasyon denetimi](#mutasyon-denetimi) · [Tuzaklar](#tuzaklar)

## Yerleşim

| Kaynak | Test | Ortam |
|---|---|---|
| `src/lib/*.ts` | `tests/lib/<ad>.test.ts` | jsdom (localStorage, document) |
| `src/app/**`, `src/pages/**` içindeki KAPILAR | `tests/ui/<ad>.test.tsx` | jsdom + react-dom |
| `api/**` | `tests/api/<ad>.test.ts` | node |
| `supabase/functions/**` | `tests/functions/<ad>.test.ts` | node + Deno köprüsü |
| depo kuralları, elle-senkron kopyalar, metin ↔ kod | `tests/guards/*.test.ts` | node + Deno köprüsü |

Testler kaynağın YANINA konmaz: `api/` altındaki her `.ts` Vercel'de endpoint olur,
`supabase/functions/` altı Deno'nun alanıdır. Yardımcılar `tests/helpers/`, kurulum `tests/setup/`.

Test adları Türkçe ve kuralı söyleyen bir cümledir ("geçersiz token → 403 ve veritabanına HİÇ
gidilmez"). Test bir olaydan, bir CLAUDE.md kuralından ya da bir hukuki sözden doğduysa üstüne tek
satır yorumla NEDENİNİ yaz — düştüğünde okuyan kişi neyin tehlikede olduğunu oradan anlar.

## Saf fonksiyon

En ucuz ve en değerli testler. Tablolar için `it.each`:

```ts
it.each([
  ["Yeşil Işın", "yesil isin"],
  ["Into the Wild", "into the wild"], // noktasız I tuzağı
])("%j → %j", (raw, folded) => expect(foldName(raw)).toBe(folded));
```

## Edge function

**Bir test dosyası = bir `index.ts`.** `Deno.serve` son import edilenin handler'ını tutar; iki
fonksiyonu aynı dosyaya koyma. (`_shared/*`, `prompt.ts`, `email.ts`, `workCheck.ts` normal modüller,
serbestçe import edilir. Handler kullanmayan `sync.test.ts` gibi dosyalar birden çok `index.ts`
import edebilir.)

```ts
import * as analyze from "../../supabase/functions/analyze/index.ts";
import { authedPost, claudeResponse, edgeHandler, internals, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryCall } from "../helpers/fake-supabase";

const { parseEntry, normalizeCategory } = internals(analyze); // export EDİLMEYEN üst düzey bildirimler

describe("handler", () => {
  const handler = edgeHandler(); // Deno.serve'e verilen fonksiyon

  beforeEach(() => {
    resetEdgeSupabase();          // varsayılan: createClient HATA verir
    stubEdgeEnv({ WEEKLY_PICKS_SECRET: "s" }); // SUPABASE_URL, SERVICE_ROLE, ANTHROPIC hazır gelir
  });

  it("Authorization yoksa 401 döner ve veritabanına hiç gitmez", async () => {
    const res = await handler(request("POST", { body: {} }));
    expect(res.status).toBe(401);
    expect(createClientCalls).toHaveLength(0); // "gidilMEdi"nin kanıtı
  });
});
```

Üretim kodu test için DEĞİŞMEZ: `internals(mod)` ve `https://esm.sh/...` yönlendirmesi
`vitest.config.ts`'teki `edgeFunctions` eklentisinden gelir. Yeni bir uzak import (`https://…`,
`npm:`, `jsr:`) eklenirse eklentiye bir yönlendirme daha gerekir — test "Only URLs with a scheme
in: file and data" diye düşerse sebep budur.

### Sahte Supabase

```ts
const fake = fakeSupabase({
  user: { id: "user-1" },                                   // auth.getUser / getSession / onAuthStateChange; null = oturum yok
  tables: {
    reports: (q: QueryCall) => (q.has("insert") ? { data: { id: "r1" } } : { count: 0 }),
    user_preferences: { data: [] },                          // sabit yanıt
  },
  rpcs: { lens_blocked_works: { data: [] } },
});
useEdgeSupabase(fake.client);
```

- Tanımsız tablo/RPC **hata verir**: testin beklemediği veritabanı erişimi sessizce geçmez.
- Zincirdeki her metot kaydedilir: `fake.callsTo("reports")[0].arg("insert")`,
  `q.ops.find((op) => op.method === "eq")?.args`, `q.has("delete")`.
- Aynı tabloya farklı işlemler aynı yanıtlayıcıya düşer; `q.has("update")` / `q.has("select")` ile ayır.
- `auth.admin.deleteUser`, `getUserById` `vi.fn` — `mockResolvedValue` ile değiştirilir.

## src/lib (Supabase'li)

`@/lib/supabase` modülü sahtelenir; istemci her testte yeniden verilir:

```ts
vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

beforeEach(() => {
  fake = fakeSupabase({ user: { id: "user-1" }, rpcs: { record_feedback: { data: "f1" } } });
  useWebSupabase(fake.client);
});
```

Yüklenirken durum kuran modüller (`posthog.ts`: rıza; `entitlements.ts`: önbellek) için her testte
taze kopya al: `vi.resetModules()` + `await import("@/lib/…")`. `import.meta.env` değerleri
`vi.stubEnv("VITE_…", "…")` ile verilir. `src/lib/supabase.ts`'in KENDİSİ sınanırken
`@supabase/supabase-js` sahtelenir (bkz. `tests/lib/supabase.test.ts`).

## api/ endpoint'i

Handler'lar `fakeReq` / `fakeRes` ile çağrılır (`tests/helpers/http.ts`). Gizlilik kararı
(`loadReport`) ve çizim (`render`) ayrı sınandığı için handler testinde ikisi sahtelenir; sınanan,
handler'ın o sonuçlarla ne yaptığıdır (durum kodu, önbellek başlığı, sızan içerik). `api/` içi
importlar `.js` uzantılıdır; test `.ts` yazabilir, ikisi aynı modüle çözülür.

## Bileşen (kapı) testleri

Bu depoda bileşen testi **yalnızca kapılar** için yazılır: "X olmadan Y başlamaz" diyen kurallar
(rıza kutusu işaretlenmeden giriş başlamaz; onay verilmeden hesap silinmez; premium kapalıyken paket
kelimesi kurulmaz; `Verilerim` hiçbir anahtara bağlanmaz). Görünüm, düzen ve metin tonu sınanmaz —
onlar her tasarım değişikliğinde kırılır ve hiçbir kuralı korumaz.

Araç takımı `tests/helpers/render.tsx` (yeni bağımlılık yok, yalnızca react-dom):

```tsx
vi.mock("@/lib/supabase", async () => ({
  ...(await import("../helpers/web-supabase")).supabaseModuleMock(),
  signInWithGoogle: vi.fn(async () => ({ error: null })),   // bileşenin çağırdığı sarmalayıcılar
}));

afterEach(async () => { await unmountAll(); });

it("kutu boşken Google girişi BAŞLAMAZ", async () => {
  await mount(<Login />, { route: "/login" });      // MemoryRouter içinde çizer
  await click(button("Google ile Devam Et"));       // metni TAM eşleşen düğme
  expect(signInWithGoogle).not.toHaveBeenCalled();
  expect(query('[role="alert"]').textContent).toBe("Devam edebilmem için bu izne ihtiyacım var.");
});
```

- `button(metin)` · `hasButton` · `query(seçici)` · `click` · `type(input, değer)` ·
  `press(hedef, "Escape")` · `pageText()` · `currentPath()` (yönlendirme sonrası yol).
- Radix diyalogları `document.body`'ye taşınır; yardımcılar bütün belgede arar. Diyalog
  `[role="alertdialog"]` / `[role="dialog"]`, onay kutusu `[role="checkbox"]` + `aria-checked`,
  anahtar `[role="switch"]`.
- Bileşenin içe aktardığı `@/lib/*` modüllerini sahtelerken sabitleri korumak için
  `importOriginal` kullan (`WEEKLY_PICKS_EMAIL_PAUSED` gibi bayraklar gerçek kalsın).
- Durum kuran bir modüle (`posthog.ts`) dayanan bileşen her testte taze yüklenir:
  `vi.resetModules()` → `vi.stubEnv` → sahte dönüşleri kur → `await import("@/pages/Account")`.
  `react` ve `react-router` node_modules'tan gelir, yeniden yüklenmez; kanca hatası çıkmaz.
- Bayrağa bağlı beklentiyi bayraktan türet: `expect(headings().includes("Tercihlerim")).toBe(!emailPaused)`.
- jsdom ölçü bilmez (`offsetHeight` hep 0): ölçüye dayanan davranışta getter'ı
  `vi.spyOn(HTMLElement.prototype, "offsetHeight", "get")` ile ver.

## Bekçi testleri

`tests/guards/` davranış değil KAYNAK sınar:

- `repo-rules.test.ts` — CLAUDE.md kuralları (api importlarında `.js`, `posthog-js` tek kapı,
  `verify_jwt`, rota yönlendirmeleri, migration kuralları…). Yeni bir kural kodla denetlenebiliyorsa
  buraya girer.
- `sync.test.ts` — elle senkron tutulan kopyalar (form sınırları, edinim yolu sözlüğü, yasak liste
  kırpması, eksen eşikleri, teklif tipleri). Yeni bir kopya doğduğunda buraya bir karşılaştırma ekle.
- `kvkk.test.ts` — **hukuki metin ↔ kod.** Metindeki her somut iddia bir sözdür ve kodla birlikte
  değişir: koddaki her dış adres sınıflandırılmış mı (`HOSTS`), her `localStorage` anahtarı Çerez
  Politikası'nda mı, IP saklama süresi kota temizliğiyle aynı mı, üç analitik metni aynı şeyi söylüyor
  mu, giriş başlatan her bileşen rıza kutusunu çiziyor mu, `user_consents` şeması istemciyle uyuşuyor
  mu. Bu dosyadaki bir test düştüğünde iki doğru cevap vardır: kodu sözüne döndür ya da metni (gerekirse
  rıza sürümünü) güncelle. Testi tek başına değiştirmek, verilmiş sözü sessizce değiştirmektir.
- `test-env.test.ts` — testlerin production'dan yalıtımı. Dokunma; düşerse önce onu çöz.

Migration kuralları **ileriye dönüktür**: eski dosyalar tarihsel kayıttır ve çoğu kuralı çiğner
(düzeltmeleri sonraki migration'da geldi). Kural, düzeltmenin geldiği dosyanın zaman damgasından
SONRAKİ migration'lara uygulanır (`after("20261011093000")`).

Bir kural bilerek değişirse bekçi testi CLAUDE.md ile aynı değişiklikte güncellenir.

Bekçi yazarken iki şeyi unutma: taramanın **boş kalmadığını** sına (bulunan dosya/anahtar sayısına
alt sınır koy — yanlış bir yol ya da regex, her şeyi "temiz" gösterir) ve bekçiyi mutasyonla doğrula.

## Ağ, saat, log

- **Ağ yasak.** `tests/setup/common.ts` mock'lanmamış her `fetch`'i hataya çevirir. İhtiyacı olan
  test `vi.stubGlobal("fetch", vi.fn(async (url, init) => …))` verir; test bitince bekçiye dönülür.
  `Response` gövdesi bir kez okunur: yanıtı her çağrıda yeniden kur ya da `.clone()` ver.
- **Saat.** Yalnızca "şimdi" gerekiyorsa `vi.useFakeTimers({ toFake: ["Date"] })` +
  `vi.setSystemTime(…)` — zamanlayıcılar gerçek kalır, `await`'ler takılmaz. `setTimeout`'u da
  sahteleyeceksen (`send-weekly-picks`'teki 600 ms bekleme gibi) handler'ı bekletmeden başlat ve
  bitene kadar `vi.advanceTimersByTimeAsync` ile ilerlet. `crypto.subtle` gerçek asenkron iştir;
  sahte saat onu ilerletmez (`setImmediate` bilerek sahtelenmez, onunla beklenir).
  "Bugün" İstanbul günüdür: gün sınırı testlerinde UTC 21:00–24:00 arasını kullan.
- **Log.** `console.error/warn/log` her testte susturulur ama sayılır:
  `expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[watch]"))`.

## Neyi sına, neyi sınama

Sına:
- **Sözleşmeyi**: hangi tablo/RPC, hangi payload, hangi sırayla. `plan` payload'a girmiyor mu,
  `user_id` JWT'den mi geliyor, `upsert` seçenekleri doğru mu.
- **Olmayanı**: kapı testlerinin özü "yapılMAdı"dır — istemci kurulmadı, Claude çağrılmadı, mail
  atılmadı, satır yazılmadı, tarayıcıya hiçbir şey yazılmadı. Yalnızca durum kodunu sınayan kapı testi
  yarımdır (403 dönüp yine de yazan kod o testi geçer).
- **Sızmayanı**: dışarı giden istekte olmaması gereken şey — Claude'a giden gövdede e-posta ya da
  kullanıcı id'si, PostHog olayında ad, kota anahtarında yüklenen metin.
- **Hata yolunu**: fail-open mı fail-closed mı? CLAUDE.md hangisini istiyorsa onu.
- **Sınırları**: tam eşikte (6. sinyal, 60. dakika, 7. gün, ±1 yıl) ve bir yanında.
- **Türkçeyi**: I/İ, ı/i, büyük harf, iyelik eki. Bu depoda en çok hata buradan çıktı.

Sınama:
- Bilerek değişecek değerleri: model kimliği, `WEEKLY_PICKS_EMAIL_PAUSED`, premium anahtarının
  durumu, kural taşımayan arayüz metni. Lansman günü çevrilecek bir bayrağı `true` diye sabitleyen
  test, lansman günü yanlış sebepten düşer.
- Uygulamayı aynalayarak: `expect(TASLAK).toBe(!ad || !adres || !eposta)` kodun kendi ifadesini
  tekrar eder ve kural değişince (adres bilerek boşaltılınca) yanlış sebepten düşer. Değişmezi sına:
  "taslak değilse ad ve geçerli bir e-posta vardır".
- Uygulama ayrıntısını: özel yardımcının kaç kez çağrıldığı, ara değişkenlerin biçimi.
- Sahtenin kendisini: yanıtlayıcıya koyduğun veriyi geri okuyup doğrulamak hiçbir şey sınamaz.

## Mutasyon denetimi

Her kapı testi ve her bekçi için: kapıyı sağlayan TEK satırı boz, test düşmeli.

```
npm run test:mutate -- --file <dosya> --find "<satır>" --replace "<bozuk hâli>" --test <test dosyası>
npm run test:mutate -- <scratchpad>/mutasyonlar.json
```

JSON: `[{ "name": "…", "file": "…", "find": "…", "replace": "…", "test": "…" | ["…", "…"] }]`.
`find` dosyada tam bir kez geçmeli (satır sonları `\n` yazılır; CRLF dosyalarla da eşleşir).
Betik dosyayı bellekten geri yazar; `git checkout` kullanmaz (commit edilmemiş başka değişiklikleri
silerdi). Başka bir oturumun hâlâ üzerinde çalıştığı dosyada koşma.

İyi mutasyonlar kapının kendisini hedefler:

| Kapı | Mutasyon |
|---|---|
| Koşul | `if (!ok) {` → `if (false) {` |
| Varsayılan durum | `useState(false)` → `useState(true)` |
| Kıyas | `!== callSecret` → `=== "__asla__"` |
| Fail-open/closed | hata dalındaki `return true` ↔ `return false` |
| Muafiyet listesi | listeden bir öğeyi çıkar |
| Metin ↔ kod | metindeki sayıyı ya da koddaki sayıyı değiştir |

`YAKALANMADI` iki şeyden biridir:

- **Test boşluğu** — o satırı gerektiren girdi testte yok. Örnek: mail şablonundaki protokol denetimi
  `javascript:alert(1)` ile sınanıyordu ama onu zaten host denetimi durduruyordu; denetimi asıl
  gerektiren girdi `javascript://example.com/%0Aalert(1)` idi. Girdiyi ekle, yeniden koş.
- **Eşdeğer mutant** — mutasyon davranışı değiştirmiyor. Örnek: rıza kapısındaki `useState(false)`'ı
  `true` yapmak hiçbir şeyi değiştirmez, çünkü altındaki `useEffect` her kullanıcı değişiminde kutuyu
  sıfırlıyor. Nedenini bir cümleyle not et ve geç; testi zorlamaya çalışma.

## Tuzaklar

- **`\b` Türkçe harf tanımaz.** JS'te sözcük sınırı ASCII'dir: `/\bücretsiz\b/i` "Ücretsiz"i, `/\bpaket\b/`
  "pakette"yi kaçırır. Türkçe metinde kök ara (`/(premium|ücret|paket)/iu`), sınır koyma. Bir bekçi
  bu yüzden sessizce boşa geçiyordu; mutasyon yakaladı.
- **Taze modül yükleyen bileşen testi yük altında zaman aşımına düşer.** `vi.resetModules()` +
  `await import("@/pages/…")` kullanan bir dosyada İLK test, büyük import ağacının soğuk yüklemesini
  kendi süresinden öder; tam koşunun yükü altında bu 5 sn'yi aştı, test zaman aşımına düştü ve
  arkasında kalan yarım çizim aynı dosyadaki 13 testi daha düşürdü (tek başına koşunca hep yeşildi).
  Çare iki parça: soğuk yüklemeyi `beforeAll(async () => { await import("@/pages/…"); })` ile test
  süresinin dışına al; `mount` zaten testi bitmiş bir çizimi söküp hata verir. Bir dosyada çok sayıda
  test birden "ekran boş" diye düşüyorsa ilk düşenin süresine bak.
- **`clearMocks` açık**: modül yüklenirken yapılan çağrılar (ör. `createClient`) ilk testten önce
  silinir. O argümanları dosyanın üst düzeyinde, testler başlamadan al.
- **`vi.resetModules()` yardımcıları da yeniden yükler**: modül düzeyinde durum tutan bir yardımcı
  testin elindeki kopyadan ayrışır. `web-supabase.ts` bu yüzden durumu `globalThis`'te tutar.
- **Aynı dosyadaki testler sahte istemciyi paylaşır**: `useWebSupabase` / `useEdgeSupabase` bir
  önceki testten kalır. Her test kendi `setup()`'ını çağırsın — yoksa bir önceki testin hata dönen
  sahtesiyle koşar ve yanlış sebepten düşer.
- **Commit edilmemiş, hâlâ değişen koda yazılan test oynar.** Başka bir oturumun süren işine test
  yazdıysan bunu kullanıcıya söyle; o iş bitince `run` ile yeniden bak.
- **Aday tekilleştirme**: `normalizeCandidates` `title_en + yıl + tip` ile tekilleştirir; örnek
  adaylarına farklı `title_en` ver, yoksa "kayboldu" sanırsın.
- **jsdom yavaş açılır** (~1 sn/dosya): DOM/depolama gerekmeyen bir şey için `tests/lib`'e dosya
  eklemek yerine mevcut dosyaya test ekle ya da saf mantığı `tests/guards`'tan sına.
- **Test dosyasını betikle yamalarken kaçışlara dikkat**: şablon dizgesi içindeki `\n` gerçek satır
  sonuna dönüşür ve dosyayı bozar. Test dosyasına Edit/Write ile yaz.
- **Yeni `VITE_` değişkeni**: `vitest.config.ts` → `test.env`'e test değeri ekle (`.env*` dosyaları
  yüklenmez) ve `.env.example`'a belgele — bekçi testi ikincisini denetler.
- **Yeni endpoint ya da rota**: `repo-rules.test.ts`'teki endpoint listesi bilerek tamdır; yeni bir
  `api/` dosyası o testi düşürür. Listeyi güncelle ve endpoint'in testini yaz.
- **Kapsam bileşenleri de ölçer** ama tarama onları ayrı raporlar; `vitest.config.ts`'teki
  `coverage.include`'a yeni bir kaynak klasörü eklersen `unit-test-scan.mjs`'teki `isUi` ayrımına bak.
