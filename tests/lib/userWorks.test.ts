import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLibraryStash, stashLibraryWorks } from "@/lib/pendingLibrary";
import { flushLibraryStash, saveWorksToLibrary, type LibraryWork } from "@/lib/userWorks";
import { fakeSupabase, type QueryCall, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

const work = (title: string, selected: boolean): LibraryWork => ({
  title: ` ${title} `,
  creator: " Yazar ",
  source: "screenshot",
  selected,
});

function setup(
  upsert: QueryResult | ((call: QueryCall) => QueryResult),
  user: { id: string } | null = { id: "user-1" },
) {
  const fake = fakeSupabase({ user, rpcs: { upsert_user_works: upsert } });
  useWebSupabase(fake.client);
  return fake;
}

beforeEach(() => {
  localStorage.clear();
});

describe("saveWorksToLibrary", () => {
  it("boş listede hiçbir şey yapmaz", async () => {
    const fake = setup({ data: [] });
    expect(await saveWorksToLibrary("book", [], "batch-1")).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("rapora seçilmeyenler DAHİL hepsini havuza yazar, yalnızca seçilenlerin id'sini döner", async () => {
    const fake = setup({ data: ["id-a", "id-b", "id-c"] });

    const ids = await saveWorksToLibrary("book", [work("A", true), work("B", false), work("C", true)], "batch-1");

    expect(ids).toEqual(["id-a", "id-c"]);
    const args = fake.callsTo("upsert_user_works")[0].args as Record<string, any>;
    expect(args.p_type).toBe("book");
    expect(args.p_batch_id).toBe("batch-1");
    expect(args.p_works).toEqual([
      { creator: "Yazar", title: "A", source: "screenshot", confidence: null },
      { creator: "Yazar", title: "B", source: "screenshot", confidence: null },
      { creator: "Yazar", title: "C", source: "screenshot", confidence: null },
    ]);
  });

  // Fonksiyon auth.uid() kullanır; parametreyle gitseydi başkasının kütüphanesine yazılabilirdi.
  it("RPC'ye user_id GÖNDERMEZ", async () => {
    const fake = setup({ data: ["id-a"] });
    await saveWorksToLibrary("film", [work("A", true)], "batch-1");
    expect(Object.keys(fake.callsTo("upsert_user_works")[0].args as object).sort()).toEqual([
      "p_batch_id",
      "p_type",
      "p_works",
    ]);
  });

  it("oturum yoksa zulaya saklar ve seçilen başına boş id döner", async () => {
    const fake = setup({ data: [] }, null);

    const ids = await saveWorksToLibrary("song", [work("A", true), work("B", false)], "batch-1");

    expect(ids).toEqual([""]);
    expect(fake.callsTo("upsert_user_works")).toHaveLength(0);
    expect(readLibraryStash()?.song?.[0]).toMatchObject({ batchId: "batch-1" });
    expect(readLibraryStash()?.song?.[0].works).toHaveLength(2);
  });

  it("yazılamazsa KAYBETMEZ: zulaya saklar, girişten sonraki flush tekrar dener", async () => {
    setup({ error: { message: "network" } });
    const ids = await saveWorksToLibrary("book", [work("A", true)], "batch-1");
    expect(ids).toEqual([""]);
    expect(readLibraryStash()?.book).toHaveLength(1);
  });
});

describe("flushLibraryStash", () => {
  const empty = { book: [], film: [], song: [] };

  it("zula yoksa boş döner ve veritabanına gitmez", async () => {
    const fake = setup({ data: [] });
    expect(await flushLibraryStash()).toEqual(empty);
    expect(fake.callsTo("upsert_user_works")).toHaveLength(0);
  });

  it("oturum yoksa zulaya dokunmaz", async () => {
    stashLibraryWorks("book", "batch-1", [work("A", true)]);
    setup({ data: ["x"] }, null);
    expect(await flushLibraryStash()).toEqual(empty);
    expect(readLibraryStash()).not.toBeNull();
  });

  it("tür ve batch sırasıyla yazar, seçilenlerin id'lerini döner ve zulayı temizler", async () => {
    stashLibraryWorks("book", "batch-1", [work("A", true), work("B", false)]);
    stashLibraryWorks("book", "batch-2", [work("C", true)]);
    stashLibraryWorks("song", "batch-3", [work("D", true)]);
    const fake = setup((call) => {
      const args = call.args as { p_batch_id: string; p_works: unknown[] };
      return { data: args.p_works.map((_, i) => `${args.p_batch_id}-${i}`) };
    });

    expect(await flushLibraryStash()).toEqual({
      book: ["batch-1-0", "batch-2-0"],
      film: [],
      song: ["batch-3-0"],
    });
    expect(fake.callsTo("upsert_user_works").map((c) => (c.args as any).p_batch_id)).toEqual([
      "batch-1",
      "batch-2",
      "batch-3",
    ]);
    expect(readLibraryStash()).toBeNull();
  });

  it("bir batch bile yazılamazsa zula KALIR (sonraki deneme tekrar dener)", async () => {
    stashLibraryWorks("book", "batch-1", [work("A", true)]);
    stashLibraryWorks("film", "batch-2", [work("B", true)]);
    setup((call) =>
      (call.args as any).p_batch_id === "batch-2" ? { error: { message: "x" } } : { data: ["ok-1"] },
    );

    expect(await flushLibraryStash()).toEqual({ book: ["ok-1"], film: [], song: [] });
    expect(readLibraryStash()).not.toBeNull();
  });
});
