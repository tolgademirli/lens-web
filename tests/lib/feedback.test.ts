import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AXIS_TUNING_THRESHOLD,
  REASON_LABELS,
  SIGNAL_TYPE,
  SIGNAL_WEIGHT,
  confirmationText,
  fetchActiveFeedback,
  recordFeedback,
  retractFeedback,
  signalsUntilProfile,
} from "@/lib/feedback";
import type { DiscoveryFeedback, FeedbackDecision } from "@/lib/types";
import { fakeSupabase, type FakeSupabase } from "../helpers/fake-supabase";
import { useWebSupabase } from "../helpers/web-supabase";

vi.mock("@/lib/supabase", async () => (await import("../helpers/web-supabase")).supabaseModuleMock());

let fake: FakeSupabase;

const rows = (list: Partial<DiscoveryFeedback>[]) => list as DiscoveryFeedback[];

describe("karar sözlüğü", () => {
  it("üç sinyal tipi ASLA eşit işlenmez: rezonans 1×, zevk 3×, kalibrasyon 5×", () => {
    expect(SIGNAL_WEIGHT).toEqual({ resonance: 1, taste: 3, calibration: 5 });
  });

  it("her karar doğru sinyal tipine bağlıdır", () => {
    expect(SIGNAL_TYPE).toEqual({
      interested: "resonance",
      not_interested: "resonance",
      known_liked: "taste",
      known_disliked: "taste",
      known_neutral: "taste",
      hit: "calibration",
      partial: "calibration",
      miss: "calibration",
    });
  });

  it("eksen ayarı eşiği 5 ağırlıklı sinyaldir", () => {
    expect(AXIS_TUNING_THRESHOLD).toBe(5);
  });

  it("neden seçenekleri dört tanedir ve sırası kartın sırasıdır", () => {
    expect(REASON_LABELS.map((r) => r.value)).toEqual([
      "too_dark",
      "too_popular",
      "mood_mismatch",
      "genre_mismatch",
    ]);
  });
});

describe("confirmationText", () => {
  const decisions = Object.keys(SIGNAL_TYPE) as FeedbackDecision[];

  it.each(decisions)("'%s' için boş olmayan, tek satırlık bir onay verir", (decision) => {
    const text = confirmationText(decision);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("\n");
    // Kart genişliğinde kesilirse "geri al" bağlantısı erişilemez olur.
    expect(text.length).toBeLessThanOrEqual(40);
  });

  it("'ilgimi çekmedi' nedeni varsa onu tırnak içinde söyler", () => {
    expect(confirmationText("not_interested", "too_dark")).toBe('"Fazla karanlık" not alındı.');
    expect(confirmationText("not_interested", null)).toBe("Not alındı.");
    expect(confirmationText("not_interested")).toBe("Not alındı.");
  });

  it("'ilgimi çekti' listeye eklendiğini söyler", () => {
    expect(confirmationText("interested")).toBe("Listene eklendi.");
  });
});

describe("signalsUntilProfile", () => {
  it("ham ağırlıkları toplar ve eşiğe kalanı döner", () => {
    expect(signalsUntilProfile([])).toBe(5);
    expect(signalsUntilProfile(rows([{ decision: "interested", weight: 1 }]))).toBe(4);
    expect(
      signalsUntilProfile(rows([{ decision: "interested", weight: 1 }, { decision: "known_liked", weight: 3 }])),
    ).toBe(1);
  });

  it("eşik aşılınca 0'da kalır, eksiye düşmez", () => {
    expect(signalsUntilProfile(rows([{ decision: "hit", weight: 5 }, { decision: "miss", weight: 5 }]))).toBe(0);
  });

  it("'Kararsızım' eşiğe SAYILMAZ: kararsızlık yön bildirmez", () => {
    expect(signalsUntilProfile(rows([{ decision: "known_neutral", weight: 3 }]))).toBe(5);
    expect(
      signalsUntilProfile(rows([{ decision: "known_neutral", weight: 3 }, { decision: "known_disliked", weight: 3 }])),
    ).toBe(2);
  });
});

describe("RPC sarmalayıcıları", () => {
  const target = {
    workType: "film" as const,
    title: "Masumiyet",
    creator: "Zeki Demirkubuz",
    origin: "daily_discovery" as const,
    dailyDiscoveryId: "d1",
    slot: "film",
  };

  beforeEach(() => {
    fake = fakeSupabase({
      user: { id: "user-1" },
      rpcs: { record_feedback: { data: "feedback-1" }, retract_feedback: { data: null } },
      tables: { discovery_feedback: { data: [{ id: "f1" }] } },
    });
    useWebSupabase(fake.client);
  });

  it("recordFeedback kararı yollar, AĞIRLIK ve sinyal tipi YOLLAMAZ (sunucu türetir)", async () => {
    const id = await recordFeedback(target, "not_interested", "mood_mismatch");

    expect(id).toBe("feedback-1");
    expect(fake.callsTo("record_feedback")[0].args).toEqual({
      p_work_type: "film",
      p_title: "Masumiyet",
      p_creator: "Zeki Demirkubuz",
      p_decision: "not_interested",
      p_reason: "mood_mismatch",
      p_origin: "daily_discovery",
      p_daily_discovery_id: "d1",
      p_weekly_pick_id: null,
      p_slot: "film",
    });
  });

  it("recordFeedback hata olursa null döner (çağıran optimistic durumu geri alır)", async () => {
    fake = fakeSupabase({ rpcs: { record_feedback: { error: { message: "rls" } } } });
    useWebSupabase(fake.client);
    expect(await recordFeedback(target, "interested")).toBeNull();
  });

  it("retractFeedback satır id'sini yollar ve başarıyı döner", async () => {
    expect(await retractFeedback("feedback-1")).toBe(true);
    expect(fake.callsTo("retract_feedback")[0].args).toEqual({ p_feedback_id: "feedback-1" });

    fake = fakeSupabase({ rpcs: { retract_feedback: { error: { message: "x" } } } });
    useWebSupabase(fake.client);
    expect(await retractFeedback("feedback-1")).toBe(false);
  });

  it("fetchActiveFeedback yalnızca AŞILMAMIŞ (superseded_by IS NULL) satırları ister", async () => {
    expect(await fetchActiveFeedback()).toEqual([{ id: "f1" }]);
    const query = fake.callsTo("discovery_feedback")[0];
    expect(query.ops.find((op) => op.method === "is")?.args).toEqual(["superseded_by", null]);
    expect(query.ops.find((op) => op.method === "eq")?.args).toEqual(["user_id", "user-1"]);
  });

  it("fetchActiveFeedback oturum yoksa veritabanına gitmez", async () => {
    fake = fakeSupabase({ user: null });
    useWebSupabase(fake.client);
    expect(await fetchActiveFeedback()).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
