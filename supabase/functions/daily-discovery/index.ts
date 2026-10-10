import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SENSITIVE_INFERENCE_RULE } from "../_shared/sensitive.ts";
import { checkBook, checkFilm } from "./workCheck.ts";

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

## YALNIZCA GERÇEK ESERLER
Önerdiğin kitap, film ve sanatçı GERÇEKTEN var olmalı; eserin adı da yaratıcısı da doğru olmalı.
- Bir eserin adından ya da kime ait olduğundan emin değilsen onu önerme; emin olduğun başka bir eser seç.
- Bir yazarın ya da yönetmenin dünyasına yakışan ama var olmayan bir ad KURMA. Uydurma bir eser, tekrar eden ya da sıradan bir öneriden çok daha kötüdür.
- "ÖNERME" listesi uzun olsa da, niş işler istense de bu kural esnemez: az bilinen ama gerçek bir eser bul; bulamıyorsan daha bilinen bir esere dön.
- Eseri Türkiye'de bilinen adıyla yaz. Türkçe adından emin değilsen özgün adını yaz; kendi çevirini ad diye yazma.
- Müzik önerisi müzik YAPAN biri olmalı: şair, romancı ya da yönetmen değil.
- Kitap ve film önerin kataloglarda yaratıcısıyla birlikte aranır; bulunamayan eser kullanıcıya sunulmaz.

${SENSITIVE_INFERENCE_RULE}

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
      "original_title": "Kitabın özgün adı",
      "creator": "Yazar",
      "reason": "Neden bu kişiye uygun (max 12 kelime)",
      "genre": "tür",
      "tone": 0.4,
      "popularity": -0.2,
      "era": -0.6
    },
    { "slot": "film", "title": "Film Adı", "original_title": "Filmin özgün adı", "creator": "Yönetmen", "reason": "...", "genre": "...", "tone": 0, "popularity": 0, "era": 0 },
    { "slot": "music", "title": "", "creator": "Sanatçı Adı", "reason": "...", "genre": "...", "tone": 0, "popularity": 0, "era": 0 }
  ]
}

Müzik önerisinde sanatçı adı "creator" alanına yazılır, "title" boş bırakılır.
Eser adı ile yaratıcı adı AYRI alanlarda durur — tek bir string'e birleştirme.
"original_title" kitapta ve filmde bulunur: eserin özgün dilindeki adı (Türkçe bir eserse
"title" ile aynı). Latin alfabesi kullanmayan dillerde İngilizce adını yaz. Katalog aramasında
kullanılır; "title" kataloglarda bulunamazsa kullanıcıya onun yerine bu ad gösterilir.
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
 *
 * Kırpma KATMANLI: disliked (sınırsız) > shown (son 30 günde gösterilenler) > diğerleri.
 * Tavan değişmedi, değişen hangi 80'in girdiği. `shown`ı öne almasaydık dün gösterilen
 * eser prompt'a girmeyip altı aylık bir "listeye aldım" kaydı girebilirdi — tekrar
 * şikâyetinin ta kendisi. Payı 80'in tamamı DEĞİL: 3. katmana nefes payı bırakılmazsa
 * prompt'tan düşen bir "listedeki" eser önerilip retry'a (tam bir Claude çağrısı)
 * yol açar. Dizi SQL tarafında zaten bu sırada ve her katman içinde yeniden eskiye
 * doğru geliyor, o yüzden slice en tazeyi tutar.
 */
const PROMPT_BLOCK_LIMIT = 80;
const PROMPT_SHOWN_SHARE = 55;

