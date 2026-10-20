import { describe, expect, it } from "vitest";
import {
  renderWeeklyPicksEmail,
  type PickFilm,
  type RenderInput,
} from "../../supabase/functions/send-weekly-picks/email.ts";

const film = (fields: Partial<PickFilm> = {}): PickFilm => ({
  title: "Chungking Express",
  year: 1994,
  blurb: "Şehirde iki insanın birbirini ıskalaması.",
  watch_url: "https://www.justwatch.com/tr/arama?q=Chungking%20Express",
  ...fields,
});

const series = (fields: Partial<PickFilm> = {}) => film({ title: "Chernobyl", year: 2019, media_type: "tv", ...fields });

function render(overrides: Partial<RenderInput> = {}) {
  return renderWeeklyPicksEmail({
    name: "Beyza",
    films: [film(), film({ title: "Uzak", year: 2002 }), film({ title: "Masumiyet", year: 1997 })],
    settingsUrl: "https://lensestetik.com/account",
    unsubscribeUrl: "https://supabase.test/functions/v1/unsubscribe?u=user-1&t=token",
    dashboardUrl: "https://lensestetik.com/dashboard",
    providerLabels: { netflix: "Netflix", mubi: "MUBI", prime: "Prime Video" },
    ...overrides,
  });
}

const hrefs = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);

