import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "@/lib/account";
import { ExtractError, extractWorks, fileToBase64 } from "@/lib/extractWorks";
import { readLibraryStash, stashLibraryWorks } from "@/lib/pendingLibrary";
import { readPendingReport, writePendingReport } from "@/lib/pendingReport";
import { emptyDraft, readSessionDraft, writeSessionDraft } from "@/lib/tasteDraft";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

const draft = {
  ...emptyDraft(),
  books: [{ title: "Tutunamayanlar", creator: "Oğuz Atay", source: "manual" as const, workId: "" }],
};

function setup(functions: Record<string, QueryResult>) {
  const fake = fakeSupabase({ user: { id: "user-1" }, functions });
  useWebSupabase(fake.client);
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("deleteAccount", () => {
  function leaveTraces() {
    writeSessionDraft(draft);
    writePendingReport(draft);
    stashLibraryWorks("book", "batch-1", [{ title: "A", creator: "B", source: "paste", selected: true }]);
  }

  it("başarıda bu cihazdaki izleri de temizler: oturum + yarım taslaklar", async () => {
    const fake = setup({ "delete-account": { data: { success: true } } });
    leaveTraces();

    expect(await deleteAccount()).toBe(true);

    expect(fake.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(readSessionDraft()).toEqual(emptyDraft());
    expect(readPendingReport()).toBeNull();
    expect(readLibraryStash()).toBeNull();
  });

  // Kimin silineceği yalnızca JWT'den okunur.
  it("fonksiyonu GÖVDESİZ çağırır — silinecek kullanıcıyı parametreyle söylemez", async () => {
    const fake = setup({ "delete-account": { data: { success: true } } });
    await deleteAccount();
    expect(fake.callsTo("delete-account")[0].args).toEqual({ method: "POST" });
  });

  it("silme başarısızsa oturum da taslaklar da YERİNDE kalır", async () => {
    const fake = setup({ "delete-account": { error: { message: "500" } } });
    leaveTraces();

    expect(await deleteAccount()).toBe(false);

    expect(fake.client.auth.signOut).not.toHaveBeenCalled();
    expect(readSessionDraft().books).toHaveLength(1);
    expect(readPendingReport()).not.toBeNull();
    expect(readLibraryStash()).not.toBeNull();
  });
});

describe("extractWorks", () => {
  it("eserleri ve batch id'sini döner; eksik alanlarda boş değerlere düşer", async () => {
    const works = [{ title: "Uzak", creator: "Nuri Bilge Ceylan", confidence: "high" }];
    const fake = setup({ "extract-works": { data: { works, batch_id: "batch-1" } } });

    expect(await extractWorks({ type: "film", text: "Uzak - Nuri Bilge Ceylan" })).toEqual({
      works,
      batch_id: "batch-1",
    });
    expect(fake.callsTo("extract-works")[0].args).toEqual({
      body: { type: "film", text: "Uzak - Nuri Bilge Ceylan" },
    });

    setup({ "extract-works": { data: null } });
    expect(await extractWorks({ type: "film", text: "x" })).toEqual({ works: [], batch_id: "" });
  });

  it("edge function'ın döndürdüğü mesajı ve durumu ExtractError'a taşır", async () => {
    const context = new Response(JSON.stringify({ error: "Bugünlük çıkarım limitine ulaştın." }), { status: 429 });
    setup({ "extract-works": { error: { context } } });

    const failure = await extractWorks({ type: "book", text: "x" }).catch((err) => err);

    expect(failure).toBeInstanceOf(ExtractError);
    expect(failure.status).toBe(429);
    expect(failure.message).toBe("Bugünlük çıkarım limitine ulaştın.");
  });

  it("gövdesi okunamayan hatada jenerik mesaj ve 500 kullanır", async () => {
    setup({ "extract-works": { error: { message: "fetch failed" } } });
    const failure = await extractWorks({ type: "book", text: "x" }).catch((err) => err);
    expect(failure).toBeInstanceOf(ExtractError);
    expect(failure.status).toBe(500);
    expect(failure.message).toBe("Bir hata oluştu. Lütfen tekrar deneyin.");
  });
});

describe("fileToBase64", () => {
  it("data URI ön ekini atar, ham base64 ve dosya tipini döner", async () => {
    const file = new File([new Uint8Array([104, 105])], "raf.png", { type: "image/png" });
    expect(await fileToBase64(file)).toEqual({ media_type: "image/png", data: "aGk=" });
  });

  it("dosya okunamazsa Türkçe bir hatayla reddeder", async () => {
    class BrokenReader {
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("FileReader", BrokenReader);

    await expect(fileToBase64(new File(["x"], "raf.png"))).rejects.toThrow("Dosya okunamadı.");
  });
});
