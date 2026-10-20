import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "../../supabase/functions/_shared/unsubscribe.ts";
import "../../supabase/functions/unsubscribe/index.ts";
import { edgeHandler, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";

const SECRET = "test-unsubscribe-secret";
const USER = "8d1f6c1e-0000-4000-8000-000000000001";

describe("kapatma token'ı (HMAC)", () => {
  it("SHA-256'nın base64url'üdür: 43 karakter, dolgusuz", async () => {
    const token = await unsubscribeToken(USER, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  // İmzalanan düzlem değişirse yayına çıkmış HER linkteki token geçersizleşir.
  it("`weekly_picks:<user_id>` düzlemini imzalar — gönderilmiş linkler buna bağlı", async () => {
    const expected = createHmac("sha256", SECRET).update(`weekly_picks:${USER}`).digest("base64url");
    expect(await unsubscribeToken(USER, SECRET)).toBe(expected);
  });

  it("SÜRESİZ ve deterministiktir: aynı girdi hep aynı token", async () => {
    expect(await unsubscribeToken(USER, SECRET)).toBe(await unsubscribeToken(USER, SECRET));
  });

  it("kullanıcıya ve sırra özeldir", async () => {
    const token = await unsubscribeToken(USER, SECRET);
    expect(await unsubscribeToken("baska-kullanici", SECRET)).not.toBe(token);
    expect(await unsubscribeToken(USER, "baska-sir")).not.toBe(token);
  });
});

describe("verifyUnsubscribeToken", () => {
  it("geçerli token'ı kabul eder", async () => {
    expect(await verifyUnsubscribeToken(USER, await unsubscribeToken(USER, SECRET), SECRET)).toBe(true);
  });

  it("başkasının token'ı, yanlış sır, kurcalanmış ya da kırpılmış token reddedilir", async () => {
    const token = await unsubscribeToken(USER, SECRET);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);

    expect(await verifyUnsubscribeToken("baska-kullanici", token, SECRET)).toBe(false);
    expect(await verifyUnsubscribeToken(USER, token, "baska-sir")).toBe(false);
    expect(await verifyUnsubscribeToken(USER, tampered, SECRET)).toBe(false);
    expect(await verifyUnsubscribeToken(USER, token.slice(0, -1), SECRET)).toBe(false);
    expect(await verifyUnsubscribeToken(USER, `${token}x`, SECRET)).toBe(false);
  });

  it("boş kullanıcı ya da boş token reddedilir", async () => {
    const token = await unsubscribeToken(USER, SECRET);
    expect(await verifyUnsubscribeToken("", token, SECRET)).toBe(false);
    expect(await verifyUnsubscribeToken(USER, "", SECRET)).toBe(false);
    // Boş kullanıcı için üretilmiş token bile geçmez.
    expect(await verifyUnsubscribeToken("", await unsubscribeToken("", SECRET), SECRET)).toBe(false);
  });
});

describe("unsubscribeUrl", () => {
  it("functions kökünün altındaki `unsubscribe` endpoint'ine bakar", async () => {
    const token = await unsubscribeToken(USER, SECRET);
    expect(await unsubscribeUrl("http://supabase.test/functions/v1", USER, SECRET)).toBe(
      `http://supabase.test/functions/v1/unsubscribe?u=${USER}&t=${token}`,
    );
  });

  it("sondaki eğik çizgiyi çiftlemez, kullanıcı id'sini kodlar", async () => {
    const url = await unsubscribeUrl("http://supabase.test/functions/v1/", "a b&c", SECRET);
    expect(url).toContain("/functions/v1/unsubscribe?u=a%20b%26c&t=");
  });
});

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

describe("handler — oturumsuz, tek dokunuşla kapatma", () => {
  const handler = edgeHandler();
  let token: string;

  const link = (user = USER, t = token) => `http://edge.test/unsubscribe?u=${user}&t=${t}`;

  function db(result: QueryResult = { data: null }) {
    const fake = fakeSupabase({ tables: { user_preferences: result } });
    useEdgeSupabase(fake.client);
    return fake;
  }

  beforeEach(async () => {
    resetEdgeSupabase();
    stubEdgeEnv({ UNSUBSCRIBE_SECRET: SECRET });
    token = await unsubscribeToken(USER, SECRET);
  });

  it("geçerli linkte tercihi kapatır ve Türkçe onay sayfası döner", async () => {
    const fake = db();
    const res = await handler(request("GET", { url: link() }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("Kapattım.");
    expect(fake.callsTo("user_preferences")).toHaveLength(1);
  });

  // `plan` payload'a girerse service_role trigger'ın kilidini aşar.
  it("YALNIZCA iki kolon yazar: user_id ve weekly_picks_enabled=false", async () => {
    const fake = db();
    await handler(request("GET", { url: link() }));

    const query = fake.callsTo("user_preferences")[0];
    expect(query.arg("upsert", 0)).toEqual({ user_id: USER, weekly_picks_enabled: false });
    expect(query.arg("upsert", 1)).toEqual({ onConflict: "user_id" });
  });

  it("One-Click POST (RFC 8058) gövdesiz 200 döner", async () => {
    const fake = db();
    const res = await handler(request("POST", { url: link(), body: "List-Unsubscribe=One-Click" }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(fake.callsTo("user_preferences")).toHaveLength(1);
  });

  // Sıra tersine dönerse geçersiz token 403 alır ama satır yine değişir.
  it.each([
    ["kurcalanmış token", () => link(USER, "x".repeat(43))],
    ["başka kullanıcının token'ı", () => link("baska-kullanici", token)],
    ["token yok", () => `http://edge.test/unsubscribe?u=${USER}`],
    ["kullanıcı yok", () => `http://edge.test/unsubscribe?t=${token}`],
    ["parametresiz", () => "http://edge.test/unsubscribe"],
  ])("%s → 403 ve veritabanına HİÇ gidilmez", async (_label, url) => {
    const get = await handler(request("GET", { url: url() }));
    expect(get.status).toBe(403);
    expect(await get.text()).toContain("Bu bağlantı geçerli değil");

    const post = await handler(request("POST", { url: url() }));
    expect(post.status).toBe(403);
    expect(await post.text()).toBe("");

    expect(createClientCalls).toHaveLength(0);
  });

  it("yazılamazsa 500 döner (mail istemcisi tekrar dener; işlem fikirdeş)", async () => {
    db({ error: { message: "db down" } });

    const get = await handler(request("GET", { url: link() }));
    expect(get.status).toBe(500);
    expect(await get.text()).toContain("Şu an kapatamadım");

    const post = await handler(request("POST", { url: link() }));
    expect(post.status).toBe(500);
  });

  it("sır tanımlı değilse 500 döner ve hiçbir şey yazmaz", async () => {
    stubEdgeEnv({ UNSUBSCRIBE_SECRET: "" });
    const res = await handler(request("GET", { url: link() }));
    expect(res.status).toBe(500);
    expect(createClientCalls).toHaveLength(0);
  });

  it.each(["PUT", "DELETE", "PATCH"])("%s yöntemi 405 alır", async (method) => {
    const res = await handler(request(method, { url: link() }));
    expect(res.status).toBe(405);
    expect(createClientCalls).toHaveLength(0);
  });

  it("OPTIONS'a CORS ile yanıt verir", async () => {
    const res = await handler(request("OPTIONS", { url: link() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("sayfa arama motorlarına kapalıdır ve siteye dönüş linki SITE_URL'den gelir", async () => {
    db();
    stubEdgeEnv({ UNSUBSCRIBE_SECRET: SECRET, SITE_URL: "https://lens.example/" });
    const html = await (await handler(request("GET", { url: link() }))).text();

    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<a href="https://lens.example"');
  });
});
