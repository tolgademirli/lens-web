import { beforeEach, describe, expect, it, vi } from "vitest";
import * as extract from "../../supabase/functions/extract-works/index.ts";
import { authedPost, claudeResponse, edgeHandler, internals, request, stubEdgeEnv } from "../helpers/edge";
import { resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";

const { buildSystemPrompt, TYPE_LABELS, OUTPUT_SCHEMA, MAX_IMAGES, MAX_WORKS, MAX_TEXT_CHARS, DAILY_EXTRACTIONS } =
  internals(extract);

describe("prompt ve şema", () => {
  it("üç kategori tanımlıdır; film kategorisi dizileri de kapsar", () => {
    expect(Object.keys(TYPE_LABELS)).toEqual(["book", "film", "song"]);
    expect(TYPE_LABELS.film.tekil).toBe("film ve dizi");
  });

  it.each([
    ["book", "kitap listesini", "YALNIZCA YAZAR"],
    ["film", "film ve dizi listesini", "YALNIZCA YÖNETMEN"],
    ["song", "müzik listesini", "YALNIZCA SANATÇI VEYA GRUP"],
  ])("%s prompt'u kategoriye özel kurulur", (type, task, heading) => {
    const prompt = buildSystemPrompt(type);
    expect(prompt).toContain(task);
    expect(prompt).toContain(heading);
    expect(prompt).toContain("ASLA UYDURMA");
    expect(prompt).not.toContain("undefined");
  });

  it("çıktı şeması dört alanı zorunlu tutar ve ek alana izin vermez", () => {
    const item = OUTPUT_SCHEMA.properties.works.items;
    expect(item.required).toEqual(["creator", "title", "confidence", "creator_inferred"]);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.confidence.enum).toEqual(["high", "medium", "low"]);
  });

  it("teknik tavanlar: 5 görsel, 50 eser, 10.000 karakter, günde 30 çıkarım", () => {
    expect({ MAX_IMAGES, MAX_WORKS, MAX_TEXT_CHARS, DAILY_EXTRACTIONS }).toEqual({
      MAX_IMAGES: 5,
      MAX_WORKS: 50,
      MAX_TEXT_CHARS: 10_000,
      DAILY_EXTRACTIONS: 30,
    });
  });
});

