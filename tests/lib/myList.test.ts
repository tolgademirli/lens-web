import { describe, expect, it, vi } from "vitest";
import {
  COMPLETED_BANNER_MIN,
  COMPLETION_VERB,
  HIT_LABEL,
  completeListItem,
  completedThisYear,
  fetchListItems,
  removeListItem,
} from "@/lib/myList";
import type { ListItem } from "@/lib/types";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

const item = (fields: Partial<ListItem>) =>
  ({
    id: "item-1",
    work_type: "film",
    work_title: "Masumiyet",
    work_creator: "Zeki Demirkubuz",
    added_from: "daily_discovery",
    daily_discovery_id: "d1",
    weekly_pick_id: null,
    slot: "film",
    status: "pending",
    ...fields,
  }) as ListItem;

function setup(listResult: QueryResult = { data: null }, user: { id: string } | null = { id: "user-1" }) {
  const fake = fakeSupabase({
    user,
    tables: { list_items: listResult },
    rpcs: { record_feedback: { data: "feedback-1" } },
  });
  useWebSupabase(fake.client);
  return fake;
}

describe("sabitler", () => {
  it("tamamlama fiili türe göre değişir", () => {
    expect(COMPLETION_VERB).toEqual({ book: "Okudum", film: "İzledim", song: "Dinledim" });
  });

  it("isabet rozetleri", () => {
    expect(HIT_LABEL).toEqual({ hit: "İsabetliydi", partial: "Kısmen", miss: "İsabetsizdi" });
  });

  it("'bu yıl N eser bitirdin' bandı 3'ün altında gizlenir", () => {
    expect(COMPLETED_BANNER_MIN).toBe(3);
  });
});

describe("completedThisYear", () => {
  it("yalnızca bu takvim yılında TAMAMLANANLARI sayar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));

    const items = [
      item({ status: "completed", completed_at: "2026-03-01T10:00:00Z" }),
      item({ status: "completed", completed_at: "2026-10-10T10:00:00Z" }),
      item({ status: "completed", completed_at: "2025-06-15T10:00:00Z" }),
      item({ status: "pending", completed_at: null }),
      item({ status: "completed", completed_at: null }),
    ];
    expect(completedThisYear(items)).toBe(2);
    expect(completedThisYear([])).toBe(0);
  });
});

describe("fetchListItems", () => {
  it("yalnızca çıkarılmamış (removed_at IS NULL) öğeleri ister", async () => {
    const fake = setup({ data: [item({})] });
    expect(await fetchListItems()).toHaveLength(1);
    const query = fake.callsTo("list_items")[0];
    expect(query.ops.find((op) => op.method === "is")?.args).toEqual(["removed_at", null]);
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["user_id", "user-1"]);
  });

  it("oturum yoksa ya da okuma hatasında boş döner", async () => {
    const anon = setup({ data: [item({})] }, null);
    expect(await fetchListItems()).toEqual([]);
    expect(anon.calls).toHaveLength(0);

    setup({ error: { message: "x" } });
    expect(await fetchListItems()).toEqual([]);
  });
});

describe("completeListItem", () => {
  it("öğeyi SİLMEZ: 'completed' yapar ve isabet sonucunu rozet olarak yazar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const fake = setup();

    expect(await completeListItem(item({}), "partial")).toBe(true);

    const query = fake.callsTo("list_items")[0];
    expect(query.has("delete")).toBe(false);
    expect(query.arg("update")).toEqual({
      status: "completed",
      hit_result: "partial",
      completed_at: "2026-10-11T12:00:00.000Z",
    });
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["id", "item-1"]);
  });

  it("kalibrasyon sinyalini öğenin kendi kaynağıyla deftere yazar", async () => {
    const fake = setup();
    await completeListItem(item({ weekly_pick_id: "w1", daily_discovery_id: null, slot: "2", added_from: "weekly_pick" }), "hit");

    expect(fake.callsTo("record_feedback")[0].args).toMatchObject({
      p_work_type: "film",
      p_title: "Masumiyet",
      p_creator: "Zeki Demirkubuz",
      p_decision: "hit",
      p_origin: "weekly_pick",
      p_weekly_pick_id: "w1",
      p_daily_discovery_id: null,
      p_slot: "2",
    });
  });

  it("yaratıcısı/adı NULL olan öğede boş string yollar", async () => {
    const fake = setup();
    await completeListItem(item({ work_title: null, work_creator: null } as never), "miss");
    expect(fake.callsTo("record_feedback")[0].args).toMatchObject({ p_title: "", p_creator: "" });
  });

  it("güncelleme başarısızsa sinyal YAZILMAZ ve false döner", async () => {
    const fake = setup({ error: { message: "rls" } });
    expect(await completeListItem(item({}), "hit")).toBe(false);
    expect(fake.callsTo("record_feedback")).toHaveLength(0);
  });
});

describe("removeListItem", () => {
  // Satır silinseydi eser tekrar önerilebilir hale gelirdi.
  it("SOFT delete: removed_at damgalar, satırı silmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const fake = setup();

    expect(await removeListItem("item-9")).toBe(true);

    const query = fake.callsTo("list_items")[0];
    expect(query.has("delete")).toBe(false);
    expect(query.arg("update")).toEqual({ removed_at: "2026-10-11T12:00:00.000Z" });
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["id", "item-9"]);
  });

  it("hata olursa false döner", async () => {
    setup({ error: { message: "x" } });
    expect(await removeListItem("item-9")).toBe(false);
  });
});