function trimBlocked(blocked: BlockedWork[]): BlockedWork[] {
  const disliked = blocked.filter((b) => b.why === "disliked");
  const shown = blocked.filter((b) => b.why === "shown").slice(0, PROMPT_SHOWN_SHARE);
  const rest = blocked
    .filter((b) => b.why !== "disliked" && b.why !== "shown")
    .slice(0, PROMPT_BLOCK_LIMIT - shown.length);
  return [...disliked, ...shown, ...rest];
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

/**
 * Önceki denemelerde geri çevrilen eserler ve nedeni. İkisi birden dolu olabilir:
 * film yasak kümeden çıkmış, kitap da katalogda bulunamamış olabilir.
 */
type Rejection = { blocked: string[]; unverified: string[] };

const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(" ve ");

function buildPrompt(
  report: ReportRow,
  blocked: BlockedWork[],
  profile: TasteProfileRow | null,
  rejection?: Rejection,
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

${blockedLines ? `ÖNERME — bunlar kullanıcının zaten karşısına çıktı (farklı yazımları da dahil):\n- ${blockedLines}` : ""}

${axisLines.length ? `Kullanıcının geri bildirimlerinden çıkan yönelim: ${axisLines.join(", ")}.` : ""}
${liked.length ? `Yakınlık duyduğu türler: ${liked.join(", ")}.` : ""}
${disliked.length ? `Uzak durduğu türler: ${disliked.join(", ")}.` : ""}
${rejection?.blocked.length ? `\nÖNEMLİ: Az önce ${quoted(rejection.blocked)} önerdin, bu ÖNERME listesindeydi. Bu kez farklı bir eser seç.` : ""}
${rejection?.unverified.length ? `\nÖNEMLİ: Az önce ${quoted(rejection.unverified)} önerdin; kataloglarda bu adla ve bu yaratıcıyla bulunamadı. Onun yerine az bilinen bir eser ARAMA: adından ve yaratıcısından kesin emin olduğun, yaygın olarak bilinen BAŞKA bir eser seç.` : ""}

Bu zevke uygun, yukarıdaki eserlerle çakışmayan 1 kitap, 1 film, 1 müzik sanatçısı öner.
Her öneri için neden uygun olduğunu 1 kısa cümle yaz (max 12 kelime).
Sadece JSON döndür.`;
}

/**
 * Model bazen JSON'u ```json bloğuna sarıyor ya da önüne bir cümle koyuyor.
 *
 * Birden çok blok varsa SONUNCUSU alınır. Model arada bir ilk cevabını yazdıktan
 * sonra kendini düzeltiyor ("Dur — müzik önerimde hata var: X bir romancı, müzisyen
 * değil. Düzelterek yeniden veriyorum:") ve ikinci bir blok yazıyor. İlk bloğu almak,
 * modelin kendi yakaladığı hatayı kullanıcıya sunmak demekti.
 */
function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)].at(-1);
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

/**
 * Bir keşif için en çok kaç Claude çağrısı yapılır (bkz. ana döngü).
 *
 * 2 = tek tekrar hakkı. 3 denendi ve bilerek geri alındı (11 Ekim 2026): ölçümde
 * üçüncü çağrı keşiflerin tahminen %2-8'inde gerekiyordu; kazancı o kuyruğu kesmek,
 * bedeli kullanıcıyı ~25 sn bekletmek ve keşif başına maliyeti yükseltmekti. İki
 * denemede de katalogda bulunamayan eser loglanır ve yine de sunulur.
 */
const MAX_ATTEMPTS = 2;

/**
 * Tekrar denemesi yalnızca bu süre dolmadan başlar. Tek deneme en kötü hâlde
 * ~60 sn sürebiliyor (Claude zaman aşımı 45 sn + katalog sorguları) ve o kadar
 * beklemiş kullanıcıyı bir o kadar daha bekletmek, edge function'ın duvar saati
 * sınırına (150 sn) da yaklaşmak demek. Tipik deneme 8-10 sn.
 */
const RETRY_BUDGET_MS = 60_000;

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
 * Üç öğeden keşfi kurar. Yeni biçim `items`; eski TEXT kolonları ve `reasons` ondan
 * TÜRETİLİR, ayrı bir kaynak değil. Böylece kartta görünen ile Telegram botunun
 * okuduğu ayrışamaz — bir öğenin adı değişse ya da öğeler farklı denemelerden gelse bile.
 */
function toDiscovery(items: DiscoveryItem[]): Discovery {
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
    items: SLOTS.map(bySlot),
  };
}

