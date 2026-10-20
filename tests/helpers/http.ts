import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * `api/` altındaki Vercel fonksiyonları için sahte istek/yanıt.
 * Handler'lar yalnızca `url`, `headers`, `query`, `writeHead` ve `end` kullanıyor.
 */
export interface FakeResponse {
  status: number | null;
  headers: Record<string, string | number>;
  body: unknown;
  ended: boolean;
  writeHead(status: number, headers?: Record<string, string | number>): FakeResponse;
  end(body?: unknown): void;
}

export function fakeRes(): FakeResponse & ServerResponse {
  const res: FakeResponse = {
    status: null,
    headers: {},
    body: undefined,
    ended: false,
    writeHead(status, headers = {}) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    end(body) {
      res.body = body;
      res.ended = true;
    },
  };
  return res as FakeResponse & ServerResponse;
}

export function fakeReq(
  options: { url?: string; headers?: Record<string, string>; query?: Record<string, string | string[]> } = {},
): IncomingMessage & { query?: Record<string, string | string[]> } {
  return {
    url: options.url ?? "/",
    headers: options.headers ?? {},
    query: options.query,
  } as IncomingMessage & { query?: Record<string, string | string[]> };
}

/** PNG başlığından genişlik ve yükseklik (IHDR). */
export function pngSize(png: Buffer): { width: number; height: number } {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("PNG imzası yok");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
