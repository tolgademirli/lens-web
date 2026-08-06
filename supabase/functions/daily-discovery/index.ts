import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

type ReportRow = {
  id: string;
  hero: { archetype?: string; summary?: string } | null;
  texture: { descriptions?: string[] } | null;
  books: { title?: string; author?: string }[] | null;
  films: { title?: string; director?: string }[] | null;
  songs: { title?: string; artist?: string }[] | null;
};

/**
 * Rapor JSONB kolonları teoride hep dolu, pratikte değil: eski raporlarda ve
 * Claude'un eksik JSON döndürdüğü durumlarda hero/texture null olabiliyor.
 * Burada tek bir null, tüm günlük keşfi 500'e düşürmemeli.
 */
function buildPrompt(report: ReportRow): string {
  const asList = (
    rows: { title?: string }[] | null,
    creatorKey: "author" | "director" | "artist",
  ) =>
    (rows ?? [])
      .map((row) => {
        const creator = (row as Record<string, string | undefined>)[creatorKey];
        return row.title ? `${row.title} - ${creator ?? ""}`.trim() : creator;
      })
      .filter((line): line is string => Boolean(line && line.trim()))
      .join(", ");

  const booksList = asList(report.books, "author");
  const filmsList = asList(report.films, "director");
  const songsList = asList(report.songs, "artist");
  const archetype = report.hero?.archetype ?? "";
  const summary = report.hero?.summary ?? "";
  const texture = report.texture?.descriptions?.[0] ?? "";

  return `${archetype ? `Kullanıcının estetik arketipi: "${archetype}"` : ""}
${summary ? `Arketip özeti: "${summary}"` : ""}
${texture ? `Atmosfer/doku: "${texture}"` : ""}

Kullanıcının daha önce girdiği eserler (BUNLARLA KESINLIKLE ÇAKIŞMA):
- Kitaplar: ${booksList || "(yok)"}
- Filmler: ${filmsList || "(yok)"}
- Müzisyenler/Sanatçılar: ${songsList || "(yok)"}

Bu zevke uygun, yukarıdaki eserlerle çakışmayan 1 kitap, 1 film, 1 müzik sanatçısı öner.
Her öneri için neden uygun olduğunu 1 kısa cümle yaz (max 12 kelime).
Sadece JSON döndür.`;
}

/** Model bazen JSON'u ```json bloğuna sarıyor ya da önüne bir cümle koyuyor. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("JSON bulunamadı");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

type Discovery = {
  book: string;
  film: string;
  music: string;
  reasons: { book: string; film: string; music: string };
};

/** book/film/music DB'de NOT NULL — eksik alanla insert etmeye çalışma. */
function normalizeDiscovery(raw: unknown): Discovery | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const book = str(obj.book);
  const film = str(obj.film);
  const music = str(obj.music);
  if (!book || !film || !music) return null;

  const rawReasons = (obj.reasons ?? {}) as Record<string, unknown>;
  return {
    book,
    film,
    music,
    reasons: {
      book: str(rawReasons.book),
      film: str(rawReasons.film),
      music: str(rawReasons.music),
    },
  };
}

function getTodayInIstanbul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
}

function fail(code: string, status = 500, message = "Bir hata oluştu. Lütfen tekrar deneyin.") {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return fail("no_auth_header", 401, "Oturum gerekli");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !serviceKey || !anthropicKey) {
      console.error("[daily-discovery] Eksik ortam değişkeni:", {
        SUPABASE_URL: Boolean(supabaseUrl),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
        ANTHROPIC_API_KEY: Boolean(anthropicKey),
      });
      return fail("missing_env");
    }

    const sb = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await sb.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) {
      console.error("[daily-discovery] Oturum doğrulanamadı:", userError);
      return fail("invalid_session", 401, "Geçersiz oturum");
    }

    const today = getTodayInIstanbul();

    // Cache kontrolü. maybeSingle: satır yoksa hata değil null döner; aynı gün
    // için mükerrer satır varsa (unique index yoksa mümkün) en yenisini alırız.
    const { data: cached, error: cacheError } = await sb
      .from("daily_discoveries")
      .select("book, film, music, reasons, date")
      .eq("user_id", user.id)
      .eq("date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cacheError) {
      // Cache okunamadıysa keşif üretmeye devam et — kullanıcı boş ekran görmesin.
      console.error("[daily-discovery] Cache sorgusu hatası:", cacheError);
    }

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
      .maybeSingle<ReportRow>();

    if (reportError) {
      console.error("[daily-discovery] Rapor sorgusu hatası:", reportError);
      return fail("report_query_failed");
    }

    if (!report) {
      return fail("no_report", 404, "Rapor bulunamadı");
    }

    // Claude API çağrısı. max_tokens 512 Türkçe çıktı için dardı: kırpılan yanıt
    // geçersiz JSON'a dönüp fonksiyonu 500'e düşürüyordu.
    let anthropicRes: Response;
    try {
      anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildPrompt(report) }],
        }),
      });
    } catch (err) {
      console.error("[daily-discovery] Claude API'ye ulaşılamadı:", err);
      return fail("claude_unreachable", 502);
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`[daily-discovery] Claude API hatası: ${anthropicRes.status}`, errText);
      return fail(`claude_http_${anthropicRes.status}`, 502);
    }

    const anthropicData = await anthropicRes.json();
    const responseText: string = anthropicData.content?.[0]?.text ?? "";

    if (anthropicData.stop_reason === "max_tokens") {
      console.error("[daily-discovery] Çıktı max_tokens'a takıldı, JSON yarım kaldı.");
      return fail("claude_truncated", 502);
    }

    let discovery: Discovery | null;
    try {
      discovery = normalizeDiscovery(extractJson(responseText));
    } catch (err) {
      console.error("[daily-discovery] JSON parse edilemedi:", err, "| ham yanıt:", responseText.slice(0, 500));
      return fail("claude_bad_json", 502);
    }

    if (!discovery) {
      console.error("[daily-discovery] Eksik alanlı öneri:", responseText.slice(0, 500));
      return fail("claude_incomplete", 502);
    }

    // DB'ye kaydet. Bu yazım best-effort: cache yazılamasa da kullanıcı
    // keşfini alır (analyze'daki havuz yazımıyla aynı prensip).
    const { error: insertError } = await sb.from("daily_discoveries").insert({
      user_id: user.id,
      date: today,
      report_id: report.id,
      book: discovery.book,
      film: discovery.film,
      music: discovery.music,
      reasons: discovery.reasons,
    });

    if (insertError) {
      console.error("[daily-discovery] Cache yazılamadı:", insertError);
    }

    return new Response(
      JSON.stringify({ ...discovery, date: today }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[daily-discovery] Beklenmeyen hata:", err);
    return fail("unexpected");
  }
});
