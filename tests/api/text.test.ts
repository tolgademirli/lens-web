import { describe, expect, it } from "vitest";
import { box, h, text } from "../../api/_lib/h.ts";
import { archetypeLayers, contrastPairs, slugify, truncateWords, trUpper } from "../../api/_lib/text.ts";
import type { ContrastItem, HeroData } from "../../src/lib/types";

const hero = (fields: Record<string, unknown>) => fields as unknown as HeroData;
const contrast = (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) =>
  ({ left, right }) as unknown as ContrastItem;

describe("trUpper — Türkçe büyük harf", () => {
  it.each([
    ["ışık", "IŞIK"],
    ["sezgi", "SEZGİ"],
    ["metin", "METİN"],
    ["sen hangisisin?", "SEN HANGİSİSİN?"],
    ["çöl gölü", "ÇÖL GÖLÜ"],
  ])("%s → %s", (input, expected) => {
    expect(trUpper(input)).toBe(expected);
  });
});

describe("archetypeLayers", () => {
  it("niteleyici ve çekirdek varsa iki katman çizilir", () => {
    expect(
      archetypeLayers(
        hero({
          archetype: "Kıyıda Ateş Yakan Maceraperest",
          archetype_qualifier: " Kıyıda ateş yakan ",
          archetype_core: " Maceraperest ",
        }),
      ),
    ).toEqual({ qualifier: "Kıyıda ateş yakan", core: "Maceraperest", twoLayer: true });
  });

  it("niteleyici yoksa tek katman: çekirdek", () => {
    expect(
      archetypeLayers(hero({ archetype: "Gece Vardiyası Varoluşçusu", archetype_core: "Gece Vardiyası Varoluşçusu" })),
    ).toEqual({ qualifier: "", core: "Gece Vardiyası Varoluşçusu", twoLayer: false });
  });

  it("katman alanları olmayan eski rapor tam ada düşer", () => {
    expect(archetypeLayers(hero({ archetype: " Nostaljik Mimar " }))).toEqual({
      qualifier: "",
      core: "Nostaljik Mimar",
      twoLayer: false,
    });
  });

  it("niteleyici var ama çekirdek yoksa bölmeye güvenmez", () => {
    expect(archetypeLayers(hero({ archetype: "Nostaljik Mimar", archetype_qualifier: "Nostaljik" }))).toEqual({
      qualifier: "",
      core: "Nostaljik Mimar",
      twoLayer: false,
    });
  });

  it("hero yoksa boş tek katman döner", () => {
    expect(archetypeLayers(undefined)).toEqual({ qualifier: "", core: "", twoLayer: false });
  });
});

