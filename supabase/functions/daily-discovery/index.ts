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
"ÖNERME" listesindeki eserleri KESINLIKLE önerme — farklı yazımlarını da önerme.
Her öneri için kullanıcıya neden uygun olduğunu 1 kısa cümle yaz (max 12 kelime).

## ETİKETLER
Her öneri için üç ekseni -1 ile 1 arasında sayı olarak ver ve kısa bir tür etiketi yaz.
Bu etiketler kullanıcının geri bildiriminin nasıl işleneceğini belirler, kullanıcıya gösterilmez.
- tone: -1 aydınlık/hafif ... +1 karanlık/ağır
- popularity: -1 niş/az bilinen ... +1 çok popüler
- era: -1 klasik/eski ... +1 çağdaş/yeni
- genre: tek kelimelik tür etiketi (örn. "polisiye", "caz", "distopya")

## ÇIKTI FORMATI
SADECE geçerli JSON döndür. Başka hiçbir şey yazma:

{
  "items": [
    {
      "slot": "book",
      "title": "Kitap Adı",
      "creator": "Yazar",
      "reason": "Neden bu kişiye uygun (max 12 kelime)",
      "genre": "tür",
      "tone": 0.4,
      "popularity": -0.2,
      "era": -0.6
    },
    { "slot": "film", "title": "Film Adı", "creator": "Yönetmen", "reason": "...", "genre": "...", "tone": 0, "popularity": 0, "era": 0 },
    { "slot": "music", "title": "", "creator": "Sanatçı Adı", "reason": "...", "genre": "...", "tone": 0, "popularity": 0, "era": 0 }
  ]
}

Müzik önerisinde sanatçı adı "creator" alanına yazılır, "title" boş bırakılır.
Eser adı ile yaratıcı adı AYRI alanlarda durur — tek bir string'e birleştirme.
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
type BlockedWork = {
  work_key: string;
  work_type: string;
  work_creator: string | null;
  work_title: string | null;
  why: string;
};

type TasteProfileRow = {
  axes: Record<string, number> | null;
  genre_weights: Record<string, number> | null;
  signal_weight_total: number;
  computed_at: string;
};

/**
 * Prompt'a giden yasak listesi KIRPILIR: aylar içinde bu küme yüzlerce satıra çıkar
 * (premium'da sınırsız hafıza yüzünden daha hızlı) ve hepsini basmak hem token
 * maliyeti hem prompt seyrelmesi demek.
 *
 * Filtrenin DOĞRULUĞU kodda (dönen öneri tam kümeyle karşılaştırılır); prompt'taki
 * liste yalnızca ipucudur. Ama "sevmediğim" kayıtları hiç düşmemeli — kullanıcının
 * açıkça reddettiği eserler.
 */
const PROMPT_BLOCK_LIMIT = 80;

function trimBlocked(blocked: BlockedWork[]): BlockedWork[] {
  const disliked = blocked.filter((b) => b.why === "disliked");
  const rest = blocked.filter((b) => b.why !== "disliked").slice(0, PROMPT_BLOCK_LIMIT);
  return [...disliked, ...rest];
}

function describeWork(work: BlockedWork): string {
  const title = work.work_title?.trim();
  const creator = work.work_creator?.trim();
  if (title && creator) return `${title} - ${creator}`;
  return title || creator || "";
}

/** Eksenleri modele okunur cümlelerle geçir; ham sayı isabetli yorumlanmıyor. */
function describeAxes(axes: Record<string, number> | null): string[] {
  if (!axes) return [];
  const lines: string[] = [];
  const say = (value: number | undefined, negative: string, positive: string) => {
    if (typeof value !== "number" || Math.abs(value) < 0.15) return;
    const strength = Math.abs(value) > 0.5 ? "belirgin şekilde" : "hafifçe";
    lines.push(value < 0 ? `${strength} ${negative}` : `${strength} ${positive}`);
  };
  say(axes.tone, "daha aydınlık/hafif işler", "daha karanlık/ağır işler");
  say(axes.popularity, "daha niş, az bilinen işler", "daha bilinen, popüler işler");
  say(axes.era, "daha klasik/eski işler", "daha çağdaş/yeni işler");
  return lines;
}