/** book/film/music DB'de NOT NULL — eksik alanla insert etmeye çalışma. */
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

  return toDiscovery(items);
}

/**
 * Claude'un tek denemede döndürdüğü şey. `originalTitles` kasıtlı olarak
 * `Discovery`nin DIŞINDA: yalnızca katalog aramasının girdisi, `items`'a yazılmaz
 * ve istemciye dönmez.
 */
type Candidate = { discovery: Discovery; originalTitles: Record<Slot, string> };

/**
 * Öğeyi kataloğa sorar (bkz. workCheck.ts). Müzik sorulmaz.
 *
 * `missing` yalnızca KESİN "yok" cevabında true'dur; katalog sorulamadıysa öğe
 * olduğu gibi geçer. Eser gerçek ama kartta yazacak ad bulunamadıysa (modelin kendi
 * çevirisi olabilir) öğe, doğrulanan özgün adıyla döner.
 */
async function settle(
  item: DiscoveryItem,
  originalTitle: string,
): Promise<{ item: DiscoveryItem; missing: boolean }> {
  const check = item.slot === "book" ? checkBook : item.slot === "film" ? checkFilm : null;
  if (!check) return { item, missing: false };

  const verdict = await check({ title: item.title, creator: item.creator, originalTitle });
  if (verdict === "original") {
    console.error(
      `[daily-discovery] Ad doğrulanamadı, özgün ad gösteriliyor: ${displayName(item)} → ${originalTitle}`,
    );
    return { item: { ...item, title: originalTitle }, missing: false };
  }
  return { item, missing: verdict === "not_found" };
}

