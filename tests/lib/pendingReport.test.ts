import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_TOTAL_ENTRIES } from "@/lib/formLimits";
import {
  clearPendingReport,
  pendingReportIsComplete,
  readPendingReport,
  writePendingReport,
} from "@/lib/pendingReport";
import { emptyDraft, type TasteDraft } from "@/lib/tasteDraft";

const KEY = "lens_pending_report";
const MINUTE = 60 * 1000;

const entry = (title: string) => ({ title, creator: "", source: "manual" as const, workId: "" });
const draftOf = (books: number, movies: number, music: number): TasteDraft => ({
  books: Array.from({ length: books }, (_, i) => entry(`K${i}`)),
  movies: Array.from({ length: movies }, (_, i) => entry(`F${i}`)),
  music: Array.from({ length: music }, (_, i) => entry(`M${i}`)),
});

beforeEach(() => {
  localStorage.clear();
});

describe("OAuth / magic link köprüsü", () => {
  it("localStorage['lens_pending_report'] anahtarına yazar ve aynen geri okur", () => {
    const draft = draftOf(2, 1, 0);
    writePendingReport(draft);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(readPendingReport()).toEqual(draft);
  });

  it("kayıt yoksa null döner", () => {
    expect(readPendingReport()).toBeNull();
  });

  it("60 dakikayı geçen kayıt geçersizdir ve SİLİNİR", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    writePendingReport(draftOf(6, 0, 0));

    vi.setSystemTime(new Date("2026-10-11T11:00:01Z"));
    expect(readPendingReport()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("tam 60. dakikada kayıt hâlâ geçerlidir", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    writePendingReport(draftOf(6, 0, 0));

    vi.setSystemTime(new Date("2026-10-11T11:00:00Z"));
    expect(readPendingReport()).not.toBeNull();
  });

  it("savedAt taşımayan kayıt taze sayılır", () => {
    localStorage.setItem(KEY, JSON.stringify({ books: [entry("A")], movies: [], music: [] }));
    expect(readPendingReport()?.books).toHaveLength(1);
  });

  it("eski biçimi (string[] + sources/workIds nesneleri) yükseltir", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        books: ["Uzak - Nuri Bilge Ceylan", "Kafka"],
        movies: [],
        music: ["Adamlar"],
        sources: { books: ["screenshot", "manual"] },
        workIds: { books: ["w-1", ""] },
        savedAt: Date.now() - 5 * MINUTE,
      }),
    );

    expect(readPendingReport()).toEqual({
      books: [
        { title: "Uzak", creator: "Nuri Bilge Ceylan", source: "screenshot", workId: "w-1" },
        { title: "", creator: "Kafka", source: "manual", workId: "" },
      ],
      movies: [],
      // Paralel dizi yoksa source bilinmez → 'form'.
      music: [{ title: "", creator: "Adamlar", source: "form", workId: "" }],
    });
  });

  it("bozuk JSON'da null döner, fırlatmaz", () => {
    localStorage.setItem(KEY, "{bozuk");
    expect(readPendingReport()).toBeNull();
  });

  it("eksik kategori boş dizi olarak okunur", () => {
    localStorage.setItem(KEY, JSON.stringify({ books: [entry("A")], savedAt: Date.now() }));
    expect(readPendingReport()).toEqual({ ...emptyDraft(), books: [entry("A")] });
  });

  it("clearPendingReport kaydı siler", () => {
    writePendingReport(draftOf(1, 0, 0));
    clearPendingReport();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("pendingReportIsComplete — eşik TOPLAMDA", () => {
  it("eşik 6'dır", () => {
    expect(MIN_TOTAL_ENTRIES).toBe(6);
  });

  it.each([
    [6, 0, 0, true],
    [0, 6, 0, true],
    [2, 2, 2, true],
    [8, 8, 8, true],
    [3, 2, 0, false],
    [0, 0, 0, false],
  ])("%i kitap + %i film + %i müzik → %s", (books, movies, music, expected) => {
    expect(pendingReportIsComplete(draftOf(books, movies, music))).toBe(expected);
  });

  it("null taslak eksiktir", () => {
    expect(pendingReportIsComplete(null)).toBe(false);
  });
});
