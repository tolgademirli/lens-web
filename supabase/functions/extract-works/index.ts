// extract-works: ekran görüntüsü veya yapıştırılan metinden eser çıkarımı.
//
// Screenshot-to-DNA §8.2. Saf çıkarım yapar — user_works'e YAZMAZ.
// Yazma işi onay ekranından sonra olur ("Hiçbir şey senin onayın olmadan
// profiline geçmiyor"). Kullanıcı onay ekranında sana ait olmayanı silecek;
// havuza yalnızca onaylanan set girer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Teknik güvenlik tavanı ("kütüphane sınırsız" kararının istisnası):
// tek çağrıda işlenecek girdi ve dönecek eser sayısına makul kesme.
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (brief §2b)
const MAX_TEXT_CHARS = 10_000;
const MAX_WORKS = 50;

const ALLOWED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface TypeLabel {
  tekil: string;
  yaratici: string;
  /** Üç girdi biçimi için kategoriye özel örnekler. */
  ornek: { yalnizYaratici: string; yalnizEser: string; ikisi: string };
}

const TYPE_LABELS: Record<string, TypeLabel> = {
  book: {
    tekil: "kitap",
    yaratici: "yazar",
    ornek: {
      yalnizYaratici: "Franz Kafka",
      yalnizEser: "Bulantı",
      ikisi: "Yabancı - Albert Camus",
    },
  },
  film: {
    tekil: "film",
    yaratici: "yönetmen",
    ornek: {
      yalnizYaratici: "Nuri Bilge Ceylan",
      yalnizEser: "Masumiyet",
      ikisi: "Uzak - Nuri Bilge Ceylan",
    },
  },
  song: {
    tekil: "müzik",
    yaratici: "sanatçı veya grup",
    ornek: {
      yalnizYaratici: "Adamlar",
      yalnizEser: "Bir Derdim Var",
      ikisi: "La vie en rose - Edith Piaf",
    },
  },
};

