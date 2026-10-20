/**
 * Edge function'lardaki `https://esm.sh/@supabase/supabase-js@2` importunun testteki
 * karşılığı (yönlendirme: `vitest.config.ts` → `edgeFunctions`).
 *
 * Varsayılan olarak `createClient` HATA verir: istemci beklemeyen bir test (ör.
 * "token geçersizse veritabanına hiç gidilmez") sessizce istemci kurmuş olmasın.
 */
type Factory = (url: string, key: string, options?: unknown) => unknown;

const refuse: Factory = () => {
  throw new Error(
    "Bu test bir Supabase istemcisi beklemiyordu. Bekliyorsa önce useEdgeSupabase(fake.client) çağır.",
  );
};

let factory: Factory = refuse;

/** `createClient` çağrılarının argümanları — "hangi anahtarla kuruldu" denetimi için. */
export const createClientCalls: { url: string; key: string; options?: unknown }[] = [];

export function createClient(url: string, key: string, options?: unknown): unknown {
  createClientCalls.push({ url, key, options });
  return factory(url, key, options);
}

/** Bundan sonra kurulan her istemci `client` olur. */
export function useEdgeSupabase(client: unknown): void {
  factory = () => client;
}

export function resetEdgeSupabase(): void {
  factory = refuse;
  createClientCalls.length = 0;
}