function buildPrompt(
  report: ReportRow,
  blocked: BlockedWork[],
  profile: TasteProfileRow | null,
  violation?: string,
): string {
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

  const blockedLines = trimBlocked(blocked)
    .map(describeWork)
    .filter(Boolean)
    .join("\n- ");

  const axisLines = describeAxes(profile?.axes ?? null);

  // Tür ağırlıkları: yalnızca belirgin olanlar. Sıfıra yakın değerler gürültüdür.
  const genres = Object.entries(profile?.genre_weights ?? {})
    .filter(([, w]) => Math.abs(w) >= 1)
    .sort((a, b) => b[1] - a[1]);
  const liked = genres.filter(([, w]) => w > 0).map(([g]) => g);
  const disliked = genres.filter(([, w]) => w < 0).map(([g]) => g);

  return `${archetype ? `Kullanıcının estetik arketipi: "${archetype}"` : ""}
${summary ? `Arketip özeti: "${summary}"` : ""}
${texture ? `Atmosfer/doku: "${texture}"` : ""}

Kullanıcının daha önce girdiği eserler (BUNLARLA KESINLIKLE ÇAKIŞMA):
- Kitaplar: ${booksList || "(yok)"}
- Filmler: ${filmsList || "(yok)"}
- Müzisyenler/Sanatçılar: ${songsList || "(yok)"}

${blockedLines ? `ÖNERME — kullanıcı bunları zaten değerlendirdi (farklı yazımları da dahil):\n- ${blockedLines}` : ""}

${axisLines.length ? `Kullanıcının geri bildirimlerinden çıkan yönelim: ${axisLines.join(", ")}.` : ""}
${liked.length ? `Yakınlık duyduğu türler: ${liked.join(", ")}.` : ""}
${disliked.length ? `Uzak durduğu türler: ${disliked.join(", ")}.` : ""}
${violation ? `\nÖNEMLİ: Az önce "${violation}" önerdin, bu ÖNERME listesindeydi. Bu kez farklı bir eser seç.` : ""}

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

const SLOTS = ["book", "film", "music"] as const;
type Slot = typeof SLOTS[number];

type DiscoveryItem = {
  slot: Slot;
  title: string;
  creator: string;
  reason: string;
  genre: string;
  tone: number;
  popularity: number;
  era: number;
};

type Discovery = {
  book: string;
  film: string;
  music: string;
  reasons: { book: string; film: string; music: string };
  items: DiscoveryItem[];
};

/** Eserin okunur adı. Eski TEXT kolonları bu biçimde yazılmaya devam eder. */
function displayName(item: DiscoveryItem): string {
  if (item.title && item.creator) return `${item.title} - ${item.creator}`;
  return item.title || item.creator;
}

/**
 * book/film/music DB'de NOT NULL — eksik alanla insert etmeye çalışma.
 *
 * Yeni biçim `items`; eski TEXT kolonları ondan TÜRETİLİR, ayrı bir kaynak değil.
 * Böylece kartta görünen ile Telegram botunun okuduğu ayrışamaz.
 */
function normalizeDiscovery(raw: unknown): Discovery | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const axis = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
  };

  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items: DiscoveryItem[] = [];

  for (const slot of SLOTS) {
    const found = rawItems.find(
      (i) => i && typeof i === "object" && (i as Record<string, unknown>).slot === slot,
    ) as Record<string, unknown> | undefined;
    if (!found) return null;

    const title = str(found.title);
    const creator = str(found.creator);
    // Müzikte yalnızca sanatçı adı gelir; ikisi birden boşsa öneri yok demektir.
    if (!title && !creator) return null;

    items.push({
      slot,
      title,
      creator,
      reason: str(found.reason),
      genre: str(found.genre),
      tone: axis(found.tone),
      popularity: axis(found.popularity),
      era: axis(found.era),
    });
  }

  const bySlot = (slot: Slot) => items.find((i) => i.slot === slot)!;

  return {
    book: displayName(bySlot("book")),
    film: displayName(bySlot("film")),
    music: displayName(bySlot("music")),
    reasons: {
      book: bySlot("book").reason,
      film: bySlot("film").reason,
      music: bySlot("music").reason,
    },
    items,
  };
}

function getTodayInIstanbul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
}

type Tempo = { profile_refreshed: boolean; signals_until_profile: number };

type Sb = ReturnType<typeof createClient>;

/**
 * Ücretsiz pakette haftalık toplu eksen ayarı — cron yok, haftanın ilk keşfi
 * hesaplamayı kendisi tetikler.
 *
 * Paket kontrolü ve tempo kuralı burada DEĞİL, `lens_refresh_profile_if_due`
 * içinde yaşar: fonksiyon istemciye de açık olmak zorunda olduğu için (bkz.
 * migration'daki PG 17.6 notu), kural burada dursaydı ücretsiz bir kullanıcı
 * RPC'yi üst üste çağırıp haftalık tempoyu atlayabilirdi.
 *
 * Kullanıcı ayarın çalıştığını GÖREBİLMELİ: ilerleme hissedilmezse ne kalır ne
 * dönüşür. Dönen değer karttaki işareti besler.
 */
async function refreshProfileIfDue(sb: Sb, userId: string): Promise<Tempo> {
  const { data, error } = await sb.rpc("lens_refresh_profile_if_due", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[daily-discovery] Haftalık eksen ayarı yapılamadı:", error);
    return { profile_refreshed: false, signals_until_profile: 0 };
  }

  const tempo = (data ?? {}) as Partial<Tempo>;
  return {
    profile_refreshed: Boolean(tempo.profile_refreshed),
    signals_until_profile: Number(tempo.signals_until_profile ?? 0),
  };
}

async function fetchProfile(sb: Sb, userId: string): Promise<TasteProfileRow | null> {
  const { data, error } = await sb
    .from("taste_profile")
    .select("axes, genre_weights, signal_weight_total, computed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[daily-discovery] Profil okunamadı:", error);
    return null;
  }
  return (data as TasteProfileRow | null) ?? null;
}

/** Yasak küme. Tanımı tek yerde: lens_blocked_works. */
async function fetchBlocked(sb: Sb, userId: string): Promise<BlockedWork[]> {
  const { data, error } = await sb.rpc("lens_blocked_works", { p_user_id: userId });
  if (error) {
    console.error("[daily-discovery] Yasak küme okunamadı:", error);
    return [];
  }
  return (data as BlockedWork[]) ?? [];
}

/**
 * Önerilerden herhangi biri yasak kümede mi? Anahtarları veritabanı üretir —
 * normalizasyon Deno tarafına kopyalanırsa eninde sonunda ayrışır ve filtre
 * sessizce delinir ("Fargo (Dizi)" ile "Fargo" farklı anahtar olur).
 */
async function findBlockedItem(
  sb: Sb,
  discovery: Discovery,
  blocked: BlockedWork[],
): Promise<string | undefined> {
  if (blocked.length === 0) return undefined;

  const payload = discovery.items.map((item) => ({
    type: item.slot === "music" ? "song" : item.slot,
    creator: item.creator,
    title: item.title,
  }));

  const { data, error } = await sb.rpc("lens_work_keys", { p_items: payload });
  if (error) {
    console.error("[daily-discovery] Anahtar üretilemedi:", error);
    return undefined; // doğrulama yapılamadıysa öneriyi engelleme
  }

  const keys = (data as string[]) ?? [];
  const blockedKeys = new Set(blocked.map((b) => b.work_key));
  const index = keys.findIndex((key) => blockedKeys.has(key));
  return index === -1 ? undefined : displayName(discovery.items[index]);
}

/** Claude çağrısı. Hata durumunda `fail()` koduna karşılık gelen string döner. */
async function askClaude(apiKey: string, prompt: string): Promise<Discovery | string> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // max_tokens 512 Türkçe çıktı için dardı: kırpılan yanıt geçersiz JSON'a
        // dönüp fonksiyonu 500'e düşürüyordu. items etiketleriyle çıktı daha da uzun.
        max_tokens: 1536,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    console.error("[daily-discovery] Claude API'ye ulaşılamadı:", err);
    return "claude_unreachable";
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[daily-discovery] Claude API hatası: ${res.status}`, errText);
    return `claude_http_${res.status}`;
  }

  const data = await res.json();
  const responseText: string = data.content?.[0]?.text ?? "";

  if (data.stop_reason === "max_tokens") {
    console.error("[daily-discovery] Çıktı max_tokens'a takıldı, JSON yarım kaldı.");
    return "claude_truncated";
  }

  let discovery: Discovery | null;
  try {
    discovery = normalizeDiscovery(extractJson(responseText));
  } catch (err) {
    console.error(
      "[daily-discovery] JSON parse edilemedi:", err,
      "| ham yanıt:", responseText.slice(0, 500),
    );
    return "claude_bad_json";
  }

  if (!discovery) {
    console.error("[daily-discovery] Eksik alanlı öneri:", responseText.slice(0, 500));
    return "claude_incomplete";
  }
  return discovery;
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

    // ---- Eksen ayarı: ücretsiz pakette HAFTALIK, premium'da her geri bildirimde.
    //
    // Premium tarafı record_feedback içinde yaşar; burada yalnızca ücretsizin
    // haftalık toplu ayarı çalışır ve cron gerektirmez — haftanın ilk keşfi
    // hesaplamayı kendisi tetikler.
    const tempo = await refreshProfileIfDue(sb, user.id);

    // Cache kontrolü. maybeSingle: satır yoksa hata değil null döner; aynı gün
    // için mükerrer satır varsa (unique index yoksa mümkün) en yenisini alırız.
    const { data: cached, error: cacheError } = await sb
      .from("daily_discoveries")
      .select("id, book, film, music, reasons, items, date")
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
      return new Response(JSON.stringify({ ...cached, ...tempo }), {
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

    // Yasak küme ve profil. İkisi de best-effort: okunamazsa keşif yine üretilir,
    // yalnızca daha kör üretilir — boş ekran her zaman daha kötüdür.
    const blocked = await fetchBlocked(sb, user.id);
    const profile = await fetchProfile(sb, user.id);

    let discovery: Discovery | null = null;
    let violation: string | undefined;

    // Deterministik doğrulama: prompt ipucu, kod otorite. Model yasaklı eseri
    // yine de önerirse BİR kez daha denenir — sonra logla ve yine de sun.
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidate = await askClaude(anthropicKey, buildPrompt(report, blocked, profile, violation));

      if (typeof candidate === "string") {
        // Elde önceki denemeden geçerli bir öneri varsa onunla devam et. Tekrar
        // denemenin başarısız olması, ilk denemenin ürününü çöpe atmayı gerektirmez:
        // içinde bir tekrar barındıran keşif, boş karttan iyidir.
        if (discovery) {
          console.error("[daily-discovery] Tekrar denemesi başarısız, ilk öneri sunuluyor:", candidate);
          break;
        }
        return fail(candidate, 502);
      }

      const offender = await findBlockedItem(sb, candidate, blocked);
      discovery = candidate;
      if (!offender) break;

      violation = offender;
      console.error(
        `[daily-discovery] Yasaklı eser önerildi (deneme ${attempt + 1}): ${offender}`,
      );
    }

    if (!discovery) {
      return fail("claude_incomplete", 502);
    }

    // DB'ye kaydet. Bu yazım best-effort: cache yazılamasa da kullanıcı
    // keşfini alır (analyze'daki havuz yazımıyla aynı prensip).
    //
    // items yeni kaynak; book/film/music ondan türetilir ve Telegram botu ile
    // eski okuyucular için aynen yazılmaya devam eder.
    const { data: inserted, error: insertError } = await sb
      .from("daily_discoveries")
      .insert({
        user_id: user.id,
        date: today,
        report_id: report.id,
        book: discovery.book,
        film: discovery.film,
        music: discovery.music,
        reasons: discovery.reasons,
        items: discovery.items,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("[daily-discovery] Cache yazılamadı:", insertError);
    }

    return new Response(
      JSON.stringify({ ...discovery, id: inserted?.id ?? null, date: today, ...tempo }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[daily-discovery] Beklenmeyen hata:", err);
    return fail("unexpected");
  }
});