function buildSystemPrompt(type: string): string {
  const { tekil, yaratici, ornek } = TYPE_LABELS[type];
  return `Sen Lens'in eser çıkarım motorusun. Görevin, kullanıcının paylaştığı
ekran görüntüsünden veya metinden ${tekil} listesini çıkarmak.

## ÇIKARIM KURALLARI
- Girdideki HER eseri çıkar. Satır atlamak, en sık yaptığın hatadır.
- title (eser adı) opsiyoneldir. Girdide yoksa ya da seçemiyorsan boş string ("")
  döndür; seçemediysen ayrıca confidence'ı düşür.
- Aynı eseri iki kez listeleme.
- Kullanıcı arayüzü öğelerini (menü, buton, "Want to Read", takipçi sayısı,
  yıldız/puan, tarih, "Şimdi çalınıyor") eser sanma.

## ADI DEĞİŞTİRME — EN SIK YAPILAN AĞIR HATA
title alanına GİRDİDE OKUDUĞUN metni yaz. Okuduğun adı BAŞKA BİR ESERİN adıyla
değiştirmen kesinlikle yasaktır.
- "Kör Baykuş" okuyorsan çıktın "Kör Baykuş" olur. Onu "Kürk Mantolu Madonna"
  gibi daha tanıdık bir esere çevirmek uydurmadır.
- Yalnızca harf düzeyindeki bariz OCR hatalarını düzeltebilirsin
  ("TutunamayanIar" → "Tutunamayanlar"). Kelime değiştirmek, ad benzetmek yok.
- Okuduğun ad tanımadığın bir eserse AYNEN yaz, creator'ı boş bırak,
  creator_inferred: false yap. Tanımamak sorun değil; yanlış eser yazmak felakettir.
- Adı net seçemiyorsan creator'ı ASLA tamamlama: önce ne okuduğundan emin ol.
  Emin değilsen confidence: "low" ver ve creator'ı boş bırak.
- Bir eseri "şuna benziyor" diye bir yazara yakıştırma. Türkçe bir eser adı
  görüp tanıdık bir Türk yazarı yazmak tipik bir hatadır: eseri gerçekten
  biliyorsan yaz, bilmiyorsan boş bırak.

## SATIR BİÇİMLERİ — ÜÇÜ DE GEÇERLİ, ÜÇÜNÜ DE İŞLE
Aynı liste içinde bu üç biçim karışık bulunur. Hiçbirini atlama:

1. YALNIZCA ${yaratici.toUpperCase()} — örn. "${ornek.yalnizYaratici}"
   → creator: "${ornek.yalnizYaratici}", title: "", creator_inferred: false

2. YALNIZCA ESER ADI — örn. "${ornek.yalnizEser}"
   → title'a OKUDUĞUN adı yaz (değiştirmeden). Bu adı net okuduysan VE eseri
     güvenle tanıyorsan ${yaratici} adını SEN TAMAMLA, creator_inferred: true yap.
     Bu uydurma DEĞİL, tanımadır: eser zaten girdide duruyor, sen yalnızca kime
     ait olduğunu söylüyorsun.
   → Adı net okuyamadıysan ya da eseri tanımıyorsan: creator: "",
     creator_inferred: false. Kullanıcı onay ekranında kendisi tamamlar.
     Tamamlamak zorunda değilsin — emin olmadığın yerde boş bırak.

3. İKİSİ BİRLİKTE — örn. "${ornek.ikisi}"
   → İkisini de yaz, creator_inferred: false. Hangi tarafın eser, hangi tarafın
     ${yaratici} olduğuna ANLAMINA göre karar ver, sıraya güvenme: her iki sıralama
     da ("Eser - ${yaratici}" ve "${yaratici} - Eser") kullanılır.

## TİRE HER ZAMAN AYIRICI DEĞİLDİR
"-" işareti eserin KENDİ adının parçası olabilir (örn. "Sıcak - Soğuk Mevsimler"
tek bir eser adıdır, "Sıcak" adlı bir eser + "Soğuk Mevsimler" adlı bir ${yaratici}
değil). Satırı bölmeden önce sor: iki taraf da ayrı ayrı anlamlı mı, yoksa bütün
satır tek bir ad olarak mı okunuyor?
- Bütün satır tek bir eser adıysa → 2. biçim gibi davran: hepsini title'a yaz.
- Emin olamıyorsan BÖLME. Satırın tamamını title'a yaz, creator'ı boş bırak,
  creator_inferred: false yap. Kullanıcı onay ekranında düzeltir.

Tahmine dayalı isim yazma. Emin değilsen creator'ı boş bırak — yanlış bir
${yaratici} adı, boş bırakmaktan çok daha kötüdür. Çözemediğin satırı atlamak da
yanlıştır: her satır dönmeli, çözülemeyen kısım boş kalmalı.

## creator_inferred — İSTİSNASIZ KURAL
Bu bayrak "bu yazarı ben mi buldum, yoksa girdide mi yazıyordu" sorusunu yanıtlar.
- creator adını girdide HARFİ HARFİNE okuduysan → creator_inferred: false
- creator adı girdide YAZMIYORSA ve sen eserden yola çıkıp buldıysan →
  creator_inferred: TRUE. İstisna yok. Ne kadar emin olursan ol, ne kadar meşhur
  olursa olsun, girdide yazmıyorsa bayrak true olmak zorundadır.
Yanlış bayrak, kullanıcının yanlış bilgiyi kontrol etme şansını elinden alır.
Bulduğun yazardan emin değilsen zaten yazma: creator'ı boş bırak.

## GÜVEN SİNYALİ (confidence)
- "high": ad net okunuyor ve tanıdığın/tutarlı bir eser.
- "medium": okunuyor ama kısmen kesik, bulanık ya da emin değilsin.
- "low": zar zor seçiliyor.

## EN ÖNEMLİ KURAL — ASLA UYDURMA
Girdide OLMAYAN bir eseri listeye ekleme. Tamamlamana izin verilen tek şey,
girdide zaten bulunan bir eserin ${yaratici} adıdır — eserin kendisi asla.
Girdideki bir eseri başka bir eserle DEĞİŞTİRMEK de listeye olmayan eser
eklemektir; en ağır hata budur.

Girdide net bir ${tekil} listesi yoksa works dizisini BOŞ döndür.
Bir akış diyagramı, tablo, sohbet ekranı, manzara fotoğrafı, kod ekranı ya da
alakasız herhangi bir görsel gelirse: boş dizi döndür.
Tahmin etme, tamamlama, "muhtemelen şudur" deme, popüler eser önerme.
Boş dönmek doğru davranıştır — uydurmak ürünü bitirir.`;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    works: {
      type: "array",
      items: {
        type: "object",
        properties: {
          creator: { type: "string" },
          title: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          // Yaratıcı girdide yazmıyordu, model eseri tanıyıp tamamladı.
          // Kullanıcıya ayrı rozetle gösterilir ki doğrulayabilsin.
          creator_inferred: { type: "boolean" },
        },
        required: ["creator", "title", "confidence", "creator_inferred"],
        additionalProperties: false,
      },
    },
  },
  required: ["works"],
  additionalProperties: false,
};

