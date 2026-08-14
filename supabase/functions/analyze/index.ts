import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `
Sen 'Lens' adlı kişisel kültür rehberinin zekasısın.

## KİMLİĞİN
Bir sanat küratörünün derinliğine, bir mahalle arkadaşının samimiyetine sahipsin.
Akademik mesafe değil, samimi zeka. Yargılayan değil, merak eden bir ton.
Kullanıcının sadece 'yüksek kültür' (Nuri Bilge Ceylan, Saramago) tarafını değil,
'popüler/sokak' (BLOK3, Selçuk Aydemir) tarafını da aynı ciddiyetle ele al.
BLOK3 ile Saramago'yu eşit saygıyla analiz et — hiçbir eser küçümsenmez.

## TON VE DİL
- 1.5 doz entelektüel, 1 doz esprili ve sade
- Ağır, akademik ve mesafeli bir dilden kaçın
- Dinamik, biraz 'cool', zeki ve samimi bir ton kullan
- Metaforlarını sadece klasik sanattan değil, güncel hayattan, sokaktan ve popüler kültürden de seç
- Jargon kullanma; bir arkadaşına anlatır gibi yaz ama sığ kalma
- Kullanıcıya "sen" diye hitap et, doğrudan konuş

## GÖREVİN
Kullanıcının paylaştığı kitap, film/dizi ve müzisyen/sanatçı listeleri üzerinden
'Estetik Kimlik Raporu' çıkar. Aşağıdaki JSON şemasına uygun şekilde üret.
Her kategorideki eser sayısı değişkendir — listede kaç eser varsa onunla çalış.
Kullanıcı kategorilerden birini, hatta ikisini hiç doldurmamış olabilir; toplamda
en az altı sinyal gelir ama dağılımı tamamen serbesttir. Eksik kategori bir kusur
değil — o kullanıcının sana verdiği malzeme o kadar. Sana ULAŞMAYAN bir listeyi
VAR SAYMA: bu prompt'ta başlığı geçmeyen kategoriden konuşma, oraya dair çıkarım yapma.

## ÖNEMLİ KURALLAR
1. Raporu Türkçe yaz
2. Klişe ifadelerden kaçın: "derin bir ruh", "hassas bir kalp", "karanlık ve aydınlık"
   gibi aşınmış metaforlar yasak
3. Eserler hakkında yanlış bilgi verme — emin olmadığın bir detayı uydurma
4. Emoji kullanma (JSON değerlerinin içine emoji koyma)
4b. Yalnızca Türk alfabesi ve Latin harfleri kullan. Kiril ya da Yunan harfi
   karıştırma — "Zihinден" ve "kaosу" gibi çıktılar veriyorsun, bunlar okunuşu
   aynı ama farklı harfler ve metni bozuyor
5. Kullanıcıda sadece yazar/yönetmen/sanatçı adı varsa, o sanatçının genel estetiği
   ve bilinen eserleri üzerinden analiz yap. Kullanıcıdan ek bilgi isteme.
6. Analizini sana verilen eserlerin TAMAMINA dayandır — birkaçına bakıp gerisini
   atlama. Ama bu, hepsini isimlendirmek demek DEĞİL: eser adları yalnızca
   contrasts kutup başlıklarında geçer. Envanter çıkarma, bütünün hissini yaz.
   Toplam altı ile yirmi dört arasında eser gelir (kategori başına en fazla 8);
   uzun listede tek tek saymaya çalışmak raporu bir isim listesine çevirir,
   istenen bu değil. Tek kategoriden gelen altı eser de portre çıkarmaya yeter —
   az malzemeyle temkinli ol ama çekingen yazma; "yeterli veri yok" deyip
   geçiştirme, elindekinden gerçekten okunanı yaz.
7. Bir kategori hiç gelmediyse raporu ondan bahsediyormuş gibi yazma. Bu boşluğu
   TEK bir yerde — hero.summary'nin ya da texture.descriptions'ın son cümlesinde —
   portrenin hangi malzemeden dokunduğunu söyleyerek belli et: "bu portre bütünüyle
   okuduklarından ve dinlediklerinden çıktı" gibi. Sitem etme, özür dileme, eksik
   bırakılan alanı kullanıcıya ödev gibi sunma; sadece dürüst ol. Aynı şeyi iki
   ayrı bölümde tekrarlama. threads ve contrasts'ta bu boşluğa hiç değinme.

## ÇIKTI FORMATI
SADECE geçerli JSON döndür. Başka hiçbir şey yazma. JSON şeması:

{
  "hero": {
    "archetype": {
      "full": "Kullanıcıya özgün kimlik etiketi (örn: Kadife Ceketli Sokak Filozofu)",
      "qualifier": "Çekirdeği niteleyen ön kısım (örn: Kadife ceketli) — bölünmüyorsa boş string",
      "core": "Çekirdek isim tamlaması (örn: Sokak Filozofu)"
    },
    "summary": "Arketipi açıklayan tam olarak 1 cümle"
  },
  "texture": {
    "descriptions": [
      "Listelerin tamamının ortak atmosferini tek bir his olarak tarif eden cümle 1 (max 3 cümle toplam, eser adı yok, varsayımsal zaman/mekan yok)"
    ],
    "colors": [
      {
        "name": "Renk adı (Türkçe, örn: Is Siyahı)",
        "hex": "#1a1a1a",
        "description": "Bu rengin kullanıcının estetiğiyle bağlantısı (1 cümle)"
      }
    ]
  },
  "threads": [
    {
      "title": "Tematik ip başlığı (güçlü ve özlü)",
      "description": "Temayı ve hissi anlat, eser adı verme (max 2 cümle)"
    }
  ],
  "contrasts": [
    {
      "left": {
        "title": "Sol kutup başlığı",
        "subtitle": "Kısa alt başlık (isteğe bağlı)",
        "poster": "Sol kutbu tek kelimeyle veren soyut isim (örn: TOZ)",
        "description": "Sol kutbun açıklaması"
      },
      "right": {
        "title": "Sağ kutup başlığı",
        "subtitle": "Kısa alt başlık (isteğe bağlı)",
        "poster": "Sağ kutbu tek kelimeyle veren soyut isim (örn: IŞIK)",
        "description": "Sağ kutbun açıklaması"
      },
      "explanation": {
        "title": "Bu zıtlığın özeti (kısa)",
        "text": "Bu iki kutbun kullanıcının estetiğinde nasıl bir bütünlük oluşturduğu (2-3 kısa cümle, sade dil)"
      }
    }
  ],
  "shadow": [
    {
      "type": "Kitap",
      "title": "Eser adı veya null (sanatçı bazlıysa)",
      "author_or_artist": "Yazar / yönetmen / sanatçı adı",
      "year": "Yıl (isteğe bağlı, string veya null)",
      "description": "Neden bu kullanıcıya uygun? (max 3 cümle)"
    },
    {
      "type": "Film",
      "title": "Film adı",
      "author_or_artist": "Yönetmen adı",
      "year": "Yıl veya null",
      "description": "Neden bu kullanıcıya uygun? (max 3 cümle)"
    },
    {
      "type": "Müzik",
      "title": null,
      "author_or_artist": "Sanatçı veya grup adı",
      "year": null,
      "description": "Neden bu kullanıcıya uygun? (max 3 cümle)"
    }
  ]
}

## İÇERİK KURALLARI

### hero
- Arketip: Dramatik veya cringe değil, kullanıcının biyografisine yazabileceği kadar doğal
- Hem 'salon' hem 'sokak' tarafını kapsasın
- summary: tek cümle, açıklayıcı

Arketip üç parça halinde döner. Bu bir posterde iki katman olarak dizilecek —
niteleyici küçük puntoyla üstte, çekirdek büyük puntoyla altta. Bölmeyi sen
yaparsın çünkü anlamı sen biliyorsun:

- İsim uzunluğuna SINIR KOYMA. Özgün ve şiirsel isimler korunur; kısaltmak için
  isim seçme
- "full": arketibin tam hali. Her zaman dolu
- "core": arketibin çekirdek isim tamlaması. Tek başına söylendiğinde anlamlı ve
  akılda kalıcı olmalı. Tercihen 18 karakteri geçmesin
- "qualifier": çekirdeği niteleyen ön kısım. Bölmek anlamı bozuyorsa ya da isim
  zaten kısaysa BOŞ STRING döndür
- Bölme kelime sayısına göre değil ANLAM BÜTÜNLÜĞÜNE göre yapılır:
  · "Gece Vardiyası Varoluşçusu" tek bir anlam birimidir → qualifier BOŞ,
    core = "Gece Vardiyası Varoluşçusu"
  · "Kıyıda Ateş Yakan Maceraperest" bölünür → qualifier = "Kıyıda ateş yakan",
    core = "Maceraperest"
  · "Kırık Camdan Bakan Nostaljik Mimar" bölünür → qualifier = "Kırık camdan bakan",
    core = "Nostaljik Mimar"
- qualifier + " " + core birleşimi her zaman full'ü vermeli. Kelime ekleme,
  çıkarma ya da sırasını değiştirme; yalnızca qualifier'ın ilk harfi küçülür

### texture
- Sana ULAŞAN listelerin birlikte yarattığı ortak atmosferi tek bir his olarak
  tarif et; tek liste geldiyse onun kendi atmosferini yaz. Olmayan kategorilere
  gönderme yapma, "üç alan" gibi ifadeler kullanma
- Eserleri tek tek açıklama veya isimlendirme
- Varsayımsal zaman/mekan bilgisi kullanma (saat kaç, nerede olduğu gibi)
- descriptions: maksimum 3 kısa cümle, sade ve doğrudan dil
- colors: tam olarak 3 renk, hex kodu gerçek olsun, isim Türkçe ve yaratıcı olsun, her renk için 1 cümle açıklama

### threads
- En az 2, en fazla 3 tematik ip
- Her ip: güçlü ve özlü bir başlık + maksimum 2 cümle açıklama
- Eserleri tek tek isimlendirme — temayı ve hissi anlat, eserleri değil
- Yüzeysel benzerliklerden kaçın — derin yapısal veya tematik bağlantılar kur

### contrasts
- Max 2 kontrast, minimum 1
- 2 güçlü zıtlık yoksa tek kontrast yeterli — tek kategoriden gelen kısa bir
  listede genelde bir kontrast doğrudur, ikinciyi zorlama
- Kutup başlıklarında (left/right title) eser isimlerini kullan. İsimlerin
  hepsinin aynı kategoriden gelmesi sorun değil; kutupların farklı alanlardan
  olma zorunluluğu yok
- Her kutba max 1 kısa betimleme ekle (subtitle alanı, 3-4 kelime)
- left/right description alanını BOŞ bırak — açıklama yazma
- explanation metni: max 2-3 cümle, sade ve ilgi çekici
- poster: her kutbun özünü veren TEK Türkçe kelime. Posterde "TOZ ⟷ IŞIK" gibi
  yan yana dizilecek. Kurallar:
  · KÜÇÜK HARFLE yaz. Büyük harfe çevirmeyi biz yapıyoruz — Türkçede I/İ
    ayrımı var ve sen "metin" yerine "METIN" yazıyorsun (doğrusu METİN).
    Sen "metin" yaz, gerisini bırak
  · YALIN HALDE yaz, ek alma. "ceset" evet, "cesedi" hayır. "metin" evet,
    "metni" hayır. Poster etiketi cümle içinde değil, tek başına duruyor
  · İSİM yaz, sıfat değil. "boşluk" evet, "boş" hayır. "kırılma" evet,
    "kırık" hayır
  · Gerçek bir Türkçe kelime olsun; "durgu" gibi uydurma kök kullanma
  · Soyut bir kavram olsun; eser adı, kişi adı ya da yer adı değil
  · İki kutbun harf sayısı arasında EN FAZLA 3 fark olsun. "devre ⟷ et"
    dengesiz durur; ikisini de aynı ağırlıkta seç
  · İyi örnekler: toz ⟷ ışık · salon ⟷ sokak · düzen ⟷ kaos · alev ⟷ kül ·
    uyku ⟷ nöbet

### shadow
- Tam olarak 3 öneri: 1 Kitap, 1 Film, 1 Müzik (bu sırayla). Kullanıcı o
  kategoride hiçbir şey paylaşmamış olsa bile üçü de gelir — bu kural asla esnemez
- Boş bıraktığı kategorinin önerisi bir kapı işlevi görsün: elindeki diğer
  listelerden köprü kur ("okuduklarının perdedeki karşılığı buradan başlar" gibi)
  ve oradan gir. O alanda zevkini biliyormuş gibi konuşma; öneriyi bir davet
  olarak yaz, bir teşhis olarak değil
- Her öneri max 2 cümle
- Birinci cümle: kullanıcının listesindeki eserlerle bağlantı kur —
  bu eser o dünyaya neden ait
- İkinci cümle: kullanıcının bunu neden seveceğini söyle,
  kişisel ve samimi tut
- Her cümle max 12 kelime
- Ansiklopedik açıklama yapma, eseri tanıtma
- Keşif tonu — merak uyandır, dayatma
`;

