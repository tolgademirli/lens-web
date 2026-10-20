import { describe, expect, it } from "vitest";
import * as analyze from "../../supabase/functions/analyze/index.ts";
import * as daily from "../../supabase/functions/daily-discovery/index.ts";
import * as generate from "../../supabase/functions/generate-weekly-picks/index.ts";
import * as weeklyPrompt from "../../supabase/functions/generate-weekly-picks/prompt.ts";
import * as send from "../../supabase/functions/send-weekly-picks/index.ts";
import { renderWeeklyPicksEmail } from "../../supabase/functions/send-weekly-picks/email.ts";
import { SENSITIVE_INFERENCE_RULE } from "../../supabase/functions/_shared/sensitive.ts";
import { MAX_ENTRIES_PER_CATEGORY, MIN_TOTAL_ENTRIES } from "../../src/lib/formLimits";
import { normalizeEntries } from "../../src/lib/tasteDraft";
import { internals } from "../helpers/edge";

/**
 * ELLE SENKRON tutulan kopyalar. Edge function'lar ayrı Deno bundle'ları olduğu için
 * `src/`'ten ve birbirlerinden import edemiyor; aynı sayı/kural iki-üç yerde duruyor.
 * Biri değişip öbürü unutulursa hiçbir derleyici yakalamaz — bu dosya yakalar.
 */

describe("form sınırları: src/lib/formLimits.ts ↔ analyze", () => {
  it("toplam eşik ve kategori tavanı iki tarafta aynıdır", () => {
    const { MIN_TOTAL, MAX_ITEMS } = internals(analyze);
    expect(MIN_TOTAL).toBe(MIN_TOTAL_ENTRIES);
    expect(MAX_ITEMS).toBe(MAX_ENTRIES_PER_CATEGORY);
  });
});

describe("edinim yolu sözlüğü: tasteDraft ↔ analyze ↔ user_works.source", () => {
  const { VALID_SOURCES, normalizeCategory } = internals(analyze);

  it("sözlük dört değerdir; şemsiye bir 'import' değeri YOK", () => {
    expect([...VALID_SOURCES].sort()).toEqual(["form", "manual", "paste", "screenshot"]);
  });

  it("istemcinin kabul ettiği her değeri sunucu da kabul eder — ve tersi", () => {
    for (const source of VALID_SOURCES) {
      expect(normalizeEntries([{ title: "A", creator: "", source }])[0].source).toBe(source);
      expect(normalizeCategory([{ title: "A", creator: "", source }])[0].source).toBe(source);
    }
    for (const unknown of ["import", "ocr", ""]) {
      expect(normalizeEntries([{ title: "A", creator: "", source: unknown }])[0].source).toBe("form");
      expect(normalizeCategory([{ title: "A", creator: "", source: unknown }])[0].source).toBe("form");
    }
  });
});

describe("yasak liste kırpması: daily-discovery ↔ generate-weekly-picks", () => {
  const dailyTrim = internals(daily).trimBlocked;

  const films = (why: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      work_key: `${why}-${i}`,
      work_type: "film",
      work_creator: "Y",
      work_title: `${why} ${i}`,
      why,
    }));

  it.each([
    [0, 0, 0],
    [3, 10, 20],
    [120, 70, 300],
    [0, 55, 26],
    [0, 56, 25],
    [10, 5, 200],
  ])("%i sevilmeyen + %i gösterilen + %i diğer film → iki üretici AYNI listeyi basar", (disliked, shown, rest) => {
    const blocked = [...films("listed", rest), ...films("shown", shown), ...films("disliked", disliked)];
    expect(weeklyPrompt.trimBlocked(blocked)).toEqual(dailyTrim(blocked));
  });
});

describe("eksen eşikleri: daily-discovery ↔ generate-weekly-picks", () => {
  const dailyAxes = internals(daily).describeAxes;
  const strengthOf = (line: string) => (line.startsWith("belirgin şekilde") ? "strong" : "slight");

  // İki üreticinin profili farklı okuması, kullanıcıya tutarsız öneri demek olurdu.
  it("aynı değer iki üreticide aynı şiddetle okunur (ya da ikisinde de yok sayılır)", () => {
    for (let step = -100; step <= 100; step += 1) {
      const value = step / 100;
      for (const axis of ["tone", "popularity", "era"]) {
        const a = dailyAxes({ [axis]: value }) as string[];
        const b = weeklyPrompt.describeAxes({ [axis]: value });
        expect(a.map(strengthOf), `${axis}=${value}`).toEqual(b.map(strengthOf));
      }
    }
  });
});

describe("üç üretici prompt'u", () => {
  const prompts: [string, string][] = [
    ["analyze", internals(analyze).SYSTEM_PROMPT],
    ["daily-discovery", internals(daily).SYSTEM_PROMPT],
    ["generate-weekly-picks", weeklyPrompt.SYSTEM_PROMPT],
  ];

  it.each(prompts)("%s: hassas çıkarım kuralını `_shared/sensitive.ts`'ten alır", (_name, prompt) => {
    expect(prompt).toContain(SENSITIVE_INFERENCE_RULE);
  });

  // Tek başına eklendiğinde model raporları ASCII yazmaya başladı ve bu canlıya çıktı
  // ("Kalabalikta Yalniz Kalan Ironist"). İkisi BİRLİKTE durur.
  it.each(prompts)("%s: o blok açık bir Türkçe karakter kuralıyla BİRLİKTE durur", (_name, prompt) => {
    expect(prompt).toMatch(/Türkçe karakterleri \(ı, ş, ğ, ü, ö, ç, İ\)/);
    expect(prompt).toMatch(/ASCII yazım KESİNLİKLE yasak/);
  });

  it("kural kullanıcı kimliğine dair çıkarımı yasaklar, eserin tonunu serbest bırakır", () => {
    for (const topic of ["dini inancı", "siyasi görüşü", "etnik kökeni", "cinsel yönelimi", "sağlığı"]) {
      expect(SENSITIVE_INFERENCE_RULE).toContain(topic);
    }
    expect(SENSITIVE_INFERENCE_RULE).toContain("## HASSAS ÇIKARIM YOK");
  });
});

describe("teklif tipleri: generate-weekly-picks → send-weekly-picks → mail şablonu", () => {
  const produced = [...internals(generate).OFFER_PREFERENCE, "off_platform"] as string[];
  const accepted = internals(send).OFFER_TYPES as readonly string[];

  it("üreticinin yazabildiği her teklif tipini gönderen tanır", () => {
    expect([...accepted].sort()).toEqual([...produced].sort());
  });

  it("şablon her teklif tipi için bir önek üretir; hiçbiri 'undefined' basmaz", () => {
    for (const offer_type of produced) {
      const out = renderWeeklyPicksEmail({
        name: "",
        films: [
          { title: "Uzak", year: 2002, blurb: "b", watch_url: "https://x.test/1", providers: ["netflix"], offer_type: offer_type as never },
        ],
        settingsUrl: "https://lensestetik.com/account",
        providerLabels: { netflix: "Netflix" },
      });
      const line = out.text.split("\n").find((l) => l.includes("Nerede izlenir:"))!;
      expect(line, offer_type).toMatch(/^.+ · Nerede izlenir: https:\/\/x\.test\/1$/);
      expect(out.html + out.text).not.toContain("undefined");
    }
  });
});
