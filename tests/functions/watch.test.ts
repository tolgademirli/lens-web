import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WATCH_CALLS_PER_USER,
  WATCH_CONCURRENCY,
  WatchClient,
  foldName,
  justwatchSearchUrl,
  mapLimit,
} from "../../supabase/functions/_shared/watch.ts";
import { jsonResponse } from "../helpers/edge";

type Row = Record<string, unknown>;

const netflix = { service: { id: "netflix", name: "Netflix" }, type: "subscription", link: "https://netflix.test/title/1" };

const show = (fields: Row = {}): Row => ({
  id: "show-1",
  showType: "movie",
  title: "Solaris",
  originalTitle: "Solyaris",
  releaseYear: 1972,
  streamingOptions: { tr: [netflix] },
  ...fields,
});

/** `(showType, title) → satırlar` eşlemesiyle sahte sağlayıcı. */
function stubProvider(respond: (showType: string, title: string) => Row[] | Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input));
    const result = respond(url.searchParams.get("show_type") ?? "", url.searchParams.get("title") ?? "");
    return result instanceof Response ? result : jsonResponse(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const asked = (fetchMock: ReturnType<typeof stubProvider>) =>
  fetchMock.mock.calls.map(([input]) => {
    const url = new URL(String(input));
    return [url.searchParams.get("show_type"), url.searchParams.get("title")];
  });

describe("foldName — karşılaştırma için ad katlama", () => {
  it.each([
    ["Yeşil Işın", "yesil isin"],
    ["IŞIK", "isik"],
    ["İstanbul Hatırası", "istanbul hatirasi"],
    // Noktasız I tuzağı: tr-TR'de 'I' → 'ı' olur ve NFD onu çözmez.
    ["Into the Wild", "into the wild"],
    ["Amélie: Café!", "amelie cafe"],
    ["  Çok   Boşluklu -- Ad  ", "cok bosluklu ad"],
  ])("%j → %j", (raw, folded) => {
    expect(foldName(raw)).toBe(folded);
  });

  // "Apple TV+" (abonelik) ile "Apple TV" (kiralama mağazası) AYRI servisler.
  it("'+' işaretini korur", () => {
    expect(foldName("Apple TV+")).toBe("apple tv+");
    expect(foldName("Apple TV+")).not.toBe(foldName("Apple TV"));
  });
});

describe("justwatchSearchUrl — ücretsiz yolun izleme linki", () => {
  it("slug TAHMİN ETMEZ: JustWatch arama sayfasına gider", () => {
    expect(justwatchSearchUrl(" Yeşil Işın ")).toBe("https://www.justwatch.com/tr/arama?q=Ye%C5%9Fil%20I%C5%9F%C4%B1n");
    expect(justwatchSearchUrl("Solaris")).not.toMatch(/\/tr\/film\//);
  });

  it("özel karakterleri kodlar", () => {
    expect(justwatchSearchUrl("Fargo & Co?")).toBe("https://www.justwatch.com/tr/arama?q=Fargo%20%26%20Co%3F");
  });
});

describe("mapLimit", () => {
  it("sonuçları GİRDİ sırasıyla döner, eşzamanlılık sınırını aşmaz", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10, 15], 2, async (ms, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return `${index}:${ms}`;
    });

    expect(out).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:15"]);
    expect(peak).toBe(2);
  });

  it("boş listede çalışan başlatmaz", async () => {
    const fn = vi.fn();
    expect(await mapLimit([], 3, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("kota sabitleri", () => {
  it("kullanıcı başına 12 çağrı tavanı ve 3 eşzamanlı istek", () => {
    expect(MAX_WATCH_CALLS_PER_USER).toBe(12);
    expect(WATCH_CONCURRENCY).toBe(3);
  });
});

describe("WatchClient.findWork", () => {
  let client: WatchClient;

  beforeEach(() => {
    client = new WatchClient("secret-api-key");
  });

  it("eseri TR izleme seçenekleriyle birlikte tek çağrıda döndürür", async () => {
    const fetchMock = stubProvider(() => [show()]);

    const match = await client.findWork({ title: "Solaris", title_en: "Solaris", year: 1972, media_type: "movie" });

    expect(match).toEqual({
      show_id: "show-1",
      media_type: "movie",
      title: "Solaris",
      original_title: "Solyaris",
      year: 1972,
      options: [{ service_id: "netflix", service_name: "Netflix", type: "subscription", link: "https://netflix.test/title/1" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("anahtarı HEADER'da yollar, URL'de değil; Türkiye'yi ve dizi-düzeyini ister", async () => {
    const fetchMock = stubProvider(() => [show()]);
    await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" });

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(String(input)).not.toContain("secret-api-key");
    expect((init!.headers as Record<string, string>)["X-API-Key"]).toBe("secret-api-key");
    expect(url.pathname).toBe("/v4/shows/search/title");
    expect(url.searchParams.get("country")).toBe("tr");
    expect(url.searchParams.get("series_granularity")).toBe("show");
  });

  describe("güven kapısı — yıl hakemdir", () => {
    // Canlı probe (16 Ağustos 2026): 2019 "Chernobyl" dizisi yerine 2024 yapımı
    // başka bir "Chernobyl" yalnızca ad eşitliğiyle kapıdan geçmişti.
    it("ad BİREBİR aynı olsa da yıl 1'den fazla sapıyorsa reddeder", async () => {
      stubProvider(() => [show({ title: "Chernobyl", originalTitle: "Chernobyl", releaseYear: 2024 })]);
      expect(await client.findWork({ title: "Chernobyl", year: 2019, media_type: "movie" })).toBeNull();
    });

    it("ilk satıra sabitlenmez: kapıdan geçen İLK satırı alır", async () => {
      stubProvider((showType) =>
        showType === "series"
          ? [
              show({ id: "yanlis", showType: "series", title: "Chernobyl", originalTitle: "Chernobyl", releaseYear: undefined, firstAirYear: 2024 }),
              show({ id: "dogru", showType: "series", title: "Chernobyl", originalTitle: "Chernobyl", releaseYear: undefined, firstAirYear: 2019 }),
            ]
          : [],
      );

      const match = await client.findWork({ title: "Chernobyl", year: 2019, media_type: "tv" });
      expect(match?.show_id).toBe("dogru");
      expect(match?.media_type).toBe("tv");
      expect(match?.year).toBe(2019);
    });

    it.each([
      [1971, true],
      [1973, true],
      [1970, false],
      [1974, false],
    ])("sorgu yılı %i, sağlayıcı 1972 → geçer mi: %s", async (year, passes) => {
      stubProvider(() => [show()]);
      const match = await client.findWork({ title: "Solaris", year, media_type: "movie" });
      expect(match !== null).toBe(passes);
    });

    it("iki yıl da biliniyorsa ad tutmasa bile ±1 yıl yeter (ad zaten sorgunun kendisi)", async () => {
      stubProvider(() => [show({ title: "Solaris (Restored)", originalTitle: "Solyaris" })]);
      expect(await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" })).not.toBeNull();
    });

    it("sağlayıcıda yıl yoksa KATLANMIŞ ad eşitliğine düşer", async () => {
      stubProvider(() => [show({ title: "The Green Ray", originalTitle: "Le Rayon vert", releaseYear: undefined })]);

      expect(
        await client.findWork({ title: "Yeşil Işın", title_en: "the green RAY", year: 1986, media_type: "movie" }),
      ).not.toBeNull();
      expect(await client.findWork({ title: "Yeşil Işık", title_en: "Green Light", year: 1986, media_type: "movie" })).toBeNull();
    });

    it("sorguda yıl yoksa da ad eşitliği aranır", async () => {
      stubProvider(() => [show()]);
      expect(await client.findWork({ title: "Solaris", year: null, media_type: "movie" })).not.toBeNull();
      expect(await client.findWork({ title: "Stalker", year: null, media_type: "movie" })).toBeNull();
    });

    it("yalnızca ilk 5 satıra bakar", async () => {
      stubProvider(() => [
        ...Array.from({ length: 5 }, (_, i) => show({ id: `eski-${i}`, releaseYear: 1900 + i })),
        show({ id: "altinci" }),
      ]);
      expect(await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" })).toBeNull();
    });
  });

  describe("arama sırası", () => {
    it("özgün ad → yerel ad → öteki tip; hiçbiri tutmazsa null", async () => {
      const fetchMock = stubProvider(() => []);

      const match = await client.findWork({ title: "Yeşil Işın", title_en: "The Green Ray", year: 1986, media_type: "movie" });

      expect(match).toBeNull();
      expect(asked(fetchMock)).toEqual([
        ["movie", "The Green Ray"],
        ["movie", "Yeşil Işın"],
        ["series", "The Green Ray"],
      ]);
    });

    it("yerel ad özgün adla aynıysa (katlanmış) ikinci kez sorulmaz", async () => {
      const fetchMock = stubProvider(() => []);
      await client.findWork({ title: "SOLARIS", title_en: "Solaris", year: 1972, media_type: "tv" });
      expect(asked(fetchMock)).toEqual([
        ["series", "Solaris"],
        ["movie", "Solaris"],
      ]);
    });

    // Claude bazen mini diziyi film etiketliyor.
    it("öteki tipte bulunan eserin medya tipi SAĞLAYICIDAN gelir", async () => {
      stubProvider((showType) =>
        showType === "series" ? [show({ showType: "series", releaseYear: undefined, firstAirYear: 1972 })] : [],
      );
      const match = await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" });
      expect(match?.media_type).toBe("tv");
    });
  });

  describe("ham yanıtın ayrıştırılması", () => {
    it("kimliği ya da tipi eksik satırı atlar", async () => {
      stubProvider(() => [show({ id: undefined }), show({ showType: "short" }), show({ id: "saglam" })]);
      expect((await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" }))?.show_id).toBe("saglam");
    });

    it("tanınmayan teklif tipini, linksiz ve servissiz seçeneği DÜŞÜRÜR", async () => {
      stubProvider(() => [
        show({
          streamingOptions: {
            tr: [
              { service: { id: "netflix", name: "Netflix" }, type: "premium_plus", link: "https://x" },
              { service: { id: "mubi", name: "MUBI" }, type: "addon" },
              { service: {}, type: "rent", link: "https://y" },
              null,
              { service: { id: "prime" }, type: "rent", link: "https://prime.test/1" },
            ],
            us: [netflix],
          },
        }),
      ]);

      const match = await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" });
      // Görünen adı olmayan servis kendi id'siyle adlandırılır; 'us' satırları okunmaz.
      expect(match?.options).toEqual([
        { service_id: "prime", service_name: "prime", type: "rent", link: "https://prime.test/1" },
      ]);
    });

    it("TR'de seçenek yoksa eser yine döner, boş seçenekle", async () => {
      stubProvider(() => [show({ streamingOptions: { us: [netflix] } })]);
      expect((await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" }))?.options).toEqual([]);
    });

    it("ad alanlarından biri eksikse öbürüne düşer; tam sayı olmayan yıl yok sayılır", async () => {
      stubProvider(() => [show({ title: undefined, releaseYear: 1972.5 })]);
      const match = await client.findWork({ title: "Solyaris", year: 1972, media_type: "movie" });
      expect(match).toMatchObject({ title: "Solyaris", original_title: "Solyaris", year: null });
    });
  });

  describe("HTTP dayanıklılığı ve kota", () => {
    it("aynı sorguyu invocation içinde bir kez yapar (önbellek)", async () => {
      const fetchMock = stubProvider(() => [show()]);
      const query = { title: "Solaris", year: 1972, media_type: "movie" as const };

      await client.findWork(query);
      await client.findWork(query);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(client.callCount).toBe(1);
    });

    it("callCount denemeleri sayar ve sıfırlanabilir", async () => {
      stubProvider(() => []);
      await client.findWork({ title: "Yok", year: 2000, media_type: "movie" });
      expect(client.callCount).toBe(2);
      client.resetCallCount();
      expect(client.callCount).toBe(0);
    });

    it("429'da Retry-After kadar bekleyip BİR kez daha dener", async () => {
      vi.useFakeTimers();
      let attempt = 0;
      const fetchMock = stubProvider(() =>
        attempt++ === 0 ? new Response("", { status: 429, headers: { "Retry-After": "3" } }) : [show()],
      );

      const pending = client.findWork({ title: "Solaris", year: 1972, media_type: "movie" });
      await vi.advanceTimersByTimeAsync(2_900);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);

      expect(await pending).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["429 ısrar ederse", 429],
      ["5xx ısrar ederse", 503],
    ])("%s iki denemeden sonra adaydan vazgeçer", async (_label, status) => {
      vi.useFakeTimers();
      const fetchMock = stubProvider(() => new Response("", { status }));

      const pending = client.findWork({ title: "Solaris", title_en: "Solaris", year: 1972, media_type: "movie" });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await pending).toBeNull();
      // 2 sorgu (film + dizi) × 2 deneme.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    // Sessiz kalsaydı bütün haftanın premium seçkisi fark edilmeden ücretsiz yola düşerdi.
    it.each([401, 403])("%i yeniden denenmez ve YÜKSEK SESLE loglanır", async (status) => {
      const fetchMock = stubProvider(() => new Response("", { status }));

      expect(await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" })).toBeNull();

      expect(fetchMock).toHaveBeenCalledTimes(2); // film + dizi sorgusu, her biri TEK deneme
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("API anahtarı reddedildi"));
    });

    it("404 sessizce 'bulunamadı' sayılır", async () => {
      stubProvider(() => new Response("", { status: 404 }));
      expect(await client.findWork({ title: "Solaris", year: 1972, media_type: "movie" })).toBeNull();
      expect(console.error).not.toHaveBeenCalled();
    });

    it("ağ hatasında fırlatmaz: bir kez daha dener, sonra null döner", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      vi.stubGlobal("fetch", fetchMock);

      const pending = client.findWork({ title: "Solaris", year: 1972, media_type: "movie" });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await pending).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});

describe("WatchClient.trServices — teşhis", () => {
  const services = [{ id: "netflix", name: "Netflix" }, { id: "", name: "Adsız" }, { name: "Kimliksiz" }, { id: "mubi" }];

  it.each([
    ["nesne (tr)", { tr: { services } }],
    ["nesne (TR)", { TR: { services } }],
    ["dizi", [{ countryCode: "us", services: [] }, { countryCode: "TR", services }]],
  ])("%s biçimindeki yanıttan TR servislerini okur, kimliksizleri atar", async (_label, payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload)));
    expect(await new WatchClient("k").trServices()).toEqual([
      { id: "netflix", name: "Netflix" },
      { id: "mubi", name: "" },
    ]);
  });

  it("yanıt yoksa ya da TR yoksa boş döner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await new WatchClient("k").trServices()).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ de: { services } })));
    expect(await new WatchClient("k").trServices()).toEqual([]);
  });
});
