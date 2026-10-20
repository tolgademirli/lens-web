import { describe, expect, it, vi } from "vitest";
import { checkBook, checkFilm } from "../../supabase/functions/daily-discovery/workCheck.ts";
import { jsonResponse } from "../helpers/edge";

/**
 * Katalog kapısı (11 Ekim 2026). Kataloglar sahte; sınanan şey KARAR mantığı:
 * hangi cevap hangi hükme varıyor, hangi sorgu hangi sırayla ve ne zaman yapılıyor.
 */
type Outcome<T> = T | "error" | "throw";

interface Catalogs {
  /** Open Library'de (ad, yazar) için kayıt sayısı. */
  openLibrary?: (title: string, author: string) => Outcome<number>;
  /** Wikidata kişi araması: ad + dil → kimlikler. */
  person?: (name: string, language: string) => Outcome<string[]>;
  /** Wikidata eser araması: tam `srsearch` → toplam isabet. */
  works?: (srsearch: string) => Outcome<number>;
}

function stubCatalogs(catalogs: Catalogs) {
  const log = { openLibrary: [] as [string, string][], person: [] as [string, string][], works: [] as string[] };

  const settle = (outcome: Outcome<unknown>, body: (value: never) => unknown) => {
    if (outcome === "throw") throw new Error("timeout");
    if (outcome === "error") return new Response("", { status: 503 });
    return jsonResponse(body(outcome as never));
  };

  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input));
    const q = url.searchParams;

    if (url.hostname === "openlibrary.org") {
      log.openLibrary.push([q.get("title")!, q.get("author")!]);
      return settle(catalogs.openLibrary?.(q.get("title")!, q.get("author")!) ?? 0, (numFound: number) => ({ numFound }));
    }
    if (q.get("action") === "wbsearchentities") {
      log.person.push([q.get("search")!, q.get("language")!]);
      return settle(catalogs.person?.(q.get("search")!, q.get("language")!) ?? [], (ids: string[]) => ({
        search: ids.map((id) => ({ id })),
      }));
    }
    log.works.push(q.get("srsearch")!);
    return settle(catalogs.works?.(q.get("srsearch")!) ?? 0, (totalhits: number) => ({
      query: { searchinfo: { totalhits } },
    }));
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, log };
}