// Rapora giren sinyal sayısı bounded ("kütüphane sınırsız, rapor bounded").
// Havuzun (user_works) üst sınırı yoktur; bunlar yalnızca rapora giren seçim içindir.
//
// ALT SINIR TOPLAMDIR, kategori başına değil: 6+0+0 geçerli bir dağılımdır.
// Kategori zorunluluğu bilinçli kaldırıldı — kitap okuyup film izlemeyen
// kullanıcıyı daha portresi çıkmadan eliyordu.
//
// İstemci karşılıkları src/lib/formLimits.ts içinde ve ELLE senkron tutulur
// (Deno bundle'ı src/'ten import edemez).
const MIN_TOTAL = 6;
const MAX_ITEMS = 8; // kategori başına
const MAX_CHARS = 120;
const DAILY_LIMIT = 3;

const VALID_SOURCES = ["screenshot", "paste", "manual", "form"];

/** Normalize edilmiş tek sinyal — istemci hangi biçimi göndermiş olursa olsun. */
interface Signal {
  title: string;
  creator: string;
  source: string;
  /** Havuzda zaten varsa id'si; yoksa null (analyze kendisi yazar). */
  workId: string | null;
}

/** 400 ile dönülecek girdi hataları; beklenmeyen hatalardan ayrılsın diye ayrı tip. */
class InvalidInput extends Error {}

