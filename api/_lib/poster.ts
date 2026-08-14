/**
 * Poster kompozisyonu — üç format tek iskeletten.
 *
 * İskelet sabit (üst çubuk / hero / özet / karşıtlıklar / [palet] / alt çubuk),
 * renk ve içerik rapordan gelir. Format farkları tek bir ölçü tablosunda
 * toplandı; kompozisyon kodu formatı bilmiyor.
 *
 * Story'de renk paleti YOK ve alt bant boş bırakılıyor — orası kullanıcının
 * Instagram link sticker'ını koyacağı yer. Story'nin görevi raporu anlatmak
 * değil, karşı tarafa "bu ne, ben de yapmak istiyorum" dedirtmek.
 */
import type { Report } from "../../src/lib/types.js";
import { box, h, text, type Node } from "./h.js";
import { derivePosterTheme, type PosterTheme } from "./color.js";
import { fitText, measure, wrapText } from "./fonts.js";
import { archetypeLayers, contrastPairs, trUpper, truncateWords } from "./text.js";

export type PosterFormat = "story" | "feed" | "og";

interface Metrics {
  width: number;
  height: number;
  pad: number;
  padTop: number;
  padBottom: number;
  /** Üst çubuk ile hero arasındaki boşluk. */
  heroTop: number;
  heroMax: number;
  heroMin: number;
  heroLines: number;
  summaryTop: number;
  summarySize: number;
  contrastsTop: number;
  contrastSize: number;
  paletteTop: number;
  showPalette: boolean;
  labelSize: number;
  footerSize: number;
  swatch: number;
}

const METRICS: Record<PosterFormat, Metrics> = {
  story: {
    width: 1080, height: 1920, pad: 81, padTop: 132, padBottom: 300,
    heroTop: 250, heroMax: 190, heroMin: 78, heroLines: 2,
    summaryTop: 58, summarySize: 40,
    contrastsTop: 92, contrastSize: 30,
    paletteTop: 0, showPalette: false,
    labelSize: 22, footerSize: 34, swatch: 46,
  },
  feed: {
    width: 1080, height: 1350, pad: 81, padTop: 96, padBottom: 88,
    heroTop: 140, heroMax: 156, heroMin: 68, heroLines: 2,
    summaryTop: 46, summarySize: 37,
    contrastsTop: 74, contrastSize: 28,
    paletteTop: 72, showPalette: true,
    labelSize: 21, footerSize: 32, swatch: 44,
  },
  og: {
    width: 1200, height: 630, pad: 64, padTop: 52, padBottom: 48,
    heroTop: 42, heroMax: 92, heroMin: 38, heroLines: 2,
    summaryTop: 24, summarySize: 24,
    contrastsTop: 30, contrastSize: 20,
    paletteTop: 28, showPalette: true,
    labelSize: 16, footerSize: 22, swatch: 30,
  },
};

const HERO_FONT = "playfair-italic-700" as const;
/**
 * Şartname 0.95-1.0 aralığı veriyordu; üst sınıra yakın duruluyor çünkü
 * Türkçede iniş ve çıkışlar aynı anda kalabalıklaşıyor: "Kayıp Nesil / Tanığı"
 * satırlarında p'nin kuyruğu ile ğ'nin şapkası 0.95'te birbirine değiyordu.
 * Referanstaki sıkı hissi koruyan ama çakışmayan değer bu.
 */
const HERO_LINE_HEIGHT = 1.0;
const QUALIFIER_RATIO = 0.35;
const CONTRAST_TRACKING = 0.34; // em

/**
 * Karşıtlık oku, SVG olarak.
 *
 * "⟷" (U+27F7) ne Playfair'de ne Inter'de var — metin olarak yazılsa tofu
 * kutusu (□) çıkardı ve bu kabul edilemez. Yazı tipinden bağımsız olsun diye
 * path olarak çiziliyor; rengi tema ile geliyor.
 */
