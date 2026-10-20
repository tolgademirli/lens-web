import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Edge function'ları (Deno) Node'da test edilebilir kılan köprü.
 *
 * PRODUCTION KODUNA DOKUNMAZ ve bu bilinçli: `supabase/functions/**` altındaki
 * hiçbir dosya test edilebilsin diye değişmedi. İki engel burada aşılıyor:
 *
 *   1. `https://esm.sh/@supabase/supabase-js@2` importu Node'da çözülemez →
 *      `tests/helpers/edge-supabase.ts`'e yönlenir. Gerçek istemci HİÇ kurulmaz;
 *      test sahte istemciyi oradan verir. Yönlendirme `resolveId` ile YAPILAMAZ:
 *      Vite ağ URL'lerini eklentilere sormadan dışsallaştırıyor, o yüzden
 *      belirteç kaynakta yeniden yazılıyor.
 *   2. `index.ts` içindeki saf fonksiyonlar (`parseEntry`, `classify`, ...) export
 *      edilmiyor → dosyanın sonuna `__internals` eklenir. Getter'lar canlı
 *      bağlamadır; var olmayan bir ad ancak ERİŞİLDİĞİNDE hata verir, yani tarama
 *      bir prompt metnindeki satırı yanlışlıkla ad sanarsa hiçbir şey bozulmaz.
 *
 * `Deno.serve` / `Deno.env` için bkz. `tests/setup/deno.ts`.
 */
const EDGE_SUPABASE = "lens-edge-supabase";

function edgeFunctions(): Plugin {
  const isEdge = (id: string) => id.includes("/supabase/functions/");
  const isEntry = (id: string) => /\/supabase\/functions\/[^/]+\/index\.ts$/.test(id);
  const remoteSupabase = /(["'])https:\/\/esm\.sh\/@supabase\/supabase-js[^"']*\1/g;
  const declaration =
    /^(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|class)\s+([A-Za-z_$][\w$]*))/gm;

  return {
    name: "lens-edge-functions",
    enforce: "pre",
    transform(code, rawId) {
      const id = rawId.replace(/\\/g, "/").split("?")[0];
      if (!isEdge(id)) return null;

      let out = code.replace(remoteSupabase, JSON.stringify(EDGE_SUPABASE));
      if (isEntry(id)) {
        const names = new Set<string>();
        for (const match of code.matchAll(declaration)) names.add(match[1] ?? match[2]);
        const getters = [...names].map((name) => `get ${name}() { return ${name}; }`).join(", ");
        // Getter'lar kapsam raporuna "fonksiyon" diye girmesin. `@preserve` şart:
        // esbuild yorumları siler, kapsam aracı ipucunu ancak kalırsa görür.
        out +=
          `\n/* v8 ignore start -- @preserve */\n` +
          `export const __internals = { ${getters} };\n` +
          `/* v8 ignore stop -- @preserve */\n`;
      }
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [edgeFunctions()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      [EDGE_SUPABASE]: path.resolve(root, "tests/helpers/edge-supabase.ts"),
    },
  },

  // Bileşen testleri (.tsx) için. Test dosyaları tsconfig'in `include`'unda değil;
  // JSX dönüşümü oradan çıkarılmasın, burada açıkça dursun.
  esbuild: { jsx: "automatic" },

  // `.env.local` PRODUCTION Supabase ve PostHog anahtarlarını taşıyor ve Vite onu
  // her modda yükler. Testler o dosyayı hiç görmemeli: bir mock unutulduğunda
  // gerçek projeye istek atan bir "unit test" olurdu. Değerler aşağıda sabit.
  envDir: false,

  test: {
    env: {
      VITE_SUPABASE_URL: "http://lens.test",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_POSTHOG_KEY: "",
      VITE_POSTHOG_HOST: "",
    },
    // Varsayılan (çekirdek sayısı kadar işçi) 8 GB'lık makinede jsdom'u aynı anda
    // 8 kez yükleyip belleği tüketiyor ve işçiler zaman aşımına düşüyordu
    // ("Failed to start forks worker"). 3 işçi hem kararlı hem yeterince hızlı.
    maxWorkers: 3,
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,

    projects: [
      {
        extends: true,
        test: {
          name: "web",
          environment: "jsdom",
          include: ["tests/lib/**/*.test.ts", "tests/ui/**/*.test.tsx"],
          setupFiles: ["tests/setup/common.ts", "tests/setup/dom.ts"],
          // Bileşen testleri büyük bir import ağacını (Radix, lucide, motion) ilk kez
          // yüklerken tam koşunun yükü altında 5 sn'yi aşabiliyor. Zaman aşımına düşen
          // bir bileşen testi arkasında yarım bir çizim bırakır ve SONRAKİ testleri de
          // düşürür — bir kez böyle 14 test birden düştü. Pay bu yüzden geniş.
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/{api,functions,guards}/**/*.test.ts"],
          setupFiles: ["tests/setup/common.ts", "tests/setup/deno.ts"],
        },
      },
    ],

    coverage: {
      provider: "v8",
      // `tmp/` zaten .gitignore'da (üretilebilir çıktıların yeri).
      reportsDirectory: "tmp/coverage",
      reporter: ["text-summary", "json", "json-summary"],
      // Bileşenler de ÖLÇÜLÜR ama tarama onları ayrı raporlar (scripts/unit-test-scan.mjs):
      // bileşen testi yalnızca kapılar için yazılıyor, çoğu dosyanın testsiz olması beklenen durum.
      include: [
        "src/lib/**/*.ts",
        "api/**/*.ts",
        "supabase/functions/**/*.ts",
        "src/app/**/*.{ts,tsx}",
        "src/pages/**/*.tsx",
        "src/main.tsx",
      ],
      // ui/ ve figma/ hazır (shadcn / Figma Make) bileşenler; bizim mantığımız değil.
      exclude: ["src/lib/types.ts", "src/app/components/ui/**", "src/app/components/figma/**"],
    },
  },
});