function getTodayInIstanbul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
}

/**
 * Eski tek-string biçimini ("Başlık - Yaratıcı") ayırır.
 *
 * SON " - " ile bölünür, ilk değil: eser adının kendisi tire içerebiliyor
 * ("Sıcak - Soğuk Mevsimler - Camus" → başlık "Sıcak - Soğuk Mevsimler").
 *
 * Yalnızca 60 dk TTL'deki eski bekleyen kayıtlar için duruyor. Yeni istemci
 * title/creator'ı ayrı gönderiyor — çünkü bu ayırma, ayırıcısız bir satırı
 * (yalnızca eser adı) hep yaratıcı sanıyor ve veriyi yanlış kolona yazıyordu.
 */
function parseEntry(text: string): [string, string] {
  const idx = text.lastIndexOf(" - ");
  if (idx !== -1) {
    return [text.slice(0, idx).trim(), text.slice(idx + 3).trim()];
  }
  return ["", text.trim()];
}

function at(arr: unknown, i: number): unknown {
  return Array.isArray(arr) ? arr[i] : undefined;
}

/**
 * Latin harflerine benzeyen Kiril/Yunan harflerini Latin karşılıklarına çevirir.
 *
 * Model ara sıra script karıştırıyor: gerçek çıktılardan "Zihinден gelen isyan"
 * ve "Hareketin kaosу" (Kiril д-е-н ve у). Okunuşu aynı olduğu için gözle
 * yakalanmıyor ama metin bozuk: arama tutmuyor, Türkçe collation şaşıyor,
 * fontta o glif yoksa posterde tofu kutusu çıkıyor.
 *
 * Prompt'ta 4b kuralı bunu söylüyor ama kural garanti değil; bu ağ arkada duruyor.
 * Tek yönlü ve kayıpsız: yalnızca Latin'de birebir karşılığı olan harfler
 * çevriliyor, gerçekten Kiril bir metin gelseydi bozardı — ama bu rapor Türkçe.
 */