function originalTitleOf(raw: unknown, slot: Slot): string {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return "";
  const found = items.find(
    (i) => i && typeof i === "object" && (i as Record<string, unknown>).slot === slot,
  ) as Record<string, unknown> | undefined;
  return typeof found?.original_title === "string" ? found.original_title.trim() : "";
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
 * Önerilerden hangileri yasak kümede? Anahtarları veritabanı üretir —
 * normalizasyon Deno tarafına kopyalanırsa eninde sonunda ayrışır ve filtre
 * sessizce delinir ("Fargo (Dizi)" ile "Fargo" farklı anahtar olur).
 */
async function blockedSlots(
  sb: Sb,
  items: DiscoveryItem[],
  blocked: BlockedWork[],
): Promise<Set<Slot>> {
  if (blocked.length === 0) return new Set();

  const payload = items.map((item) => ({
    type: item.slot === "music" ? "song" : item.slot,
    creator: item.creator,
    title: item.title,
  }));

  const { data, error } = await sb.rpc("lens_work_keys", { p_items: payload });
  if (error) {
    console.error("[daily-discovery] Anahtar üretilemedi:", error);
    return new Set(); // doğrulama yapılamadıysa öneriyi engelleme
  }

  const keys = (data as string[]) ?? [];
  const blockedKeys = new Set(blocked.map((b) => b.work_key));
  return new Set(items.filter((_, index) => blockedKeys.has(keys[index])).map((item) => item.slot));
}

/** Claude çağrısı. Hata durumunda `fail()` koduna karşılık gelen string döner. */
async function askClaude(apiKey: string, prompt: string): Promise<Candidate | string> {
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
        // 1536 da sınırdaydı: model kendini düzeltip ikinci bir JSON yazdığında
        // (bkz. extractJson) çıktı ölçümde 1409 token'a çıktı. Tipik çıktı ~380.
        max_tokens: 2048,
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
  let originalTitles: Record<Slot, string> = { book: "", film: "", music: "" };
  try {
    const raw = extractJson(responseText);
    discovery = normalizeDiscovery(raw);
    originalTitles = {
      book: originalTitleOf(raw, "book"),
      film: originalTitleOf(raw, "film"),
      music: "",
    };
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
  return { discovery, originalTitles };
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

    // Slot başına elde tutulan en iyi öğe. flaw: 0 temiz · 1 yasak kümede · 2 katalogda yok.
    // Olmayan eser, tekrar eden eserden KÖTÜDÜR (tekrar bir sıkıcılık, olmayan eser
    // yanlış bilgi); sıra bu yüzden böyle.
    const chosen = new Map<Slot, { item: DiscoveryItem; flaw: number }>();
    const rejection: Rejection = { blocked: [], unverified: [] };
    const startedAt = Date.now();

    // Deterministik doğrulama: prompt ipucu, kod otorite. İki şey sınanır — eser
    // yasak kümede mi, ve kitap ile film GERÇEKTEN var mı (bkz. workCheck.ts).
    //
    // SLOTLAR BAĞIMSIZ: bir denemede temiz çıkan öğe elde tutulur, sonraki deneme
    // yalnızca kusurlu kalan slotu doldurmak içindir. Tekrar denemesi tam bir Claude
    // çağrısı; ilk denemenin sağlam kitabını, ikincinin bozuk kitabı yüzünden atmak
    // o çağrıyı boşa harcamak olurdu (ölçümde ikinci deneme, ilkinde sorunsuz olan
    // slotu 12'de 2-3 kez bozdu).
    //
    // Kusurlu slot kalırsa BİR kez daha denenir; o da tutmazsa loglanıp yine de
    // sunulur (boş kart göstermek daha kötü).
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = await askClaude(
        anthropicKey,
        buildPrompt(report, blocked, profile, attempt === 0 ? undefined : rejection),
      );

      if (typeof candidate === "string") {
        // Elde önceki denemeden bir öneri varsa onunla devam et. Tekrar denemenin
        // başarısız olması, ilk denemenin ürününü çöpe atmayı gerektirmez: içinde
        // bir tekrar barındıran keşif, boş karttan iyidir.
        if (chosen.size > 0) {
          console.error("[daily-discovery] Tekrar denemesi başarısız, eldeki öneri sunuluyor:", candidate);
          break;
        }
        return fail(candidate, 502);
      }

      const settled = await Promise.all(
        candidate.discovery.items.map((item) => settle(item, candidate.originalTitles[item.slot])),
      );
      // Yasak küme, kartta GÖRÜNECEK adlarla sınanır — ad özgününe döndüyse anahtar da değişti.
      const repeats = await blockedSlots(sb, settled.map((s) => s.item), blocked);

      for (const { item, missing } of settled) {
        const flaw = missing ? 2 : repeats.has(item.slot) ? 1 : 0;
        const held = chosen.get(item.slot);
        if (!held || flaw < held.flaw) chosen.set(item.slot, { item, flaw });

        // Geri bildirime yalnızca hâlâ çözülmemiş slotun reddi girer.
        if (chosen.get(item.slot)!.flaw > 0 && flaw > 0) {
          (flaw === 2 ? rejection.unverified : rejection.blocked).push(displayName(item));
          console.error(
            `[daily-discovery] ${flaw === 2 ? "Katalogda bulunamadı" : "Yasaklı eser önerildi"} ` +
              `(deneme ${attempt + 1}): ${displayName(item)}`,
          );
        }
      }

      const worst = Math.max(...[...chosen.values()].map((held) => held.flaw));
      if (worst === 0) break;
      if (Date.now() - startedAt > RETRY_BUDGET_MS) {
        console.error("[daily-discovery] Süre bütçesi doldu, eldeki öneri sunuluyor.");
        break;
      }
    }

    if (chosen.size < SLOTS.length) {
      return fail("claude_incomplete", 502);
    }
    const unverified = [...chosen.values()].filter((held) => held.flaw === 2);
    if (unverified.length > 0) {
      // Kataloglar gerçek eserleri de kaçırabiliyor; hiçbir denemede bulunamayan
      // eseri yine de sunuyoruz (boş kart daha kötü). Günlüklerde aranacak satır bu:
      // sıklaşırsa ya katalog ya prompt bozulmuş demektir.
      console.error(
        "[daily-discovery] DOĞRULANAMAYAN eser sunuluyor:",
        unverified.map((held) => displayName(held.item)).join(" | "),
      );
    }
    const discovery = toDiscovery(SLOTS.map((slot) => chosen.get(slot)!.item));

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
