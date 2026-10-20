/**
 * Edge function'ların kullandığı iki Deno yüzeyi: `Deno.env.get` ve `Deno.serve`.
 *
 * `serve` sunucu AÇMAZ; handler'ı yakalar. Test onu `edgeHandler()` ile alıp bir
 * `Request` ile çağırır (bkz. `tests/helpers/edge.ts`). Ortam değişkenleri
 * `process.env`'den okunur — test `vi.stubEnv(...)` ile verir, test bitince silinir.
 */
type Handler = (req: Request) => Response | Promise<Response>;

declare global {
  // eslint-disable-next-line no-var
  var __lensEdgeHandler: Handler | undefined;
}

globalThis.__lensEdgeHandler = undefined;

(globalThis as Record<string, unknown>).Deno = {
  env: {
    get: (name: string): string | undefined => process.env[name] || undefined,
  },
  serve: (handler: Handler) => {
    globalThis.__lensEdgeHandler = handler;
    return { finished: Promise.resolve() };
  },
};