const CONFUSABLES: Record<string, string> = {
  // Kiril → Latin
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C",
  Т: "T", У: "Y", Х: "X", а: "a", в: "b", е: "e", к: "k", м: "m", н: "n",
  о: "o", р: "p", с: "c", т: "t", у: "u", х: "x", д: "d", и: "i", л: "l",
  г: "g", з: "z", ф: "f", ш: "s", ч: "c", я: "ya", ы: "i", й: "y", б: "b",
  // Yunan → Latin
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N",
  Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X", ο: "o", ι: "i", κ: "k", ν: "v",
  ρ: "p", τ: "t", υ: "y", χ: "x",
};

/** Rapor içindeki bütün string'leri gezip homoglifleri düzeltir. */
function fixConfusables<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/[Ѐ-ӿͰ-Ͽ]/g, (ch) => CONFUSABLES[ch] ?? ch) as T;
  }
  if (Array.isArray(value)) return value.map(fixConfusables) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixConfusables(v);
    return out as T;
  }
  return value;
}

/** Türkçe karşılaştırma için: boşlukları tekleştirip küçültür (İ/I tuzağı dahil). */
function loose(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
}

/**
 * hero.archetype'ı nesneden düz stringe indirir ve iki katmanı yanına yazar.
 *
 *   {archetype: {full, qualifier, core}}
 *     → {archetype: full, archetype_qualifier, archetype_core}
 *
 * archetype'ın string kalması ZORUNLU: dokuz frontend noktası ve
 * daily-discovery'nin prompt'u onu string olarak okuyor.
 *
 * qualifier + core birleşimi full'ü vermiyorsa bölmeye güvenilmez ve tek katmana
 * düşülür — poster yanlış bölünmüş bir isim göstermektense küçük puntoyla tam
 * adı gösterir. Model "Kırık Camdan Bakan Nostaljik Mimar"ı "Nostaljik" /
 * "Mimar" diye bölerse bu kontrol yakalar.
 */