describe("contrastPairs — poster kutup etiketleri", () => {
  it("`poster` alanını kullanır ve Türkçe büyük harfe çevirir", () => {
    expect(contrastPairs([contrast({ poster: "toz", title: "Tutunamayanlar" }, { poster: "ışık", title: "BLOK3" })])).toEqual([
      { left: "TOZ", right: "IŞIK" },
    ]);
    expect(contrastPairs([contrast({ poster: "metin" }, { poster: "sezgi" })])).toEqual([
      { left: "METİN", right: "SEZGİ" },
    ]);
  });

  it("sıra: poster → tek kelimelik subtitle → tek kelimelik title", () => {
    expect(
      contrastPairs([
        contrast({ subtitle: "sessizlik", title: "Uzun Bir Eser Adı" }, { title: "Macondo" }),
      ]),
    ).toEqual([{ left: "SESSİZLİK", right: "MACONDO" }]);
  });

  // Canlıda "MACONDO," ve "DIŞA PATLAYAN ENERJİ" etiketleri posterin düzenini bozdu.
  it("baştaki/sondaki noktalamayı atar", () => {
    expect(contrastPairs([contrast({ title: "Macondo," }, { title: "«Kaos»!" })])).toEqual([
      { left: "MACONDO", right: "KAOS" },
    ]);
  });

  it.each([
    ["çok kelimeli etiket", { poster: "dışa patlayan enerji" }],
    ["12 karakteri aşan etiket", { poster: "varoluşsallık" }],
    ["boş taraf", {}],
    ["eksik taraf", undefined],
  ])("%s varsa satır TAMAMEN atlanır (tek taraflı ok çizilmez)", (_label, bad) => {
    expect(contrastPairs([contrast({ poster: "toz" }, bad)])).toEqual([]);
    expect(contrastPairs([contrast(bad, { poster: "toz" })])).toEqual([]);
  });

  it("tam 12 karakterlik etiket geçerlidir", () => {
    expect(contrastPairs([contrast({ poster: "abcdefghijkl" }, { poster: "toz" })])).toHaveLength(1);
  });

  it("en fazla 2 satır döner; bozuk satır diğerini düşürmez", () => {
    const good = contrast({ poster: "düzen" }, { poster: "kaos" });
    const bad = contrast({ poster: "çok uzun bir şey" }, { poster: "kaos" });
    expect(contrastPairs([good, good, good])).toHaveLength(2);
    expect(contrastPairs([bad, good])).toEqual([{ left: "DÜZEN", right: "KAOS" }]);
  });

  it.each([[undefined], [null], ["metin"], [{}]])("dizi olmayan girdi (%j) boş döner", (raw) => {
    expect(contrastPairs(raw as never)).toEqual([]);
  });
});

describe("truncateWords", () => {
  it("sığan metne dokunmaz", () => {
    expect(truncateWords("kısa metin", 20)).toBe("kısa metin");
  });

  it("kelime sınırında keser ve … ekler", () => {
    expect(truncateWords("bir iki üç dört beş altı", 14)).toBe("bir iki üç…");
  });

  it("uygun boşluk yoksa karakterden keser", () => {
    expect(truncateWords("supercalifragilistic", 8)).toBe("supercal…");
  });
});

describe("slugify — poster dosya adı", () => {
  it.each([
    ["Nostaljik Mimar", "nostaljik-mimar"],
    ["Işık Avcısı İçin Çöl", "isik-avcisi-icin-col"],
    ["Kadife Ceketli Sokak Filozofu", "kadife-ceketli-sokak-filozofu"],
    ["  --Gece, Vardiyası!  ", "gece-vardiyasi"],
    ["Şüpheci Öğrenci & Ağır Abi", "supheci-ogrenci-agir-abi"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("boş ya da yalnızca simgeden oluşan ad 'lens' olur", () => {
    expect(slugify("")).toBe("lens");
    expect(slugify("!!! ???")).toBe("lens");
  });

  it("48 karakterde kesilir", () => {
    expect(slugify("a".repeat(100))).toHaveLength(48);
  });
});

describe("h — satori element yardımcısı", () => {
  it("çocuk yoksa children tanımsız, tek çocukta kendisi, çokta dizi", () => {
    expect(h("div", null).props.children).toBeUndefined();
    expect(h("div", null, "a").props.children).toBe("a");
    expect(h("div", null, "a", "b").props.children).toEqual(["a", "b"]);
  });

  it("null / undefined / false çocukları atar, iç içe dizileri düzleştirir, 0'ı korur", () => {
    const node = h("div", { id: "x" }, null, false, undefined, ["a", ["b"]] as never, 0);
    expect(node.props).toEqual({ id: "x", children: ["a", "b", 0] });
  });

  it("box ve text varsayılan olarak flex'tir; verilen stil üstüne yazar", () => {
    expect(box({ width: 10 }).props.style).toEqual({ display: "flex", width: 10 });
    expect(box({ display: "none" }).props.style).toEqual({ display: "none" });
    expect(text({ color: "red" }, "LENS")).toEqual({
      type: "div",
      props: { style: { display: "flex", color: "red" }, children: "LENS" },
    });
  });
});
