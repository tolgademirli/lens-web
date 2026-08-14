import { defineConfig, loadEnv, type Plugin } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

/**
 * Geliştirmede `api/` altındaki Vercel fonksiyonlarını Vite'ın sunucusuna bağlar.
 *
 * Production'da bu yolları Vercel karşılıyor; Vite'ın kendi dev sunucusu
 * `/api/*` diye bir şey bilmiyor ve poster önizlemesi lokalde 404 alıyordu.
 * Ayrı bir `vercel dev` süreci çalıştırmak yerine köprü buraya kondu, çünkü
 * repo'nun belgeli akışı tek komut: `npm run dev:local`.
 *
 * Yalnızca dev sunucusunda çalışır (`apply: 'serve'`) — build çıktısına hiçbir
 * şey girmez. Modüller her istekte taze yüklenir ki fonksiyonu düzenleyince
 * sunucuyu yeniden başlatmak gerekmesin.
 */
function apiRoutes(env: Record<string, string>): Plugin {
  return {
    name: 'lens-api-dev',
    apply: 'serve',
    configureServer(server) {
      // Fonksiyonlar `process.env`den okuyor (production'da Vercel öyle
      // veriyor). Vite ise .env dosyalarını yalnızca `import.meta.env`e
      // koyuyor — köprü kurulmazsa lokalde Supabase anahtarları boş gelir ve
      // her poster isteği sessizce 404 döner.
      for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
        if (env[key]) process.env[key] = env[key]
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        const { pathname, searchParams } = new URL(url, 'http://localhost')
        const segments = pathname.replace(/^\/api\//, '').split('/').filter(Boolean)

        // /api/poster/:id ve /api/og/:id dinamik; gerisi düz dosya.
        let modulePath: string
        const query: Record<string, string> = Object.fromEntries(searchParams)
        if (segments.length === 2 && (segments[0] === 'poster' || segments[0] === 'og')) {
          modulePath = `/api/${segments[0]}/[reportId].ts`
          query.reportId = segments[1]
        } else {
          modulePath = `/api/${segments.join('/')}.ts`
        }

        try {
          const mod = await server.ssrLoadModule(modulePath)
          Object.assign(req, { query })
          await mod.default(req, res)
        } catch (err) {
          server.config.logger.error(`[lens-api-dev] ${pathname} çalıştırılamadı: ${err}`)
          if (!res.headersSent) res.statusCode = 500
          res.end()
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    apiRoutes(loadEnv(mode, process.cwd(), '')),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
}))