function normalizeArchetype(hero: Record<string, unknown> | undefined): void {
  if (!hero) return;

  const a = hero.archetype;
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const obj = a as Record<string, unknown>;
    hero.archetype = String(obj.full ?? "").trim();
    hero.archetype_qualifier = String(obj.qualifier ?? "").trim();
    hero.archetype_core = String(obj.core ?? "").trim();
  } else {
    hero.archetype = String(a ?? "").trim();
    hero.archetype_qualifier = "";
    hero.archetype_core = "";
  }

  const full = hero.archetype as string;
  const q = (hero.archetype_qualifier as string) ?? "";
  const core = (hero.archetype_core as string) ?? "";

  if (!core || loose(`${q} ${core}`) !== loose(full)) {
    if (core) {
      console.warn("[analyze] arketip bölünmesi full ile eşleşmedi, tek katmana düşüldü:", {
        full,
        qualifier: q,
        core,
      });
    }
    hero.archetype_qualifier = "";
    hero.archetype_core = "";
  }
}

/**
 * İki girdi biçimini tek iç temsile indirir:
 *  - yeni istemci: {title, creator, source, work_id} nesneleri
 *  - eski istemci: string[] + üst düzey paralel sources/work_ids dizileri
 * Bundan sonrası biçimi bilmez.
 */
