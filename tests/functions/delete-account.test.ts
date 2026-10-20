import { beforeEach, describe, expect, it } from "vitest";
import "../../supabase/functions/delete-account/index.ts";
import { authedPost, edgeHandler, request, stubEdgeEnv } from "../helpers/edge";
import { createClientCalls, resetEdgeSupabase, useEdgeSupabase } from "../helpers/edge-supabase";
import { fakeSupabase } from "../helpers/fake-supabase";

describe("delete-account handler", () => {
  const handler = edgeHandler();
  const user = { id: "user-1", email: "silinecek@example.com" };

  beforeEach(() => {
    resetEdgeSupabase();
    stubEdgeEnv();
  });

  it("JWT'deki kullanıcıyı siler", async () => {
    const fake = fakeSupabase({ user });
    useEdgeSupabase(fake.client);

    const res = await handler(authedPost(undefined));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(fake.client.auth.getUser).toHaveBeenCalledWith("test-jwt");
    expect(fake.client.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  // Parametreyle user_id kabul etmek, oturumu olan herkese başkasını silme yolu açardı.
  it("gövdedeki user_id'yi YOK SAYAR — yalnızca JWT'nin sahibini siler", async () => {
    const fake = fakeSupabase({ user });
    useEdgeSupabase(fake.client);

    await handler(authedPost({ user_id: "kurban", userId: "kurban", id: "kurban" }));

    expect(fake.client.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  // Veri CASCADE + trigger ile gider; ikinci bir liste ilk yeni tabloda eskir.
  it("tablo tablo DELETE yazmaz: veritabanına auth dışında hiç dokunmaz", async () => {
    const fake = fakeSupabase({ user });
    useEdgeSupabase(fake.client);

    await handler(authedPost(undefined));

    expect(fake.client.from).not.toHaveBeenCalled();
    expect(fake.client.rpc).not.toHaveBeenCalled();
  });

  it("Authorization yoksa 401 döner ve istemci bile kurmaz", async () => {
    const res = await handler(request("POST"));
    expect(res.status).toBe(401);
    expect(createClientCalls).toHaveLength(0);
  });

  it("geçersiz oturumda 401 döner ve KİMSEYİ silmez", async () => {
    const fake = fakeSupabase({ user: null });
    useEdgeSupabase(fake.client);

    const res = await handler(authedPost(undefined));

    expect(res.status).toBe(401);
    expect(fake.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it.each(["GET", "DELETE", "PUT"])("%s yöntemi 405 alır ve kimseyi silmez", async (method) => {
    const fake = fakeSupabase({ user });
    useEdgeSupabase(fake.client);

    const res = await handler(request(method, { headers: { Authorization: "Bearer test-jwt" } }));

    expect(res.status).toBe(405);
    expect(fake.client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("silme başarısızsa 500 döner", async () => {
    const fake = fakeSupabase({ user });
    fake.client.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: { message: "fk violation" } });
    useEdgeSupabase(fake.client);

    const res = await handler(authedPost(undefined));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Hesabın silinemedi. Lütfen tekrar dene.");
  });

  // Silinmek isteyen birinin adresini log deposuna yazmak, talebin tersini yapmaktır.
  it("loglara e-posta YAZMAZ — başarıda da hatada da yalnızca kullanıcı id'si", async () => {
    const ok = fakeSupabase({ user });
    useEdgeSupabase(ok.client);
    await handler(authedPost(undefined));

    const failing = fakeSupabase({ user });
    failing.client.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: { message: "x" } });
    useEdgeSupabase(failing.client);
    await handler(authedPost(undefined));

    const logged = JSON.stringify([
      ...(console.log as any).mock.calls,
      ...(console.error as any).mock.calls,
    ]);
    expect(logged).toContain("user-1");
    expect(logged).not.toContain("silinecek@example.com");
  });

  it("OPTIONS'a CORS ile yanıt verir", async () => {
    const res = await handler(request("OPTIONS"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