const DAILY_EXTRACTIONS = 30;

/**
 * Günlük çıkarım kotası. Kimlik varsa kullanıcı id'sine, yoksa IP'ye bakar.
 * Fail-open: `extraction_quota` tablosu yoksa veya sorgu hata verirse false döner,
 * yani istek geçer. Kota altyapısı ürünü durdurmamalı.
 */
async function quotaExceeded(
  sb: ReturnType<typeof createClient>,
  clientKey: string
): Promise<boolean> {
  try {
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Istanbul",
    }).format(new Date());

    const { data, error } = await sb.rpc("bump_extraction_quota", {
      p_client_key: clientKey,
      p_date: today,
    });

    if (error) return false; // tablo/fonksiyon yok ya da sorgu patladı → engelleme
    return typeof data === "number" && data > DAILY_EXTRACTIONS;
  } catch {
    return false;
  }
}

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Auth ZORUNLU DEĞİL. Onboarding'de kullanıcı henüz giriş yapmamış oluyor;
    // hızlı yolu ona kapatmak özelliğin varlık sebebini boşa çıkarırdı.
    // Çıkarım stateless — hiçbir şey yazmıyor. Havuza yazım girişten sonra olur.
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const userId = token
      ? (await sb.auth.getUser(token)).data.user?.id ?? null
      : null;

    // Anonim erişime açık bir vision endpoint'i — kötüye kullanım maliyet yaratır.
    // Kota kimlik yoksa IP'ye düşer. Tablo yoksa/sorgu patlarsa isteği ENGELLEMEZ
    // (fail-open): kota altyapısı bir aksaklık yüzünden ürünü durdurmasın.
    const clientKey =
      userId ??
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      "bilinmeyen";
    if (await quotaExceeded(sb, clientKey)) {
      return bad("Bugünlük çıkarım limitine ulaştın. Yarın tekrar deneyebilirsin.", 429);
    }

    const { type, images, text } = await req.json();

    if (!TYPE_LABELS[type]) {
      return bad("Geçersiz kategori.");
    }

    const imageList = Array.isArray(images) ? images : [];
    const pastedText = typeof text === "string" ? text.trim() : "";

    if (imageList.length === 0 && !pastedText) {
      return bad("Önce görsel ya da metin ekle.");
    }
    if (imageList.length > MAX_IMAGES) {
      return bad(`Tek seferde en fazla ${MAX_IMAGES} görsel yükleyebilirsin.`);
    }
    if (pastedText.length > MAX_TEXT_CHARS) {
      return bad("Yapıştırdığın metin çok uzun.");
    }

    // Görselleri doğrula ve Claude içerik bloklarına çevir.
    const content: unknown[] = [];
    for (const img of imageList) {
      const mediaType = img?.media_type;
      const data = img?.data;
      if (typeof data !== "string" || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
        return bad("Yalnızca PNG, JPG, WEBP veya GIF yükleyebilirsin.");
      }
      // base64 uzunluğundan yaklaşık byte boyutu.
      if (Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES) {
        return bad("Görsel en fazla 10 MB olabilir.");
      }
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    }

    const { tekil } = TYPE_LABELS[type];
    content.push({
      type: "text",
      text: pastedText
        ? `Aşağıdaki metinden ${tekil} listesini çıkar:\n\n${pastedText}`
        : `Bu görsel(ler)den ${tekil} listesini çıkar.`,
    });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        // Opus 5'te thinking varsayılan açık ve max_tokens thinking + yanıtı
        // birlikte kapsıyor. Uzun raflarda (20+ eser) kesilmemesi için geniş pay.
        max_tokens: 12000,
        // Çıkarım rutin bir iş; düşük effort hem yeterli hem de onboarding'in
        // vaat ettiği 4-6 saniyeyi tutturuyor. Kalite düşerse yükseltilebilir.
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        system: buildSystemPrompt(type),
        messages: [{ role: "user", content }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`[extract-works] Claude API hatası: ${anthropicRes.status}`, errText);
      return bad("Bir hata oluştu. Lütfen tekrar deneyin.", 500);
    }

    const data = await anthropicRes.json();

    // Refusal kontrolü content'ten ÖNCE — refusal'da content boş ya da kısmi olur.
    if (data.stop_reason === "refusal") {
      console.warn("[extract-works] Model isteği reddetti:", data.stop_details);
      return new Response(
        JSON.stringify({ works: [], batch_id: crypto.randomUUID() }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const responseText: string =
      data.content?.find((b: { type: string }) => b.type === "text")?.text ?? "";

    let parsed: { works?: unknown[] };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // max_tokens'a çarpıldıysa JSON yarım kalır — sessiz parse hatası yerine
      // nedeni logla, yoksa bu sınıf hata teşhis edilemez.
      if (data.stop_reason === "max_tokens") {
        console.error("[extract-works] Çıktı max_tokens'a takıldı; liste çok uzun olabilir.");
        return bad("Liste çok uzun geldi. Daha az eser içeren bir görsel dene.", 400);
      }
      console.error("[extract-works] JSON parse edilemedi:", responseText.slice(0, 500));
      return bad("Bir hata oluştu. Lütfen tekrar deneyin.", 500);
    }

    const source = pastedText && imageList.length === 0 ? "paste" : "screenshot";

    // Şema creator'ı zorunlu kılıyor ama boş string'i engellemiyor —
    // yaratıcısı olmayan satır işe yaramaz, ele.
    const works = (parsed.works ?? [])
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .map((w) => {
        const confidence = (w.confidence as string) ?? "high";
        const title = String(w.title ?? "").trim();
        let creator = String(w.creator ?? "").trim();
        let inferred = w.creator_inferred === true;

        // Yapısal güvence: düşük güvenli okumada yazar adı GEÇMEZ.
        // Model prompt'a rağmen bir kez uydurulmuş yazarı "okudum" diye
        // işaretledi (Bozkırkurdu → "Yaşar Kemal", creator_inferred: false).
        // Yanlış adı doğrulama rozetiyle göstermek yerine hiç göstermiyoruz:
        // eser adı korunur, yazarı kullanıcı doldurur. creator zaten opsiyonel.
        if (confidence === "low" && creator && title) {
          creator = "";
          inferred = false;
        }

        return { creator, title, confidence, creator_inferred: inferred, source };
      })
      // Yaratıcısı boş satırlar KALIR — kullanıcı onay ekranında tamamlar.
      // Yalnızca tamamen boş satır elenir.
      .filter((w) => w.creator.length > 0 || w.title.length > 0)
      .slice(0, MAX_WORKS);

    // works boş → istemci guardrail ekranını gösterir (brief §2e).
    return new Response(
      JSON.stringify({ works, batch_id: crypto.randomUUID() }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[extract-works] Beklenmeyen hata:", err);
    return bad("Bir hata oluştu. Lütfen tekrar deneyin.", 500);
  }
});