describe("checkBook", () => {
  const book = { title: "Huzur", creator: "Ahmet Hamdi Tanpınar", originalTitle: "Huzur" };

  it("Open Library'de varsa 'title' — Wikidata'ya hiç sorulmaz", async () => {
    const { log } = stubCatalogs({ openLibrary: () => 3 });

    expect(await checkBook(book)).toBe("title");
    expect(log.openLibrary).toEqual([["Huzur", "Ahmet Hamdi Tanpınar"]]);
    expect(log.person).toHaveLength(0);
  });

  // Çevirilerin Türkçe baskısında Open Library zayıf; Wikidata onu tamamlıyor.
  it("Open Library bulamaz ama Wikidata yazara bağlı kaydı bulursa 'title'", async () => {
    const { log } = stubCatalogs({ openLibrary: () => 0, person: () => ["Q1"], works: () => 1 });

    expect(await checkBook({ title: "Usta ile Margarita", creator: "Mihail Bulgakov" })).toBe("title");
    expect(log.works[0]).toBe("Usta ile Margarita haswbstatement:P50=Q1");
  });

  // İlk hata biçimi: gerçek yaratıcıya yanlış/uydurma eser.
  it("iki katalogda da yoksa 'not_found' — öneri geri çevrilir", async () => {
    stubCatalogs({ openLibrary: () => 0, person: () => ["Q1"], works: () => 0 });
    expect(await checkBook({ title: "Şeytan ve İyi Yürekli İnsan", creator: "Ahmet Hamdi Tanpınar" })).toBe("not_found");
  });

  // İkinci hata biçimi: gerçek esere uydurma Türkçe ad.
  it("kartta yazacak ad yok ama ÖZGÜN ad varsa 'original'", async () => {
    stubCatalogs({ openLibrary: (title) => (title === "Der Zauberberg" ? 1 : 0) });

    expect(
      await checkBook({ title: "Sihirli Tepe", creator: "Thomas Mann", originalTitle: "Der Zauberberg" }),
    ).toBe("original");
  });

  it("özgün ad kartta yazanla aynıysa (büyük/küçük harf farkıyla) ikinci kez sorulmaz", async () => {
    const { log } = stubCatalogs({ openLibrary: () => 0 });

    expect(await checkBook({ title: "Huzur", creator: "X Y", originalTitle: "HUZUR" })).toBe("not_found");
    expect(log.openLibrary).toHaveLength(1);
  });

  // Yalnızca ada bakan bir arama yanlış yakıştırmayı yakalayamaz.
  it("adı YARATICIYLA BİRLİKTE sorgular", async () => {
    const { log } = stubCatalogs({ openLibrary: () => 0, person: () => ["Q7", "Q8"], works: () => 0 });

    await checkBook({ title: "Gecenin Öteki Yüzü", creator: " Ahmet Oktay " });

    expect(log.openLibrary[0]).toEqual(["Gecenin Öteki Yüzü", "Ahmet Oktay"]);
    expect(log.works[0]).toBe("Gecenin Öteki Yüzü haswbstatement:P50=Q7|P50=Q8");
  });

  describe("aranacak adın temizlenmesi", () => {
    it.each([
      ["Huzur (roman)", "Huzur"],
      ["Sapiens: İnsan Türünün Kısa Bir Tarihi", "Sapiens"],
      ["  Tutunamayanlar  ", "Tutunamayanlar"],
      ["Kürk Mantolu Madonna (1943)", "Kürk Mantolu Madonna"],
    ])("%j → %j", async (title, cleaned) => {
      const { log } = stubCatalogs({ openLibrary: () => 1 });
      await checkBook({ title, creator: "Yazar Adı" });
      expect(log.openLibrary[0][0]).toBe(cleaned);
    });
  });

  describe("fail-open — katalog ayakta değilse öneri GEÇER", () => {
    it.each([
      ["5xx", "error" as const],
      ["zaman aşımı", "throw" as const],
    ])("Open Library %s verir ve Wikidata da bulamazsa 'unknown'", async (_label, outcome) => {
      stubCatalogs({ openLibrary: () => outcome, person: () => ["Q1"], works: () => 0 });
      expect(await checkBook(book)).toBe("unknown");
      // Sessizce 'unknown' dönen bir katalog, kapının hiç çalışmaması demek: LOGLANIR.
      const logged = vi.mocked(console.error).mock.calls.map(([first]) => String(first));
      expect(logged.some((line) => line.startsWith("[work-check] Open Library"))).toBe(true);
    });

    it("Open Library çökmüşken Wikidata bulursa yine 'title'", async () => {
      stubCatalogs({ openLibrary: () => "error", person: () => ["Q1"], works: () => 2 });
      expect(await checkBook(book)).toBe("title");
    });

    // Bir kesinti yüzünden doğru bir Türkçe adı yabancısıyla değiştirmiyoruz.
    it("kartta yazacak ad SINANAMADIYSA özgün ada dönülmez", async () => {
      const { log } = stubCatalogs({ openLibrary: (title) => (title === "Sihirli Tepe" ? "error" : 1) });

      expect(
        await checkBook({ title: "Sihirli Tepe", creator: "Thomas Mann", originalTitle: "Der Zauberberg" }),
      ).toBe("unknown");
      expect(log.openLibrary.map(([title]) => title)).toEqual(["Sihirli Tepe"]);
    });
  });

  describe("Wikidata yalnızca YUKARI çeker", () => {
    it("yazar Wikidata'da kayıtlı değilse Open Library'nin 'yok'u geçerli kalır", async () => {
      const { log } = stubCatalogs({ openLibrary: () => 0, person: () => [] });
      expect(await checkBook(book)).toBe("not_found");
      // Kişi bulunamadıysa eser araması da yapılmaz.
      expect(log.works).toHaveLength(0);
    });

    it("yazar sorgusu yapılamazsa da Open Library'nin 'yok'u geçerli kalır", async () => {
      stubCatalogs({ openLibrary: () => 0, person: () => "error" });
      expect(await checkBook(book)).toBe("not_found");
    });
  });

  it("yazar kimliği en çok BİR kez sorulur (kart adı + özgün ad için ortak)", async () => {
    const { log } = stubCatalogs({ openLibrary: () => 0, person: () => ["Q1"], works: () => 0 });

    await checkBook({ title: "Sihirli Tepe", creator: "Thomas Mann", originalTitle: "Der Zauberberg" });

    expect(log.person).toEqual([["Thomas Mann", "tr"]]);
    expect(log.works).toHaveLength(2);
  });

  it("kişi Türkçe etiketlerde yoksa İngilizce etiketlerde aranır", async () => {
    const { log } = stubCatalogs({
      openLibrary: () => 0,
      person: (_name, language) => (language === "en" ? ["Q9"] : []),
      works: () => 1,
    });

    expect(await checkBook({ title: "Kar Ülkesi", creator: "Yasunari Kavabata" })).toBe("title");
    expect(log.person.map(([, language]) => language)).toEqual(["tr", "en"]);
  });

  it.each([
    ["yalnızca yazar adı gelen öneri", { title: "", creator: "Orhan Pamuk" }],
    ["yazarı olmayan öneri", { title: "Huzur", creator: "  " }],
    ["yalnızca parantezden ibaret ad", { title: "(roman)", creator: "Orhan Pamuk" }],
  ])("%s sınanmaz: 'unknown', ağ isteği yok", async (_label, work) => {
    const { fetchMock } = stubCatalogs({});
    expect(await checkBook(work)).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Wikimedia kimliğini söylemeyen istemciyi kısıyor.
  it("her istekte kendini User-Agent ile tanıtır", async () => {
    const { fetchMock } = stubCatalogs({ openLibrary: () => 0, person: () => ["Q1"], works: () => 0 });
    await checkBook(book);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init!.headers as Record<string, string>)["User-Agent"]).toContain("lensestetik.com");
    }
  });
});

