import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLibraryStash, readLibraryStash, stashLibraryWorks, type StashedWork } from "@/lib/pendingLibrary";

const KEY = "lens_pending_library";

const work = (title: string, selected = true): StashedWork => ({
  title,
  creator: "Yazar",
  source: "screenshot",
  selected,
});

beforeEach(() => {
  localStorage.clear();
});

describe("giriş öncesi kütüphane zulası", () => {
  it("boş listeyi hiç yazmaz", () => {
    stashLibraryWorks("book", "batch-1", []);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readLibraryStash()).toBeNull();
  });

  it("batch'leri tür başına EKLENDİKLERİ SIRADA tutar", () => {
    stashLibraryWorks("book", "batch-1", [work("A"), work("B", false)]);
    stashLibraryWorks("book", "batch-2", [work("C")]);
    stashLibraryWorks("film", "batch-3", [work("D")]);

    const stash = readLibraryStash()!;
    expect(stash.book?.map((b) => b.batchId)).toEqual(["batch-1", "batch-2"]);
    expect(stash.book?.[0].works.map((w) => w.title)).toEqual(["A", "B"]);
    expect(stash.film?.[0].works[0].title).toBe("D");
    expect(stash.song).toBeUndefined();
    expect(typeof stash.savedAt).toBe("number");
  });

  it("60 dakikayı geçen zula geçersizdir ve silinir", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    stashLibraryWorks("song", "batch-1", [work("A")]);

    vi.setSystemTime(new Date("2026-10-11T11:00:01Z"));
    expect(readLibraryStash()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("bozuk JSON'da null döner", () => {
    localStorage.setItem(KEY, "bozuk");
    expect(readLibraryStash()).toBeNull();
  });

  it("clearLibraryStash zulayı siler", () => {
    stashLibraryWorks("book", "batch-1", [work("A")]);
    clearLibraryStash();
    expect(readLibraryStash()).toBeNull();
  });

  it("depolama yazamıyorsa fırlatmaz, loglar", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => stashLibraryWorks("book", "batch-1", [work("A")])).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