function normalizeCategory(
  raw: unknown,
  legacySources: unknown,
  legacyIds: unknown
): Signal[] {
  if (!Array.isArray(raw)) {
    throw new InvalidInput("Beklenen biçimde veri gelmedi. Lütfen tekrar deneyin.");
  }
  if (raw.length > MAX_ITEMS) {
    throw new InvalidInput(`Her kategoride en fazla ${MAX_ITEMS} sinyal olabilir.`);
  }

  return raw.map((item, i) => {
    let title: string;
    let creator: string;
    let source: unknown;
    let workId: unknown;

    if (typeof item === "string") {
      [title, creator] = parseEntry(item);
      source = at(legacySources, i);
      workId = at(legacyIds, i);
    } else if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      title = typeof rec.title === "string" ? rec.title.trim() : "";
      creator = typeof rec.creator === "string" ? rec.creator.trim() : "";
      source = rec.source;
      workId = rec.work_id;
    } else {
      throw new InvalidInput("Beklenen biçimde veri gelmedi. Lütfen tekrar deneyin.");
    }

    // İkisi birden boş bir sinyalden portre çıkmaz.
    if (!title && !creator) {
      throw new InvalidInput("Her sinyalde en az bir ad olmalı.");
    }
    if (title.length > MAX_CHARS || creator.length > MAX_CHARS) {
      throw new InvalidInput(`Her ad en fazla ${MAX_CHARS} karakter olabilir.`);
    }

    return {
      title,
      creator,
      // Tanınmayan değer 'form'a düşer (Screenshot-to-DNA öncesi akış).
      source: VALID_SOURCES.includes(source as string) ? (source as string) : "form",
      workId: typeof workId === "string" && workId.length > 0 ? workId : null,
    };
  });
}

/** Üç biçim de geçerli: ikisi birlikte, yalnız yaratıcı, yalnız eser adı. */
function formatSignal(s: Signal, i: number, creatorPrefix = ""): string {
  const creator = s.creator ? `${creatorPrefix}${s.creator}` : "";
  if (s.title && creator) return `  ${i + 1}. *${s.title}* — ${creator}`;
  if (s.title) return `  ${i + 1}. *${s.title}*`;
  return `  ${i + 1}. ${creator}`;
}