describe("deliverability kuralları", () => {
  const { html } = render();

  // 3 izleme + 1 panel + 1 kapatma. Çok link Promotions sınıflandırmasını besler.
  it("LİNK TAVANI 5: üç filmde tam beş link", () => {
    const links = hrefs(html);
    expect(links).toHaveLength(5);
    expect(links.filter((l) => l.includes("justwatch.com"))).toHaveLength(3);
    expect(links).toContain("https://lensestetik.com/dashboard");
    expect(links.at(-1)).toContain("/unsubscribe?u=user-1");
  });

  it("görsel, harici CSS ve <style> bloğu YOK", () => {
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/background(-image)?:\s*url/i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it("layout table tabanlıdır (flex/grid Outlook'ta çöker)", () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });

  it("gizli preheader gövdenin başındadır", () => {
    expect(html.startsWith('<div style="display:none;max-height:0;')).toBe(true);
    expect(html).toContain("Bu haftanın üç filmi — sana göre seçtim.");
  });

  it("düz metin sürümü HTML ile aynı içeriği taşır", () => {
    const { text } = render();
    for (const expected of [
      "Selam Beyza, Tolga ben.",
      "Chungking Express (1994)",
      "Şehirde iki insanın birbirini ıskalaması.",
      "Nerede izlenir: https://www.justwatch.com/tr/arama?q=Chungking%20Express",
      "https://lensestetik.com/dashboard",
      "— Tolga",
      "/unsubscribe?u=user-1&t=token",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe("sayı ve tür — konu, giriş ve preheader AYNI şeyi söyler", () => {
  it.each([
    [[film(), film({ title: "B" }), film({ title: "C" })], "Bu hafta için üç film", "üç film:", "Bu haftanın üç filmi"],
    [[series(), series({ title: "B" })], "Bu hafta için iki dizi", "iki dizi:", "Bu haftanın iki dizisi"],
    [[film(), film({ title: "B" }), series()], "Bu hafta için iki film, bir dizi", "iki film, bir dizi:", "Bu haftanın iki filmi, bir dizisi"],
    // Tek öğede sayı düşer: "Bu haftanın bir filmi" Türkçede tökezliyor.
    [[film()], "Bu hafta için bir film", "bir film:", "Bu haftanın filmi —"],
    [[series()], "Bu hafta için bir dizi", "bir dizi:", "Bu haftanın dizisi —"],
  ])("%#", (films, subject, intro, preheader) => {
    const out = render({ films: films as PickFilm[] });
    expect(out.subject).toBe(subject);
    expect(out.text).toContain(`düşündüğüm ${intro}`);
    expect(out.html).toContain(preheader);
  });

  // `${kind}i` yazmak "dizii" üretirdi.
  it("iyelik eki lookup'tan gelir: 'dizisi', asla 'dizii'", () => {
    const { html } = render({ films: [series(), series({ title: "B" })] });
    expect(html).not.toContain("dizii");
  });

  it("listede olmayan sayı rakama düşer; mail 'undefined' demez", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => film({ title: `Film ${i}` }));
    const out = render({ films: eleven });
    expect(out.subject).toBe("Bu hafta için 11 film");
    expect(out.html + out.text + out.subject).not.toContain("undefined");
  });

  it("media_type yoksa (elle girilmiş eski satır) film varsayılır", () => {
    expect(render({ films: [film({ media_type: undefined })] }).subject).toBe("Bu hafta için bir film");
  });

  it("dizi başlıkta etiketlenir, film etiketlenmez", () => {
    const { text } = render({ films: [series(), film()] });
    expect(text).toContain("Chernobyl (2019 · dizi)");
    expect(text).toContain("Chungking Express (1994)");
  });
});

describe("selamlama", () => {
  it.each([
    ["beyza", "Selam Beyza, Tolga ben."],
    ["BEYZA", "Selam Beyza, Tolga ben."],
    // Türkçe locale şart: İngilizce locale "Ismail" ve "Isıl" verirdi.
    ["ismail", "Selam İsmail, Tolga ben."],
    ["ışıl", "Selam Işıl, Tolga ben."],
    ["İREM", "Selam İrem, Tolga ben."],
    // Bilinçli iç büyük harfler bozulmaz.
    ["Ayşe Nur", "Selam Ayşe Nur, Tolga ben."],
    ["McKenzie", "Selam McKenzie, Tolga ben."],
    ["  ", "Selam, Tolga ben."],
    ["", "Selam, Tolga ben."],
  ])("ad %j → %j", (name, greeting) => {
    expect(render({ name }).text.split("\n")[0]).toBe(greeting);
  });
});

describe("izleme linki", () => {
  const linkOf = (f: PickFilm) => hrefs(render({ films: [f] }).html)[0];

  it("v2 alanı (watch_url) önce, v1 (justwatch_url) yedek", () => {
    expect(linkOf(film({ watch_url: "https://v2.test/a", justwatch_url: "https://v1.test/a" }))).toBe("https://v2.test/a");
    expect(linkOf(film({ watch_url: undefined, justwatch_url: "https://v1.test/a" }))).toBe("https://v1.test/a");
  });

  // 7 Ağustos 2026 seçkisinde üç filmin "Nerede izlenir" satırı bu yüzden kaybolmuştu.
  it("şemasız değere https ekler", () => {
    expect(linkOf(film({ watch_url: "justwatch.com/tr/film/uzak" }))).toBe("https://justwatch.com/tr/film/uzak");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    // Host'u olan biçim nokta şartını geçer; onu yalnızca protokol denetimi durdurur.
    ["javascript:// + host", "javascript://example.com/%0Aalert(1)"],
    ["ftp:", "ftp://example.com/film.mkv"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["mailto:", "mailto:x@y.com"],
    ["noktasız host ('yok' notu)", "yok"],
    ["boş", "   "],
  ])("%s tıklanabilir linke DÖNÜŞMEZ; satır tamamen düşer", (_label, value) => {
    const out = render({ films: [film({ watch_url: value })] });
    expect(hrefs(out.html)).toHaveLength(2); // yalnızca panel + kapatma
    expect(out.html).not.toContain("Nerede izlenir");
    expect(out.text).not.toContain("Nerede izlenir");
  });
});

describe("platform öneki — yalnızca doğrulanmış (filtreli) yolda", () => {
  const prefixOf = (f: PickFilm) => {
    const line = render({ films: [f] }).text.split("\n").find((l) => l.includes("Nerede izlenir:"))!;
    return line.split("Nerede izlenir:")[0];
  };

  it.each([
    ["abonelik: platform adları", { offer_type: "subscription", providers: ["netflix", "mubi"] }, "Netflix, MUBI · "],
    ["ücretsiz", { offer_type: "free", providers: ["netflix"] }, "Ücretsiz · "],
    ["kiralık", { offer_type: "rent", providers: ["prime"] }, "Kiralık · "],
    ["satın alma da 'Kiralık' der", { offer_type: "buy", providers: ["prime"] }, "Kiralık · "],
    ["ek kanal", { offer_type: "addon", providers: ["prime"] }, "Prime Video · ek kanal · "],
    ["platformu bilinmeyen ek kanal", { offer_type: "addon", providers: [] }, "Ek kanal aboneliği · "],
    ["seçilenlerin dışında", { offer_type: "off_platform", providers: ["mubi"] }, "Seçtiklerinin dışında · "],
    // Ücretsiz yol / v1 satır: bilgi yok, iddia da yok.
    ["offer_type yok", {}, ""],
  ])("%s", (_label, fields, expected) => {
    expect(prefixOf(film(fields as Partial<PickFilm>))).toBe(expected);
  });

  // Yanlış bir platform adı yazmaktansa hiçbir şey yazmamak yeğdir.
  it("sözlükte olmayan slug sessizce düşer", () => {
    expect(prefixOf(film({ offer_type: "subscription", providers: ["bilinmeyen", "mubi"] }))).toBe("MUBI · ");
    expect(prefixOf(film({ offer_type: "subscription", providers: ["bilinmeyen"] }))).toBe("");
  });
});

describe("kapatma ve geri bildirim linkleri", () => {
  it("imzalı endpoint varsa tek dokunuş cümlesi kurulur", () => {
    const out = render();
    expect(out.html).toContain("buradan tek dokunuşla kapatabilirsin");
    expect(out.html).toContain("giriş yapmana gerek yok");
    expect(out.text).toContain("tek dokunuşla kapatabilirsin (giriş gerekmez)");
  });

  it("imzalı URL yoksa tercih sayfasına düşer ve tek dokunuş VAAT ETMEZ", () => {
    for (const unsubscribeUrl of [undefined, "", "javascript:void(0)"]) {
      const out = render({ unsubscribeUrl });
      expect(hrefs(out.html).at(-1)).toBe("https://lensestetik.com/account");
      expect(out.html).not.toContain("tek dokunuşla");
      expect(out.text).toContain("buradan kapatabilirsin: https://lensestetik.com/account");
    }
  });

  it("panel URL'i yoksa geri bildirim cümlesi linksiz kurulur", () => {
    const out = render({ dashboardUrl: undefined });
    expect(hrefs(out.html)).toHaveLength(4);
    expect(out.html).toContain("Panelde bu kartlara");
    expect(out.text).toContain("Panelde bu kartlara");
  });
});

describe("güvenlik ve sağlamlık", () => {
  it("eser adı, gerekçe ve isimdeki HTML'i kaçışlar", () => {
    const out = render({
      name: '<b>Ali</b>',
      films: [film({ title: 'Fargo <script>alert("x")</script>', blurb: "Tom & Jerry'nin <i>en iyisi</i>" })],
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<b>Ali</b>");
    expect(out.html).toContain("Fargo &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out.html).toContain("Tom &amp; Jerry&#39;nin &lt;i&gt;en iyisi&lt;/i&gt;");
  });

  it("linkteki tırnak özniteliği kıramaz", () => {
    const out = render({ films: [film({ watch_url: 'https://x.test/a"onmouseover="alert(1)' })] });
    expect(out.html).not.toContain('"onmouseover="');
  });

  it("yılı sayı olmayan filmde parantez basılmaz", () => {
    const { text, html } = render({ films: [film({ year: Number.NaN })] });
    expect(text).toContain("Chungking Express\n");
    expect(text).not.toContain("NaN");
    expect(html).not.toContain("NaN");
  });

  it("boş listede bile metin üretir, patlamaz", () => {
    const out = render({ films: [] });
    expect(out.subject).toBe("Bu hafta için 0 film");
    expect(out.text).toContain("Selam Beyza");
  });
});
