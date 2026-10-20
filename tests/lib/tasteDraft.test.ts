import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ENTRIES_PER_CATEGORY } from "@/lib/formLimits";
import {
  CATEGORY_KEYS,
  WORK_TYPE_BY_CATEGORY,
  clearSessionDraft,
  draftTotal,
  emptyDraft,
  entryFromText,
  entryLabel,
  normalizeEntries,
  readSessionDraft,
  writeSessionDraft,
} from "@/lib/tasteDraft";

beforeEach(() => {
  sessionStorage.clear();
});

describe("entryFromText", () => {
  it("SON ' - ' ile böler: eser adı tire içerebilir", () => {
    expect(entryFromText("Sıcak - Soğuk Mevsimler - Camus", "manual")).toEqual({
      title: "Sıcak - Soğuk Mevsimler",
      creator: "Camus",
      source: "manual",
      workId: "",
    });
  });

  it("ayıraç yoksa tamamını yaratıcıya yazar (eser mi kişi mi bilinmiyor)", () => {
    expect(entryFromText("  Asmalı Konak  ", "manual")).toEqual({
      title: "",
      creator: "Asmalı Konak",
      source: "manual",
      workId: "",
    });
  });

  it("boşluksuz tire ayıraç sayılmaz", () => {
    expect(entryFromText("Jean-Luc Godard", "paste")?.creator).toBe("Jean-Luc Godard");
    expect(entryFromText("Jean-Luc Godard", "paste")?.title).toBe("");
  });

  it.each(["", "   ", "\n\t"])("boş girdi (%j) null döner", (text) => {
    expect(entryFromText(text, "manual")).toBeNull();
  });

  it("verilen source'u aynen taşır", () => {
    expect(entryFromText("Uzak - Nuri Bilge Ceylan", "screenshot")?.source).toBe("screenshot");
  });
});

describe("entryLabel", () => {
  it("ikisi de varsa 'yaratıcı — eser' biçiminde yazar", () => {
    expect(entryLabel({ title: "Uzak", creator: "Nuri Bilge Ceylan", source: "manual", workId: "" })).toBe(
      "Nuri Bilge Ceylan — Uzak",
    );
  });

  it("tek alan doluysa onu yazar", () => {
    expect(entryLabel({ title: "", creator: "Kafka", source: "manual", workId: "" })).toBe("Kafka");
    expect(entryLabel({ title: "Dava", creator: "", source: "manual", workId: "" })).toBe("Dava");
  });
});

describe("normalizeEntries", () => {
  it.each([[null], [undefined], ["metin"], [{ title: "x" }], [42]])("dizi olmayan girdi (%j) boş döner", (raw) => {
    expect(normalizeEntries(raw)).toEqual([]);
  });

  it("alanları kırpar, bozuk elemanları ve ikisi de boş satırı atar", () => {
    const raw = [
      { title: " Uzak ", creator: " Nuri Bilge Ceylan ", source: "paste", workId: "w-1" },
      null,
      "Uzak - Nuri Bilge Ceylan",
      { title: "   ", creator: "" },
      { title: 42, creator: ["x"] },
      { creator: "Adamlar" },
    ];
    expect(normalizeEntries(raw)).toEqual([
      { title: "Uzak", creator: "Nuri Bilge Ceylan", source: "paste", workId: "w-1" },
      { title: "", creator: "Adamlar", source: "form", workId: "" },
    ]);
  });

  it.each([["import"], [undefined], [null], [7]])("tanınmayan source (%j) 'form'a düşer", (source) => {
    expect(normalizeEntries([{ title: "A", creator: "B", source }])[0].source).toBe("form");
  });

  it("string olmayan workId boş string olur", () => {
    expect(normalizeEntries([{ title: "A", creator: "", workId: 12 }])[0].workId).toBe("");
  });

  it(`kategori tavanına (${MAX_ENTRIES_PER_CATEGORY}) kırpar`, () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ title: `Eser ${i}`, creator: "" }));
    const out = normalizeEntries(raw);
    expect(out).toHaveLength(MAX_ENTRIES_PER_CATEGORY);
    expect(out[0].title).toBe("Eser 0");
  });
});

describe("sessionStorage taslağı", () => {
  const draft = {
    books: [{ title: "Tutunamayanlar", creator: "Oğuz Atay", source: "manual" as const, workId: "" }],
    movies: [{ title: "Uzak", creator: "Nuri Bilge Ceylan", source: "screenshot" as const, workId: "w-9" }],
    music: [],
  };

  it("boş depoda boş taslak döner", () => {
    expect(readSessionDraft()).toEqual(emptyDraft());
  });

  it("yazılanı aynen geri okur", () => {
    writeSessionDraft(draft);
    expect(readSessionDraft()).toEqual(draft);
  });

  it("anahtarlar kategori adlarıdır (books / movies / music)", () => {
    writeSessionDraft(draft);
    expect(CATEGORY_KEYS).toEqual(["books", "movies", "music"]);
    for (const key of CATEGORY_KEYS) expect(sessionStorage.getItem(key)).not.toBeNull();
  });

  it("eski 9 anahtarlı string[] taslağı paralel dizileriyle birlikte yükseltir", () => {
    sessionStorage.setItem("books", JSON.stringify(["Sıcak - Soğuk Mevsimler - Camus", "Orhan Pamuk"]));
    sessionStorage.setItem("books_sources", JSON.stringify(["screenshot", "manual"]));
    sessionStorage.setItem("books_work_ids", JSON.stringify(["w-1", ""]));

    expect(readSessionDraft().books).toEqual([
      { title: "Sıcak - Soğuk Mevsimler", creator: "Camus", source: "screenshot", workId: "w-1" },
      { title: "", creator: "Orhan Pamuk", source: "manual", workId: "" },
    ]);
  });

  it("eski taslakta paralel diziler yoksa source 'form'a düşer", () => {
    sessionStorage.setItem("music", JSON.stringify(["Adamlar"]));
    expect(readSessionDraft().music).toEqual([{ title: "", creator: "Adamlar", source: "form", workId: "" }]);
  });

  it("bozuk JSON bir kategoriyi boşaltır, diğerlerini etkilemez", () => {
    writeSessionDraft(draft);
    sessionStorage.setItem("books", "{bozuk");
    const read = readSessionDraft();
    expect(read.books).toEqual([]);
    expect(read.movies).toEqual(draft.movies);
  });

  it("clearSessionDraft eski anahtarlar dahil hepsini siler", () => {
    writeSessionDraft(draft);
    sessionStorage.setItem("books_sources", "[]");
    sessionStorage.setItem("music_work_ids", "[]");
    clearSessionDraft();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("yardımcılar", () => {
  it("draftTotal üç kategoriyi toplar", () => {
    const entry = { title: "A", creator: "", source: "manual" as const, workId: "" };
    expect(draftTotal(emptyDraft())).toBe(0);
    expect(draftTotal({ books: [entry, entry], movies: [], music: [entry] })).toBe(3);
  });

  it("kategori ↔ user_works.type eşlemesi", () => {
    expect(WORK_TYPE_BY_CATEGORY).toEqual({ books: "book", movies: "film", music: "song" });
  });
});