function arrowDataUri(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24" width="120" height="24">` +
    `<g fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M8 12 H112"/><path d="M16.5 6 L8 12 L16.5 18"/><path d="M103.5 6 L112 12 L103.5 18"/>` +
    `</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/*
 * FİLM GRAIN YOK — bu bir eksiklik değil, ölçülmüş bir karar.
 *
 * Şartname "çok hafif film grain, opaklık ~%4" istiyordu ve feTurbulence ile
 * çalışıyordu (resvg SVG filtrelerini destekliyor). Ama grain her pikseli
 * oynattığı için PNG sıkıştırmasını tamamen kırıyor. Ölçüm:
 *
 *     Story 1080×1920   grain %4 → 2273 KB      grain yok → 373 KB
 *     OG    1200×630    grain %4 →  900 KB      grain yok → 155 KB
 *
 * OG'de zaten taşınamazdı: WhatsApp gibi istemciler o boyuttaki bir og:image'ı
 * çoğu zaman hiç açmıyor, yani grain uğruna link önizlemesinin tamamı gidiyor.
 * Story/Feed'de ise grain'i gören yok: paylaşım yolundaki her kanal (Instagram,
 * WhatsApp) görseli yeniden JPEG'e çeviriyor ve o sıkıştırma ince grain'i zaten
 * yok ediyor. 1,9 MB'ı hiç kimseye ulaşmayan bir doku için ödemek anlamsızdı.
 *
 * Bilinen bedeli: grain aynı zamanda dither görevi görüyordu. Grain'siz, koyu
 * gradyanlarda en uzun düz koşu 62 px (1 seviyelik sıçramalarla) — iyi bir OLED
 * ekranda hafif bant görülebilir. Kabul edildi, çünkü aynı yeniden sıkıştırma
 * bunu da bulanıklaştırıyor. Bant şikâyeti gelirse çözüm grain'i geri açmak
 * değil, glow duraklarını çoğaltmak.
 */

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

function topBar(m: Metrics, t: PosterTheme): Node {
  return box(
    { flexDirection: "column" },
    box(
      { justifyContent: "space-between", alignItems: "flex-end", width: "100%" },
      text(
        {
          fontFamily: "Inter", fontSize: m.labelSize + 2, fontWeight: 600,
          letterSpacing: m.labelSize * 0.26, color: t.text,
        },
        "LENS"
      ),
      text(
        {
          fontFamily: "Inter", fontSize: m.labelSize - 2, fontWeight: 500,
          letterSpacing: (m.labelSize - 2) * 0.26, color: t.textMuted,
        },
        "ESTETİK KİMLİK"
      )
    ),
    box({ height: 1, width: "100%", marginTop: m.labelSize * 0.9, backgroundColor: t.rule })
  );
}

/** Hero — tek ya da iki katman. Punto binary search ile bulunmuş halde gelir. */
function hero(m: Metrics, t: PosterTheme, report: Report): Node {
  const layers = archetypeLayers(report.hero);
  const innerWidth = m.width - m.pad * 2;

  const fit = fitText(layers.core, HERO_FONT, {
    maxWidth: innerWidth,
    maxLines: m.heroLines,
    min: m.heroMin,
    max: m.heroMax,
  });

  const qualifierSize = Math.max(Math.round(fit.size * QUALIFIER_RATIO), m.labelSize + 8);

  const children: Node[] = [];

  if (layers.twoLayer) {
    // Üst katman uzunsa kendi içinde sarsın; hero'nun puntosunu etkilemez.
    const qLines = wrapText(layers.qualifier, "inter-400", qualifierSize, innerWidth);
    children.push(
      box(
        { flexDirection: "column", marginBottom: Math.round(fit.size * 0.16) },
        ...qLines.map((line) =>
          text(
            {
              fontFamily: "Inter", fontSize: qualifierSize, fontWeight: 400,
              lineHeight: 1.15, color: t.textMuted,
            },
            line
          )
        )
      )
    );
  }

  children.push(
    box(
      { flexDirection: "column" },
      ...fit.lines.map((line) =>
        text(
          {
            fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700,
            fontSize: fit.size, lineHeight: HERO_LINE_HEIGHT, color: t.text,
          },
          line
        )
      )
    )
  );

  return box({ flexDirection: "column" }, ...children);
}

function summary(m: Metrics, t: PosterTheme, report: Report): Node | null {
  const raw = (report.hero?.summary ?? "").trim();
  if (!raw) return null;

  const innerWidth = m.width - m.pad * 2;

  // Hedef iki satır. Sığmıyorsa önce punto düşer, sonra ÜÇÜNCÜ SATIRA izin
  // verilir — kırpma en son çare.
  //
  // Şartname "2 satırı geçmeyen tek cümle" diyordu ama üretici bazen uzun bir
  // tek cümle yazıyor ("Hem aydının iç hesaplaşmasını hem de toprağın sessiz
  // direncini aynı ciddiyet ve merakla takip eden, ..."). Onu iki satıra
  // zorlamak cümleyi virgülün ortasında kesiyordu ve bu, üç satırdan çok daha
  // kötü duruyor. Story'de zaten dikey alan var.
  const MIN_SIZE = m.summarySize - 10;
  let size = m.summarySize;
  let lines = wrapText(raw, "inter-400", size, innerWidth);
  while (lines.length > 2 && size > MIN_SIZE) {
    size -= 2;
    lines = wrapText(raw, "inter-400", size, innerWidth);
  }
  if (lines.length > 3) {
    const perLine = Math.ceil(raw.length / lines.length);
    lines = wrapText(truncateWords(raw, perLine * 3), "inter-400", size, innerWidth).slice(0, 3);
  }

  return box(
    { flexDirection: "column", marginTop: m.summaryTop },
    ...lines.map((line) =>
      text(
        { fontFamily: "Inter", fontSize: size, fontWeight: 400, lineHeight: 1.45, color: t.textMuted },
        line
      )
    )
  );
}

function contrasts(m: Metrics, t: PosterTheme, report: Report): Node | null {
  const pairs = contrastPairs(report.contrasts);
  if (pairs.length === 0) return null;

  const innerWidth = m.width - m.pad * 2;

  // Etiketler `poleLabel` sayesinde kısa ve tek kelime, ama satır yine de
  // taşabilir (iki uzun kelime + ok + geniş harf aralığı). Taşarsa punto
  // küçülür; SARMAZ — sarmış bir kutup etiketi posterin düzenini bozuyor.
  let size = m.contrastSize;
  const rowWidth = (fontSize: number): number => {
    const track = fontSize * CONTRAST_TRACKING;
    const gap = fontSize * 1.8 + fontSize * 3.4; // iki yan boşluk + ok genişliği
    return Math.max(
      ...pairs.map(
        (p) =>
          measure(p.left, "inter-500", fontSize, track) +
          measure(p.right, "inter-500", fontSize, track) +
          gap
      )
    );
  };
  while (size > m.contrastSize * 0.6 && rowWidth(size) > innerWidth) size -= 1;

  const tracking = size * CONTRAST_TRACKING;
  // Oklar alt alta hizalansın diye sol sütun sabit genişlikte: en uzun sol
  // etiket ne kadarsa o kadar. Referansta iki satırın oku aynı x'te duruyor.
  const leftColumn = Math.max(
    ...pairs.map((p) => measure(p.left, "inter-500", size, tracking))
  );
  const arrow = arrowDataUri(t.textMuted);

  return box(
    { flexDirection: "column", marginTop: m.contrastsTop },
    ...pairs.map((pair, i) =>
      box(
        { alignItems: "center", marginTop: i === 0 ? 0 : size * 0.85 },
        box(
          { width: Math.ceil(leftColumn) },
          text(
            {
              fontFamily: "Inter", fontSize: size, fontWeight: 500,
              letterSpacing: tracking, color: t.text,
            },
            pair.left
          )
        ),
        h("img", {
          src: arrow,
          width: Math.round(size * 3.4),
          height: Math.round(size * 0.68),
          style: { marginLeft: size * 0.9, marginRight: size * 0.9 },
        }),
        text(
          {
            fontFamily: "Inter", fontSize: size, fontWeight: 500,
            letterSpacing: tracking, color: t.text,
          },
          pair.right
        )
      )
    )
  );
}

/** Renk paleti — SADECE Feed ve OG'de. Hex kodu poster üzerinde asla yazılmaz. */
function palette(m: Metrics, t: PosterTheme, report: Report): Node | null {
  if (!m.showPalette) return null;
  const colors = (report.texture?.colors ?? []).slice(0, 3);
  if (colors.length === 0) return null;

  return box(
    { alignItems: "center", marginTop: m.paletteTop },
    ...colors.flatMap((c, i) => {
      const item = box(
        { alignItems: "center" },
        box({
          width: m.swatch, height: m.swatch, borderRadius: Math.round(m.swatch * 0.18),
          backgroundColor: c.hex,
        }),
        text(
          {
            fontFamily: "Inter", fontSize: Math.round(m.swatch * 0.5), fontWeight: 400,
            color: t.text, marginLeft: Math.round(m.swatch * 0.32),
          },
          c.name
        )
      );
      if (i === 0) return [item];
      return [
        box({
          width: 1, height: Math.round(m.swatch * 0.72),
          marginLeft: Math.round(m.swatch * 0.5), marginRight: Math.round(m.swatch * 0.5),
          backgroundColor: t.rule,
        }),
        item,
      ];
    })
  );
}

function bottomBar(m: Metrics, t: PosterTheme): Node {
  return box(
    { flexDirection: "column", width: "100%" },
    box({ height: 1, width: "100%", backgroundColor: t.rule }),
    box(
      {
        justifyContent: "space-between", alignItems: "flex-start",
        width: "100%", marginTop: Math.round(m.footerSize * 0.7),
      },
      text(
        { fontFamily: "Inter", fontSize: m.footerSize, fontWeight: 600, color: t.text },
        "Lens."
      ),
      box(
        { flexDirection: "column", alignItems: "flex-end" },
        text(
          { fontFamily: "Inter", fontSize: m.footerSize, fontWeight: 600, color: t.text },
          "lensestetik.com"
        ),
        text(
          {
            fontFamily: "Inter", fontSize: Math.round(m.footerSize * 0.56), fontWeight: 400,
            color: t.textMuted, marginTop: Math.round(m.footerSize * 0.18),
          },
          "sen hangisisin?"
        )
      )
    )
  );
}

/** Arka plan: düz baz + iki diyagonal odak. */
function background(m: Metrics, t: PosterTheme): Node[] {
  return [
    box({
      position: "absolute", top: 0, left: 0, width: m.width, height: m.height,
      backgroundColor: t.background,
    }),
    box({
      position: "absolute", top: 0, left: 0, width: m.width, height: m.height,
      backgroundImage:
        `radial-gradient(120% 85% at 88% 6%, ${hexToRgba(t.glowTop, 0.85)} 0%, ` +
        `${hexToRgba(t.glowTop, 0.34)} 34%, ${hexToRgba(t.glowTop, 0)} 68%)`,
    }),
    box({
      position: "absolute", top: 0, left: 0, width: m.width, height: m.height,
      backgroundImage:
        `radial-gradient(120% 80% at 8% 96%, ${hexToRgba(t.glowBottom, 0.8)} 0%, ` +
        `${hexToRgba(t.glowBottom, 0.3)} 36%, ${hexToRgba(t.glowBottom, 0)} 70%)`,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Birleştirme
// ---------------------------------------------------------------------------

export function posterTree(
  report: Report,
  format: PosterFormat
): { node: Node; metrics: Metrics; theme: PosterTheme } {
  const m = METRICS[format];
  const theme = derivePosterTheme(report.texture?.colors);

  const node = box(
    {
      position: "relative", width: m.width, height: m.height,
      flexDirection: "column", alignItems: "flex-start",
      paddingTop: m.padTop, paddingBottom: m.padBottom,
      paddingLeft: m.pad, paddingRight: m.pad,
      backgroundColor: theme.background,
    },
    ...background(m, theme),
    box(
      { position: "relative", flexDirection: "column", width: m.width - m.pad * 2, flexGrow: 1 },
      topBar(m, theme),
      box({ marginTop: m.heroTop }),
      hero(m, theme, report),
      summary(m, theme, report),
      contrasts(m, theme, report),
      palette(m, theme, report),
      // Karşıtlıklardan/paletten sonrası boş kalır. Story'de bu bant link
      // sticker'ının yeri — tasarım oraya bir şey basmıyor.
      box({ flexGrow: 1, minHeight: 40 }),
      bottomBar(m, theme)
    )
  );

  return { node, metrics: m, theme };
}

/** Rapor okunamadığında dönen jenerik marka posteri — içerik sızdırmaz. */
export function genericTree(format: PosterFormat): { node: Node; metrics: Metrics } {
  const m = METRICS[format];
  const theme: PosterTheme = {
    background: "#0d0d10", glowTop: "#241f2e", glowBottom: "#1a1d24",
    text: "#f2ede0", textMuted: "#a8a294", rule: "rgba(242, 237, 224, 0.22)",
    measured: { text: 0, muted: 0 },
  };

  const node = box(
    {
      position: "relative", width: m.width, height: m.height,
      flexDirection: "column",
      paddingTop: m.padTop, paddingBottom: m.padBottom,
      paddingLeft: m.pad, paddingRight: m.pad,
      backgroundColor: theme.background,
    },
    ...background(m, theme),
    box(
      { position: "relative", flexDirection: "column", width: m.width - m.pad * 2, flexGrow: 1 },
      topBar(m, theme),
      box({ flexGrow: 1 }),
      text(
        {
          fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700,
          fontSize: Math.round(m.heroMax * 0.62), lineHeight: HERO_LINE_HEIGHT, color: theme.text,
        },
        "Estetik Kimlik"
      ),
      text(
        {
          fontFamily: "Inter", fontSize: m.summarySize, fontWeight: 400,
          color: theme.textMuted, marginTop: m.summaryTop,
        },
        trUpper("sen hangisisin?")
      ),
      box({ flexGrow: 1 }),
      bottomBar(m, theme)
    )
  );

  return { node, metrics: m };
}

export function formatOf(value: unknown): PosterFormat {
  return value === "feed" || value === "og" ? value : "story";
}
