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

## TON VE DİL
- 1.5 doz entelektüel, 1 doz esprili ve sade
- Ağır, akademik dilden kaçın
- Emoji kullanma
- Klişe ifadelerden kaçın
- Türkçe yaz
- Keşif tonu — merak uyandır, dayatma
- Türkçe karakterleri (ı, ş, ğ, ü, ö, ç, İ) eksiksiz ve doğru kullan; "sıkışır" yerine "sikisir" gibi ASCII yazım KESİNLİKLE yasak
- Latin dışı alfabelerden karakter kullanma; Latin olmayan eser adlarını Türkçe karşılığı veya Latin transliterasyonuyla yaz

## GÖREVİN
Kullanıcının estetik kimliğine göre bugün için 1 kitap, 1 film, 1 müzik sanatçısı öner.
Kullanıcının daha önce girdiği eserlerle KESINLIKLE çakışma.
Her öneri için kullanıcıya neden uygun olduğunu 1 kısa cümle yaz (max 12 kelime).

## ÇIKTI FORMATI
SADECE geçerli JSON döndür. Başka hiçbir şey yazma:

{
  "book": "Kitap Adı - Yazar",
  "film": "Film Adı - Yönetmen",
  "music": "Sanatçı Adı",
  "reasons": {
    "book": "Neden bu kişiye uygun (max 12 kelime)",
    "film": "Neden bu kişiye uygun (max 12 kelime)",
    "music": "Neden bu kişiye uygun (max 12 kelime)"
  }
}
`;

function buildPrompt(report: {
  hero: { archetype: string; summary: string };
  texture: { descriptions: string[] };
  books?: { title: string; author: string }[];
  films?: { title: string; director: string }[];
  songs?: { title: string; artist: string }[];
}): string {
  const booksList = (report.books ?? [])
    .map((b) => (b.title ? `${b.title} - ${b.author}` : b.author))
    .join(", ");
  const filmsList = (report.films ?? [])
    .map((f) => (f.title ? `${f.title} - ${f.director}` : f.director))
    .join(", ");
  const songsList = (report.songs ?? [])
    .map((s) => (s.title ? `${s.title} - ${s.artist}` : s.artist))
    .join(", ");
  const texture = report.texture?.descriptions?.[0] ?? "";

  return `Kullanıcının estetik arketipi: "${report.hero.archetype}"
Arketip özeti: "${report.hero.summary}"
${texture ? `Atmosfer/doku: "${texture}"` : ""}

Kullanıcının daha önce girdiği eserler (BUNLARLA KESINLIKLE ÇAKIŞMA):
- Kitaplar: ${booksList || "(yok)"}
- Filmler: ${filmsList || "(yok)"}
- Müzisyenler/Sanatçılar: ${songsList || "(yok)"}

Bu arketipe uygun, yukarıdaki eserlerle çakışmayan 1 kitap, 1 film, 1 müzik sanatçısı öner.
Her öneri için neden uygun olduğunu 1 kısa cümle yaz (max 12 kelime).
Sadece JSON döndür.`;
}

function getTodayInIstanbul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Oturum gerekli" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Geçersiz oturum" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const today = getTodayInIstanbul();

    // Cache kontrolü
    const { data: cached } = await sb
      .from("daily_discoveries")
      .select("book, film, music, reasons, date")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();

    if (cached) {
      return new Response(JSON.stringify({ ...cached }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // En son raporu çek
    const { data: report, error: reportError } = await sb
      .from("reports")
      .select("id, hero, texture, books, films, songs")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (reportError || !report) {
      return new Response(JSON.stringify({ error: "Rapor bulunamadı" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Claude API çağrısı
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(report) }],
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
    const discovery = JSON.parse(jsonStr);

    // DB'ye kaydet
    await sb.from("daily_discoveries").insert({
      user_id: user.id,
      date: today,
      report_id: report.id,
      book: discovery.book,
      film: discovery.film,
      music: discovery.music,
      reasons: discovery.reasons ?? null,
    });

    return new Response(
      JSON.stringify({ ...discovery, date: today }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[daily-discovery] Beklenmeyen hata:", err);
    return new Response(
      JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
