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
Kullanıcının paylaştığı kitap, film ve müzisyen/sanatçı listeleri üzerinden
'Estetik Kimlik Raporu' çıkar. Aşağıdaki JSON şemasına uygun şekilde üret.
Her kategorideki eser sayısı değişkendir — listede kaç eser varsa onunla çalış.

## ÖNEMLİ KURALLAR
1. Raporu Türkçe yaz
2. Klişe ifadelerden kaçın: "derin bir ruh", "hassas bir kalp", "karanlık ve aydınlık"
   gibi aşınmış metaforlar yasak
3. Eserler hakkında yanlış bilgi verme — emin olmadığın bir detayı uydurma
4. Emoji kullanma (JSON değerlerinin içine emoji koyma)
5. Kullanıcıda sadece yazar/yönetmen/sanatçı adı varsa, o sanatçının genel estetiği
   ve bilinen eserleri üzerinden analiz yap. Kullanıcıdan ek bilgi isteme.
6. Kullanıcının listesindeki HER esere en az bir kez değin

## ÇIKTI FORMATI
SADECE geçerli JSON döndür. Başka hiçbir şey yazma. JSON şeması:

{
  "hero": {
    "archetype": "Kullanıcıya özgün kimlik etiketi (örn: Kadife Ceketli Sokak Filozofu)",
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
        "description": "Sol kutbun açıklaması"
      },
      "right": {
        "title": "Sağ kutup başlığı",
        "subtitle": "Kısa alt başlık (isteğe bağlı)",
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

### texture
- Üç listenin birlikte yarattığı ortak atmosferi tek bir his olarak tarif et
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
- 2 güçlü zıtlık yoksa tek kontrast yeterli
- Kutup başlıklarında (left/right title) eser isimlerini kullan
- Her kutba max 1 kısa betimleme ekle (subtitle alanı, 3-4 kelime)
- left/right description alanını BOŞ bırak — açıklama yazma
- explanation metni: max 2-3 cümle, sade ve ilgi çekici

### shadow
- Tam olarak 3 öneri: 1 Kitap, 1 Film, 1 Müzik (bu sırayla)
- Her öneri max 2 cümle
- Birinci cümle: kullanıcının listesindeki eserlerle bağlantı kur —
  bu eser o dünyaya neden ait
- İkinci cümle: kullanıcının bunu neden seveceğini söyle,
  kişisel ve samimi tut
- Her cümle max 12 kelime
- Ansiklopedik açıklama yapma, eseri tanıtma
- Keşif tonu — merak uyandır, dayatma
`;

// Rapora giren eser sayısı: kategori başına 3-8 ("kütüphane sınırsız, rapor bounded").
// Havuzun (user_works) üst sınırı yoktur; bu tavan yalnızca rapora giren seçim içindir.
const MAX_ITEMS = 8;
const MAX_CHARS = 120;
const DAILY_LIMIT = 3;

function getTodayInIstanbul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
}

function parseEntry(text: string): [string, string] {
  // SON " - " ile bölünür, ilk değil: eser adının kendisi tire içerebiliyor
  // ("Sıcak - Soğuk Mevsimler - Camus" → başlık "Sıcak - Soğuk Mevsimler").
  // Yaratıcı adı sona ekleniyor, dolayısıyla son ayırıcı doğru olanıdır.
  const idx = text.lastIndexOf(" - ");
  if (idx !== -1) {
    return [text.slice(0, idx).trim(), text.slice(idx + 3).trim()];
  }
  return ["", text.trim()];
}

function buildPrompt(
  books: string[],
  movies: string[],
  music: string[]
): string {
  const booksText = books
    .map((e, i) => {
      const [title, author] = parseEntry(e);
      return title
        ? `  ${i + 1}. *${title}* — ${author}`
        : `  ${i + 1}. ${author}`;
    })
    .join("\n");

  const moviesText = movies
    .map((e, i) => {
      const [title, director] = parseEntry(e);
      return title
        ? `  ${i + 1}. *${title}* — yön. ${director}`
        : `  ${i + 1}. ${director}`;
    })
    .join("\n");

  const musicText = music
    .map((e, i) => {
      const [title, artist] = parseEntry(e);
      return title
        ? `  ${i + 1}. "${title}" — ${artist}`
        : `  ${i + 1}. ${artist}`;
    })
    .join("\n");

  return `Aşağıda bir kullanıcının kültürel zevklerini gösteren veriler var:

### Favori Kitaplar
${booksText}

### Favori Filmler
${moviesText}

### Favori Şarkılar / Sanatçılar
${musicText}

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

    const { books, movies, music, sources, work_ids } = await req.json();

    if (
      !Array.isArray(books) ||
      !Array.isArray(movies) ||
      !Array.isArray(music) ||
      books.length < 3 ||
      movies.length < 3 ||
      music.length < 3
    ) {
      return new Response(
        JSON.stringify({ error: "Her kategoride en az 3 giriş gerekli." }),
        {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        }
      );
    }

    // Input sınırları: max 7 eleman, max 120 karakter
    for (const arr of [books, movies, music]) {
      if (arr.length > MAX_ITEMS) {
        return new Response(
          JSON.stringify({ error: `Her kategoride en fazla ${MAX_ITEMS} giriş yapabilirsin.` }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      for (const item of arr) {
        if (typeof item !== "string" || item.length > MAX_CHARS) {
          return new Response(
            JSON.stringify({ error: "Her giriş en fazla 120 karakter olabilir." }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }
      }
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
    const report = JSON.parse(jsonStr);

    const parsedBooks = books
      .map(parseEntry)
      .map(([t, a]) => ({ title: t, author: a }));
    const parsedFilms = movies
      .map(parseEntry)
      .map(([t, d]) => ({ title: t, director: d }));
    const parsedSongs = music
      .map(parseEntry)
      .map(([t, a]) => ({ title: t, artist: a }));

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

      // Edinim yolu istemciden girişlerle aynı sırada gelir. Gelmezse ya da
      // tanınmayan bir değerse 'form' (Screenshot-to-DNA öncesi akış) varsayılır.
      const VALID_SOURCES = ["screenshot", "paste", "manual", "form"];
      const sourceAt = (key: string, i: number) => {
        const value = sources?.[key]?.[i];
        return VALID_SOURCES.includes(value) ? value : "form";
      };

      // Import yolunda eserler onay ekranında zaten havuza yazıldı ve id'leri geldi.
      // O satırlar için YENİDEN yazmıyoruz, yalnızca rapora bağlıyoruz — aksi halde
      // her eser havuzda iki kez görünürdü.
      const existingId = (key: string, i: number) => {
        const value = work_ids?.[key]?.[i];
        return typeof value === "string" && value.length > 0 ? value : null;
      };

      const items = [
        ...parsedBooks.map((b, i) => ({
          type: "book", creator: b.author, title: b.title,
          source: sourceAt("books", i), id: existingId("books", i),
        })),
        ...parsedFilms.map((f, i) => ({
          type: "film", creator: f.director, title: f.title,
          source: sourceAt("movies", i), id: existingId("movies", i),
        })),
        ...parsedSongs.map((s, i) => ({
          type: "song", creator: s.artist, title: s.title,
          source: sourceAt("music", i), id: existingId("music", i),
        })),
      ];

      const missing = items.filter((w) => !w.id);
      let createdIds: string[] = [];
      if (missing.length > 0) {
        const { data: works, error: worksError } = await sb
          .from("user_works")
          .insert(
            missing.map((w) => ({
              user_id: user.id,
              type: w.type,
              creator: w.creator,
              title: w.title || null, // sadece sanatçı girilmişse boş string gelir
              source: w.source,
              batch_id: batchId,
            }))
          )
          .select("id");
        if (worksError) throw worksError;
        createdIds = (works ?? []).map((w: { id: string }) => w.id);
      }

      const linkIds = [
        ...new Set([...items.map((w) => w.id).filter(Boolean) as string[], ...createdIds]),
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
