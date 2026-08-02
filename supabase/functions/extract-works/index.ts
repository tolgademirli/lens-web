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

const TYPE_LABELS: Record<string, { tekil: string; yaratici: string }> = {
  book: { tekil: "kitap", yaratici: "yazar" },
  film: { tekil: "film", yaratici: "yönetmen" },
  song: { tekil: "müzik", yaratici: "sanatçı veya grup" },
};

function buildSystemPrompt(type: string): string {
  const { tekil, yaratici } = TYPE_LABELS[type];
  return `Sen Lens'in eser çıkarım motorusun. Görevin, kullanıcının paylaştığı
ekran görüntüsünden veya metinden ${tekil} listesini çıkarmak.

## ÇIKARIM KURALLARI
- Yalnızca girdide GERÇEKTEN GÖRÜNEN eserleri çıkar.
- creator (${yaratici}) zorunludur. Yaratıcı adı okunamıyorsa o satırı atla.
- title (eser adı) opsiyoneldir. Okunamıyorsa veya girdide yoksa boş string ("") döndür
  ve title_readable alanını false yap.
- Aynı eseri iki kez listeleme.
- Kullanıcı arayüzü öğelerini (menü, buton, "Want to Read", takipçi sayısı,
  yıldız/puan, tarih, "Şimdi çalınıyor") eser sanma.
- Adları girdide yazıldığı gibi, doğru imlayla yaz. Tanıdığın bir eserin adı
  yanlış yazılmışsa düzelt; tanımadığını düzeltmeye çalışma.

## GÜVEN SİNYALİ (confidence)
- "high": ad net okunuyor ve tanıdığın/tutarlı bir eser.
- "medium": okunuyor ama kısmen kesik, bulanık ya da emin değilsin.
- "low": zar zor seçiliyor.

## EN ÖNEMLİ KURAL — ASLA UYDURMA
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
        },
        required: ["creator", "title", "confidence", "title_readable"],
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
        // birlikte kapsıyor — çıktı şeması küçük olsa da pay bırakıyoruz.
        max_tokens: 8000,
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
        source,
      }))
      .filter((w) => w.creator.length > 0)
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
