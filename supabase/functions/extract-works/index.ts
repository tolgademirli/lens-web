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
- title (eser adı) opsiyoneldir. Okunamıyorsa veya girdide yoksa boş string ("") döndür
  ve title_readable alanını false yap.
- Aynı eseri iki kez listeleme.
- Kullanıcı arayüzü öğelerini (menü, buton, "Want to Read", takipçi sayısı,
  yıldız/puan, tarih, "Şimdi çalınıyor") eser sanma.
- Adları girdide yazıldığı gibi, doğru imlayla yaz. Tanıdığın bir eserin adı
  yanlış yazılmışsa düzelt; tanımadığını düzeltmeye çalışma.

## SATIR BİÇİMLERİ — ÜÇÜ DE GEÇERLİ, ÜÇÜNÜ DE İŞLE
Aynı liste içinde bu üç biçim karışık bulunur. Hiçbirini atlama:

1. YALNIZCA ${yaratici.toUpperCase()} — örn. "${ornek.yalnizYaratici}"
   → creator: "${ornek.yalnizYaratici}", title: "", title_readable: false,
     creator_inferred: false

2. YALNIZCA ESER ADI — örn. "${ornek.yalnizEser}"
   → title'a eser adını yaz. Eseri güvenle tanıyorsan ${yaratici} adını SEN TAMAMLA
     ve creator_inferred: true yap. Bu uydurma DEĞİL, tanımadır: eser zaten girdide
     duruyor, sen yalnızca kime ait olduğunu söylüyorsun.
   → Eseri tanımıyorsan yine de döndür: creator: "", creator_inferred: false.
     Kullanıcı onay ekranında kendisi tamamlar.

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

## GÜVEN SİNYALİ (confidence)
- "high": ad net okunuyor ve tanıdığın/tutarlı bir eser.
- "medium": okunuyor ama kısmen kesik, bulanık ya da emin değilsin.
- "low": zar zor seçiliyor.

## EN ÖNEMLİ KURAL — ASLA UYDURMA
Girdide OLMAYAN bir eseri listeye ekleme. Tamamlamana izin verilen tek şey,
girdide zaten bulunan bir eserin ${yaratici} adıdır — eserin kendisi asla.

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
          title_readable: { type: "boolean" },
          // Yaratıcı girdide yazmıyordu, model eseri tanıyıp tamamladı.
          // Kullanıcıya ayrı rozetle gösterilir ki doğrulayabilsin.
          creator_inferred: { type: "boolean" },
        },
        required: ["creator", "title", "confidence", "title_readable", "creator_inferred"],
        additionalProperties: false,
      },
    },
  },
  required: ["works"],
  additionalProperties: false,
};

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
    // Auth zorunlu — analyze ile aynı desen.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return bad("Bu işlem için giriş yapman gerekiyor.", 401);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      return bad("Geçersiz oturum. Lütfen tekrar giriş yap.", 401);
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
      .map((w) => ({
        creator: String(w.creator ?? "").trim(),
        title: String(w.title ?? "").trim(),
        confidence: w.confidence as string,
        title_readable: w.title_readable === true,
        creator_inferred: w.creator_inferred === true,
        source,
      }))
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
