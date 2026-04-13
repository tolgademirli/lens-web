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
Kullanıcının paylaştığı 5 kitap, 5 film ve 5 müzisyen/sanatçı üzerinden
'Estetik Kimlik Raporu' çıkar. Aşağıdaki JSON şemasına uygun şekilde üret.

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
      "15 eserin ortak atmosferini tek bir his olarak tarif eden cümle 1 (max 3 cümle toplam, eser adı yok, varsayımsal zaman/mekan yok)"
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
- Bu 15 eserin yarattığı ortak atmosferi tek bir his olarak tarif et
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

function parseEntry(text: string): [string, string] {
  const idx = text.indexOf(" - ");
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
    const { books, movies, music } = await req.json();

    if (
      !Array.isArray(books) ||
      !Array.isArray(movies) ||
      !Array.isArray(music) ||
      books.length < 3 ||
      movies.length < 3 ||
      music.length < 3
    ) {
      return new Response(
        JSON.stringify({ error: "Her kategoride en az 3 giriş gerekli" }),
        {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        }
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
      throw new Error(`Claude API hatası: ${anthropicRes.status} ${errText}`);
    }

    const anthropicData = await anthropicRes.json();
    const responseText: string = anthropicData.content?.[0]?.text ?? "";

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText.trim();
    const report = JSON.parse(jsonStr);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        books: parsedBooks,
        films: parsedFilms,
        songs: parsedSongs,
        hero: report.hero,
        texture: report.texture,
        threads: report.threads,
        contrasts: report.contrasts,
        shadow: report.shadow,
        is_public: true,
      })
      .select("id")
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ reportId: data.id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