describe("checkFilm", () => {
  const film = { title: "Kış Uykusu", creator: "Nuri Bilge Ceylan", originalTitle: "Kış Uykusu" };

  it("yönetmene bağlı kayıt varsa 'title' (P57 = yönetmen)", async () => {
    const { log } = stubCatalogs({ person: () => ["Q5"], works: () => 1 });

    expect(await checkFilm(film)).toBe("title");
    expect(log.works).toEqual(["Kış Uykusu haswbstatement:P57=Q5"]);
    expect(log.openLibrary).toHaveLength(0);
  });

  // "Otomatik Portakal — Theo Angelopoulos": gerçek yönetmene yanlış film.
  it("yönetmenin filmografisinde yoksa 'not_found'", async () => {
    stubCatalogs({ person: () => ["Q5"], works: () => 0 });
    expect(await checkFilm({ title: "Otomatik Portakal", creator: "Theo Angelopoulos" })).toBe("not_found");
  });

  // "Im Lauf der Zeit"e "Avrupa'nın Ortasında" denmişti: eser gerçek, ad uydurma.
  it("uydurma Türkçe ad + gerçek özgün ad → 'original'", async () => {
    stubCatalogs({ person: () => ["Q5"], works: (search) => (search.startsWith("Im Lauf der Zeit") ? 1 : 0) });

    expect(
      await checkFilm({ title: "Avrupa'nın Ortasında", creator: "Wim Wenders", originalTitle: "Im Lauf der Zeit" }),
    ).toBe("original");
  });

  // Kaydı olmayan gerçek bir yönetmen olabilir; görülen hata uydurma yönetmen değil.
  it("tanınmayan yönetmen 'not_found' DEĞİL 'unknown'dır", async () => {
    const { log } = stubCatalogs({ person: () => [] });
    expect(await checkFilm(film)).toBe("unknown");
    expect(log.works).toHaveLength(0);
  });

  it("katalog sorgulanamazsa 'unknown'", async () => {
    stubCatalogs({ person: () => ["Q5"], works: () => "error" });
    expect(await checkFilm(film)).toBe("unknown");

    stubCatalogs({ person: () => "throw" });
    expect(await checkFilm(film)).toBe("unknown");
  });

  describe("ortak yönetim", () => {
    // Wikidata filmi ikiliye değil KİŞİLERE bağlıyor.
    it.each([
      ["Joel Coen, Ethan Coen", ["Joel Coen", "Ethan Coen"]],
      ["Joel Coen & Ethan Coen", ["Joel Coen", "Ethan Coen"]],
      ["Jean-Pierre Dardenne ve Luc Dardenne", ["Jean-Pierre Dardenne", "Luc Dardenne"]],
      ["Lana Wachowski and Lilly Wachowski", ["Lana Wachowski", "Lilly Wachowski"]],
      ["Jonathan Dayton / Valerie Faris", ["Jonathan Dayton", "Valerie Faris"]],
    ])("%j adlarına ayrılır", async (creator, names) => {
      const { log } = stubCatalogs({ person: (name) => [`Q-${name}`], works: () => 1 });

      expect(await checkFilm({ title: "Film", creator })).toBe("title");
      expect(log.person.map(([name]) => name)).toEqual(names);
      expect(log.works[0]).toBe(`Film haswbstatement:P57=Q-${names[0]}|P57=Q-${names[1]}`);
    });

    // "Paolo" tek başına alakasız birini buluyor, "Padre Padrone" geri çevriliyordu.
    it("tek sözcüklü parçayı atar: 'Paolo ve Vittorio Taviani' → 'Vittorio Taviani'", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: "Padre Padrone", creator: "Paolo ve Vittorio Taviani" });
      expect(log.person.map(([name]) => name)).toEqual(["Vittorio Taviani"]);
    });

    it("hiçbir parça iki sözcüklü değilse adın tamamını arar", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: "Film", creator: "Zeki" });
      expect(log.person.map(([name]) => name)).toEqual(["Zeki"]);
    });

    it("en çok iki yönetmen sorulur", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: "Film", creator: "Ali Veli, Ayşe Fatma, Can Cem, Ece Naz" });
      expect(log.person).toHaveLength(2);
    });

    it("yönetmenlerden biri bulunursa arama onunla yapılır", async () => {
      const { log } = stubCatalogs({
        person: (name) => (name === "Ethan Coen" ? ["Q2"] : []),
        works: () => 1,
      });
      expect(await checkFilm({ title: "Fargo", creator: "Joel Coen, Ethan Coen" })).toBe("title");
      expect(log.works[0]).toBe("Fargo haswbstatement:P57=Q2");
    });
  });

  describe("arama terimleri", () => {
    // "Marienbad'da" tek sözcük olarak dizinleniyor; bölünürse eşleşmiyor.
    it("kesme işaretini KORUR", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: "Geçen Yıl Marienbad'da", creator: "Alain Resnais" });
      expect(log.works[0]).toBe("Geçen Yıl Marienbad'da haswbstatement:P57=Q1");
    });

    // "-Eylül" arama sözdiziminde o sözcüğü DIŞLAR.
    it("arama sözdiziminde anlam taşıyan işaretleri temizler", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: '-Eylül "Öbek" [1] ne? evet!', creator: "Ali Veli" });
      expect(log.works[0]).toBe("Eylül Öbek 1 ne evet haswbstatement:P57=Q1");
    });

    it("alt başlığı ve sondaki parantezi atar", async () => {
      const { log } = stubCatalogs({ person: () => ["Q1"], works: () => 1 });
      await checkFilm({ title: "Dekalog: Bir (1989)", creator: "Krzysztof Kieślowski" });
      expect(log.works[0]).toBe("Dekalog haswbstatement:P57=Q1");
    });

    it("temizlenince boş kalan ad sınanamaz: 'unknown'", async () => {
      stubCatalogs({ person: () => ["Q1"], works: () => 0 });
      expect(await checkFilm({ title: "???", creator: "Ali Veli" })).toBe("unknown");
    });
  });

  it.each([
    ["yönetmeni olmayan öneri", { title: "Uzak", creator: "" }],
    ["adı olmayan öneri", { title: " ", creator: "Nuri Bilge Ceylan" }],
  ])("%s sınanmaz: 'unknown', ağ isteği yok", async (_label, work) => {
    const { fetchMock } = stubCatalogs({});
    expect(await checkFilm(work)).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
