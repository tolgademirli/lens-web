import { vi } from "vitest";

/**
 * Edge function testlerinin ortak araçları.
 *
 * Kalıp:
 *   import * as mod from "../../supabase/functions/analyze/index.ts";
 *   const { parseEntry } = internals(mod);     // export edilmeyen saf fonksiyonlar
 *   const handler = edgeHandler();             // Deno.serve'e verilen handler
 */

/** `index.ts`'in export etmediği üst düzey bildirimler (bkz. vitest.config.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function internals(mod: unknown): Record<string, any> {
  const exposed = (mod as { __internals?: Record<string, unknown> }).__internals;
  if (!exposed) throw new Error("__internals yok: dosya supabase/functions/<ad>/index.ts mi?");
  return exposed;
}

/** Test dosyasının import ettiği edge function'ın HTTP handler'ı. */
export function edgeHandler(): (req: Request) => Promise<Response> {
  const handler = globalThis.__lensEdgeHandler;
  if (!handler) throw new Error("Deno.serve çağrılmadı: önce edge function'ı import et.");
  return async (req) => handler(req);
}

/** Edge function'ların beklediği ortam; `extra` ile eklenir ya da ezilir. */
export function stubEdgeEnv(extra: Record<string, string> = {}): void {
  const base: Record<string, string> = {
    SUPABASE_URL: "http://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ANTHROPIC_API_KEY: "test-anthropic",
  };
  for (const [name, value] of Object.entries({ ...base, ...extra })) vi.stubEnv(name, value);
}

export function request(
  method: string,
  options: { url?: string; headers?: Record<string, string>; body?: unknown } = {},
): Request {
  const { url = "http://edge.test/fn", headers = {}, body } = options;
  return new Request(url, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Oturumlu POST — çoğu handler testinin başlangıcı. */
export function authedPost(body: unknown, headers: Record<string, string> = {}): Request {
  return request("POST", { body, headers: { Authorization: "Bearer test-jwt", ...headers } });
}

/** Claude Messages API yanıtı biçiminde sahte `Response`. */
export function claudeResponse(text: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", ...extra }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