describe("handler", () => {
  const handler = edgeHandler();

  const work = (fields: Record<string, unknown> = {}) => ({
    creator: "Oğuz Atay",
    title: "Tutunamayanlar",
    confidence: "high",
    creator_inferred: false,
    ...fields,
  });
  const image = (fields: Record<string, unknown> = {}) => ({ media_type: "image/png", data: "aGk=", ...fields });

  function db(options: { user?: { id: string } | null; quota?: QueryResult } = {}) {
    const fake = fakeSupabase({
      user: options.user ?? null,
      rpcs: { bump_extraction_quota: options.quota ?? { data: 1 } },
    });
    useEdgeSupabase(fake.client);
    return fake;
  }

  function stubClaude(works: unknown[] | Response) {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      works instanceof Response ? works.clone() : claudeResponse(JSON.stringify({ works })),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const post = (body: unknown, headers: Record<string, string> = {}) => handler(request("POST", { body, headers }));

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv();
  });

  describe("girdi doğrulaması — Claude çağrılmadan reddedilir", () => {
    it.each([
      ["geçersiz kategori", { type: "podcast", text: "x" }, "Geçersiz kategori."],
      ["girdi yok", { type: "book" }, "Önce görsel ya da metin ekle."],
      ["yalnızca boşluk", { type: "book", text: "   " }, "Önce görsel ya da metin ekle."],
      [
        "6 görsel",
        { type: "book", images: Array.from({ length: 6 }, () => image()) },
        "Tek seferde en fazla 5 görsel yükleyebilirsin.",
      ],
      ["çok uzun metin", { type: "book", text: "a".repeat(10_001) }, "Yapıştırdığın metin çok uzun."],
      [
        "desteklenmeyen görsel tipi",
        { type: "book", images: [image({ media_type: "image/svg+xml" })] },
        "Yalnızca PNG, JPG, WEBP veya GIF yükleyebilirsin.",
      ],
      [
        "verisi string olmayan görsel",
        { type: "book", images: [image({ data: 42 })] },
        "Yalnızca PNG, JPG, WEBP veya GIF yükleyebilirsin.",
      ],
      [
        "10 MB'ı aşan görsel",
        { type: "book", images: [image({ data: "a".repeat(14_000_000) })] },
        "Görsel en fazla 10 MB olabilir.",
      ],
    ])("%s → 400", async (_label, body, message) => {
      db();
      const fetchMock = stubClaude([]);

      const res = await post(body);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("kimlik ve kota", () => {
    // Onboarding'de kullanıcı henüz giriş yapmamış oluyor.
    it("oturum ZORUNLU DEĞİL; kota anonimde IP'ye bakar", async () => {
      const fake = db();
      stubClaude([work()]);

      const res = await post({ type: "book", text: "Tutunamayanlar" }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

      expect(res.status).toBe(200);
      expect(fake.callsTo("bump_extraction_quota")[0].args).toMatchObject({ p_client_key: "203.0.113.7" });
    });

    it("oturum varsa kota kullanıcı id'sine bakar", async () => {
      const fake = db({ user: { id: "user-1" } });
      stubClaude([work()]);

      await handler(authedPost({ type: "book", text: "x" }, { "x-forwarded-for": "203.0.113.7" }));

      expect(fake.callsTo("bump_extraction_quota")[0].args).toMatchObject({ p_client_key: "user-1" });
    });

    it("kota günü İstanbul gününe göredir", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-10T22:30:00Z"));
      const fake = db();
      stubClaude([work()]);

      await post({ type: "book", text: "x" });

      expect(fake.callsTo("bump_extraction_quota")[0].args).toMatchObject({ p_date: "2026-10-11" });
    });

    it("günlük kota aşıldıysa 429 döner ve Claude'u çağırmaz", async () => {
      db({ quota: { data: 31 } });
      const fetchMock = stubClaude([work()]);

      const res = await post({ type: "book", text: "x" });

      expect(res.status).toBe(429);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tam sınırdaki (30.) istek geçer", async () => {
      db({ quota: { data: 30 } });
      stubClaude([work()]);
      expect((await post({ type: "book", text: "x" })).status).toBe(200);
    });

    // Kota altyapısı bir aksaklık yüzünden ürünü durdurmamalı.
    it("kota sorgusu patlarsa istek ENGELLENMEZ (fail-open)", async () => {
      db({ quota: { error: { message: "relation does not exist" } } });
      stubClaude([work()]);
      expect((await post({ type: "book", text: "x" })).status).toBe(200);
    });
  });

  // Aydınlatma Metni: "Ekran görüntüleri ve yapıştırdığın metin: saklanmaz."
  it("yüklenen metin ve görsel hiçbir yere YAZILMAZ: veritabanına yalnızca kota sayacı için gidilir", async () => {
    const fake = db({ user: { id: "user-1" } });
    stubClaude([work()]);

    const res = await handler(authedPost({ type: "book", text: "gizli liste satırı", images: [image({ data: "R0lGODlhgizli" })] }));

    expect(res.status).toBe(200);
    expect(fake.calls.map((call) => [call.kind, call.name])).toEqual([["rpc", "bump_extraction_quota"]]);
    expect(fake.client.from).not.toHaveBeenCalled();
    const quota = JSON.stringify(fake.calls[0].args);
    expect(quota).not.toContain("gizli liste satırı");
    expect(quota).not.toContain("R0lGODlhgizli");
  });

  describe("çıktının işlenmesi", () => {
    async function extractWith(works: unknown[], body: Record<string, unknown> = { type: "book", text: "liste" }) {
      db();
      stubClaude(works);
      const res = await post(body);
      return { status: res.status, ...(await res.json()) } as { status: number; works: any[]; batch_id: string };
    }

    it("eserleri kırpar, edinim yolunu ekler ve batch id üretir", async () => {
      const out = await extractWith([work({ creator: " Oğuz Atay ", title: " Tutunamayanlar " })]);

      expect(out.status).toBe(200);
      expect(out.works).toEqual([
        { creator: "Oğuz Atay", title: "Tutunamayanlar", confidence: "high", creator_inferred: false, source: "paste" },
      ]);
      expect(out.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("edinim yolu: yalnızca metin → 'paste'; görsel varsa → 'screenshot'", async () => {
      expect((await extractWith([work()], { type: "book", text: "liste" })).works[0].source).toBe("paste");
      expect((await extractWith([work()], { type: "book", images: [image()] })).works[0].source).toBe("screenshot");
      expect((await extractWith([work()], { type: "book", images: [image()], text: "not" })).works[0].source).toBe(
        "screenshot",
      );
    });

    // Model bir kez uydurulmuş yazarı "okudum" diye işaretledi (Bozkırkurdu → "Yaşar Kemal").
    it("DÜŞÜK güvenli okumada yazar adı GEÇMEZ; eser adı korunur", async () => {
      const out = await extractWith([
        work({ title: "Bozkırkurdu", creator: "Yaşar Kemal", confidence: "low", creator_inferred: true }),
        work({ title: "Uzak", creator: "Nuri Bilge Ceylan", confidence: "medium", creator_inferred: true }),
      ]);

      expect(out.works[0]).toMatchObject({ title: "Bozkırkurdu", creator: "", creator_inferred: false, confidence: "low" });
      expect(out.works[1]).toMatchObject({ creator: "Nuri Bilge Ceylan", creator_inferred: true });
    });

    it("düşük güvenli ama YALNIZCA yaratıcı taşıyan satır silinmez", async () => {
      const out = await extractWith([work({ title: "", creator: "Kafka", confidence: "low" })]);
      expect(out.works[0]).toMatchObject({ title: "", creator: "Kafka" });
    });

    it("yaratıcısı boş satır KALIR; yalnızca tamamen boş ve bozuk satırlar elenir", async () => {
      const out = await extractWith([work({ creator: "" }), work({ creator: " ", title: " " }), null, "metin"]);
      expect(out.works).toHaveLength(1);
      expect(out.works[0]).toMatchObject({ title: "Tutunamayanlar", creator: "" });
    });

    it("creator_inferred yalnızca TAM `true` ise true'dur", async () => {
      const out = await extractWith([work({ creator_inferred: "true" }), work({ title: "B", creator_inferred: true })]);
      expect(out.works.map((w) => w.creator_inferred)).toEqual([false, true]);
    });

    it("en çok 50 eser döner", async () => {
      const out = await extractWith(Array.from({ length: 80 }, (_, i) => work({ title: `Eser ${i}` })));
      expect(out.works).toHaveLength(50);
    });

    // Boş dönmek doğru davranıştır; istemci guardrail ekranını gösterir.
    it("eser bulunamazsa 200 + boş liste döner", async () => {
      const out = await extractWith([]);
      expect(out.status).toBe(200);
      expect(out.works).toEqual([]);
    });
  });

  describe("Claude yanıt biçimleri", () => {
    it("model reddederse boş liste döner (hata değil)", async () => {
      db();
      stubClaude(claudeResponse("", { stop_reason: "refusal" }));
      const res = await post({ type: "book", images: [image()] });
      expect(res.status).toBe(200);
      expect((await res.json()).works).toEqual([]);
    });

    it("çıktı max_tokens'a takılırsa kullanıcıya anlaşılır bir 400 döner", async () => {
      db();
      stubClaude(claudeResponse('{"works":[{"creator":"Oğ', { stop_reason: "max_tokens" }));
      const res = await post({ type: "book", images: [image()] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Liste çok uzun geldi");
    });

    it("bozuk JSON ve Claude HTTP hatası 500 döner", async () => {
      db();
      stubClaude(claudeResponse("eser yok"));
      expect((await post({ type: "book", text: "x" })).status).toBe(500);

      stubClaude(new Response("overloaded", { status: 529 }));
      expect((await post({ type: "book", text: "x" })).status).toBe(500);
    });

    it("görselleri Claude içerik bloklarına çevirir, görevi sonuna ekler", async () => {
      db();
      const fetchMock = stubClaude([work()]);

      await post({ type: "film", images: [image(), image({ media_type: "image/jpeg" })] });

      const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
      expect(body.messages[0].content.map((block: any) => block.type)).toEqual(["image", "image", "text"]);
      expect(body.messages[0].content[1].source).toEqual({ type: "base64", media_type: "image/jpeg", data: "aGk=" });
      expect(body.messages[0].content[2].text).toBe("Bu görsel(ler)den film ve dizi listesini çıkar.");
      expect(body.system).toBe(buildSystemPrompt("film"));
      expect(body.output_config.format.type).toBe("json_schema");
    });

    it("yapıştırılan metni göreve ekler", async () => {
      db();
      const fetchMock = stubClaude([work()]);
      await post({ type: "song", text: "  Adamlar\nBLOK3  " });
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "Aşağıdaki metinden müzik listesini çıkar:\n\nAdamlar\nBLOK3" },
      ]);
    });
  });

  it("OPTIONS'a CORS ile yanıt verir", async () => {
    expect((await handler(request("OPTIONS"))).status).toBe(200);
  });
});