function buildPrompt(books: Signal[], movies: Signal[], music: Signal[]): string {
  // Boş kategori için BAŞLIK YAZILMAZ: çıplak bir "### Filmler ve Diziler"
  // başlığı modele "burada bir şey vardı" izlenimi verir ve uydurmaya davet eder.
  const sections: string[] = [];
  const missing: string[] = [];

  if (books.length) {
    sections.push(`### Kitaplar\n${books.map((s, i) => formatSignal(s, i)).join("\n")}`);
  } else missing.push("kitap");

  if (movies.length) {
    sections.push(
      `### Filmler ve Diziler\n${movies.map((s, i) => formatSignal(s, i, "yön. ")).join("\n")}`
    );
  } else missing.push("film/dizi");

  if (music.length) {
    sections.push(`### Müzik\n${music.map((s, i) => formatSignal(s, i)).join("\n")}`);
  } else missing.push("müzik");

  const missingNote = missing.length
    ? `
Kullanıcı ${missing.join(" ve ")} listesi paylaşmadı — o alanda hiçbir verin yok.
Oradan gelmiş gibi tek bir cümle bile kurma. Raporun bu boşluğu bildiğini bir kez,
doğal bir yerde belli etsin (bkz. sistem kuralı 7). shadow yine tam 3 öneri içerir;
boş kalan alanın önerisi bir kapı olsun.
`
    : "";

  return `Aşağıda bir kullanıcının kültürel zevklerini gösteren veriler var:

${sections.join("\n\n")}
${missingNote}
---

Bu verilerden yola çıkarak kullanıcı için Estetik Kimlik Raporu üret.
System prompt'taki JSON şemasına birebir uy. SADECE JSON döndür, başka metin ekleme.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Auth zorunlu
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Bu işlem için giriş yapman gerekiyor." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Geçersiz oturum. Lütfen tekrar giriş yap." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { books: rawBooks, movies: rawMovies, music: rawMusic, sources, work_ids } = body;

    let books: Signal[];
    let movies: Signal[];
    let music: Signal[];
    try {
      books = normalizeCategory(rawBooks, sources?.books, work_ids?.books);
      movies = normalizeCategory(rawMovies, sources?.movies, work_ids?.movies);
      music = normalizeCategory(rawMusic, sources?.music, work_ids?.music);
    } catch (err) {
      if (!(err instanceof InvalidInput)) throw err;
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Eşik TOPLAMDA: dağılım serbest, kategori boş kalabilir.
    if (books.length + movies.length + music.length < MIN_TOTAL) {
      return new Response(
        JSON.stringify({
          error: `Portreni çıkarabilmem için toplam en az ${MIN_TOTAL} sinyal gerekli — hangi kategoriden geldikleri fark etmez.`,
        }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Günlük kota: Istanbul gününe göre maks 3 rapor
    const today = getTodayInIstanbul();
    const { count, error: countError } = await sb
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", `${today}T00:00:00+03:00`);

    if (countError) {
      console.error("[analyze] Kota sorgusu hatası:", countError);
      return new Response(
        JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if ((count ?? 0) >= DAILY_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Bugün için rapor limitine ulaştın. Yarın tekrar deneyebilirsin." }),
        { status: 429, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildPrompt(books, movies, music) },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`[analyze] Claude API hatası: ${anthropicRes.status}`, errText);
      return new Response(
        JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicRes.json();
    const responseText: string = anthropicData.content?.[0]?.text ?? "";

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText.trim();
    const report = fixConfusables(JSON.parse(jsonStr));

    // "shadow tam 3 öneri" artık bir kaza değil sözleşme: boş kategorinin önerisi
    // keşif kapısı olarak duruyor ve ShadowSection md:grid-cols-3 buna dayanıyor.
    // Burada tutmazsak eksik dizi, kullanıcı API çağrısını harcadıktan SONRA
    // rapor sayfasını çökertiyor (ShadowSection'daki data.map korumasız).
    if (!Array.isArray(report.shadow) || report.shadow.length !== 3) {
      console.error("[analyze] shadow beklenen 3 öneriyi içermiyor:", report.shadow);
      return new Response(
        JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // hero.archetype üreticiden {full, qualifier, core} NESNESİ olarak gelir ama
    // veritabanına DÜZ STRING olarak yazılır. Sebep: archetype dokuz frontend
    // noktasında ve daily-discovery'nin kendi Claude prompt'unda düz string
    // olarak okunuyor. Nesne yazarsak orada sessizce "[object Object]" oluşur —
    // vite build tip denetimi yapmıyor, daily-discovery ayrı bir Deno bundle'ı,
    // hiçbir şey bunu yakalamaz. Nesne burada, tek noktada düzleşir.
    normalizeArchetype(report.hero);

    if (!report.hero?.archetype) {
      console.error("[analyze] hero.archetype boş döndü:", report.hero);
      return new Response(
        JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const parsedBooks = books.map((s) => ({ title: s.title, author: s.creator }));
    const parsedFilms = movies.map((s) => ({ title: s.title, director: s.creator }));
    const parsedSongs = music.map((s) => ({ title: s.title, artist: s.creator }));

    const { data, error } = await sb
      .from("reports")
      .insert({
        source: "web",
        user_id: user.id,
        books: parsedBooks,
        films: parsedFilms,
        songs: parsedSongs,
        hero: report.hero,
        texture: report.texture,
        threads: report.threads,
        contrasts: report.contrasts,
        shadow: report.shadow,
        is_public: false,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Havuza yaz: eserler user_works'e, rapor↔eser ilişkisi report_works'e.
    // Bu blok raporu ASLA bloklamaz — havuz yazımı başarısız olsa da kullanıcı
    // raporunu alır. reports.books/films/songs zaten raporun kendi snapshot'ı.
    try {
      const batchId = crypto.randomUUID();

      // Edinim yolu ve havuz id'si sinyalin kendi içinde geliyor — eskiden paralel
      // dizilerden konumsal okunuyordu ve bir kayma sessizce yanlış source yazardı.
      //
      // Import yolunda eserler onay ekranında zaten havuza yazıldı ve id'leri geldi.
      // O satırları YENİDEN yazmıyoruz, yalnızca rapora bağlıyoruz — aksi halde
      // her eser havuzda iki kez görünürdü.
      const items = [
        ...books.map((s) => ({ type: "book", creator: s.creator, title: s.title, source: s.source, id: s.workId })),
        ...movies.map((s) => ({ type: "film", creator: s.creator, title: s.title, source: s.source, id: s.workId })),
        ...music.map((s) => ({ type: "song", creator: s.creator, title: s.title, source: s.source, id: s.workId })),
      ];

      // id'si gelmeyen satırlar (manuel / eski form yolu). Bunlar havuzda zaten
      // olabilir — aynı eser ikinci kez yazılmasın diye önce mevcutlara bakılır.
      // Tekillik veritabanında da unique index ile korunuyor; bu kontrol o
      // index'e çarpıp tüm insert'in düşmesini engelliyor.
      const missing = items.filter((w) => !w.id);
      const resolvedIds: string[] = [];
      if (missing.length > 0) {
        const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
        const keyOf = (t: string, c?: string | null, ti?: string | null) =>
          `${t}|${norm(c)}|${norm(ti)}`;

        const { data: existing } = await sb
          .from("user_works")
          .select("id, type, creator, title")
          .eq("user_id", user.id)
          .is("deleted_at", null);

        const index = new Map<string, string>();
        for (const row of existing ?? []) {
          index.set(keyOf(row.type, row.creator, row.title), row.id);
        }

        // Aynı istek içinde tekrar eden satırlar da tek kayda düşsün.
        const keys = missing.map((w) => keyOf(w.type, w.creator, w.title));
        const pending = new Map<string, (typeof missing)[number]>();
        missing.forEach((w, i) => {
          if (!index.has(keys[i]) && !pending.has(keys[i])) pending.set(keys[i], w);
        });

        if (pending.size > 0) {
          const { data: works, error: worksError } = await sb
            .from("user_works")
            .insert(
              [...pending.values()].map((w) => ({
                user_id: user.id,
                type: w.type,
                creator: w.creator || null,
                title: w.title || null, // sadece sanatçı girilmişse boş string gelir
                source: w.source,
                batch_id: batchId,
              }))
            )
            .select("id");
          if (worksError) throw worksError;
          [...pending.keys()].forEach((k, i) => {
            const created = (works ?? [])[i] as { id: string } | undefined;
            if (created) index.set(k, created.id);
          });
        }

        for (const k of keys) {
          const id = index.get(k);
          if (id) resolvedIds.push(id);
        }
      }

      const linkIds = [
        ...new Set([...items.map((w) => w.id).filter(Boolean) as string[], ...resolvedIds]),
      ];
      const { error: linkError } = await sb
        .from("report_works")
        .insert(linkIds.map((id) => ({ report_id: data.id, work_id: id })));
      if (linkError) throw linkError;
    } catch (poolError) {
      console.error("[analyze] Havuza yazılamadı (rapor etkilenmedi):", poolError);
    }

    return new Response(JSON.stringify({ reportId: data.id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[analyze] Beklenmeyen hata:", err);
    return new Response(JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
