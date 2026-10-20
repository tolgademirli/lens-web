import { vi } from "vitest";

/**
 * Zincirlenebilir sahte Supabase istemcisi.
 *
 * `from("x").select().eq().maybeSingle()` zincirindeki HER metot kaydedilir ve
 * zincir `await` edildiğinde o tablonun yanıtlayıcısı çağrılır. Yanıtlayıcı sabit
 * bir sonuç ya da zincire bakıp karar veren bir fonksiyon olabilir:
 *
 *   const fake = fakeSupabase({
 *     user: { id: "u1" },
 *     tables: { reports: (q) => q.has("insert") ? { data: { id: "r1" } } : { count: 0 } },
 *     rpcs: { lens_blocked_works: { data: [] } },
 *   });
 *
 * TANIMSIZ tablo/RPC HATA verir — testin beklemediği bir veritabanı erişimi
 * sessizce `undefined` dönüp geçmesin.
 */
export interface QueryResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export interface QueryCall {
  kind: "from" | "rpc" | "function";
  name: string;
  /** RPC ya da function çağrısının argümanı. */
  args?: unknown;
  ops: { method: string; args: unknown[] }[];
  has(method: string): boolean;
  /** `method`in İLK çağrısının `index`. argümanı. */
  arg<T = unknown>(method: string, index?: number): T | undefined;
}

type Responder = QueryResult | ((call: QueryCall) => QueryResult | Promise<QueryResult>);

export interface FakeUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface FakeSupabaseConfig {
  /** `auth.getUser` / `auth.getSession` kimi dönsün. `null` = oturum yok. */
  user?: FakeUser | null;
  tables?: Record<string, Responder>;
  rpcs?: Record<string, Responder>;
  /** `functions.invoke(name)` yanıtları. */
  functions?: Record<string, Responder>;
}

function makeCall(kind: QueryCall["kind"], name: string, args?: unknown): QueryCall {
  const call: QueryCall = {
    kind,
    name,
    args,
    ops: [],
    has: (method) => call.ops.some((op) => op.method === method),
    arg: <T,>(method: string, index = 0) =>
      call.ops.find((op) => op.method === method)?.args[index] as T | undefined,
  };
  return call;
}

async function respond(responder: Responder | undefined, call: QueryCall): Promise<QueryResult> {
  if (responder === undefined) {
    throw new Error(`Sahte Supabase: test "${call.name}" (${call.kind}) erişimini beklemiyordu.`);
  }
  const result = typeof responder === "function" ? await responder(call) : responder;
  return { data: null, error: null, ...result };
}

export function fakeSupabase(config: FakeSupabaseConfig = {}) {
  const calls: QueryCall[] = [];
  const user = config.user ?? null;

  /** Kaydeden ve `await` edilince yanıtlayan zincir. */
  function chain(call: QueryCall, responder: Responder | undefined): unknown {
    calls.push(call);
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
              respond(responder, call).then(resolve, reject);
          }
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            call.ops.push({ method: prop, args });
            return builder;
          };
        },
      },
    );
    return builder;
  }

  const client = {
    from: vi.fn((table: string) => chain(makeCall("from", table), config.tables?.[table])),
    rpc: vi.fn((name: string, args?: unknown) => chain(makeCall("rpc", name, args), config.rpcs?.[name])),
    functions: {
      invoke: vi.fn(async (name: string, options?: unknown) => {
        const call = makeCall("function", name, options);
        calls.push(call);
        return respond(config.functions?.[name], call);
      }),
    },
    auth: {
      getUser: vi.fn(async (_token?: string) =>
        user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid" } },
      ),
      getSession: vi.fn(async () => ({
        data: { session: user ? { user, access_token: "test-access-token" } : null },
        error: null,
      })),
      signOut: vi.fn(async (_options?: unknown) => ({ error: null })),
      // Gerçeği gibi: abone olunca mevcut oturumla bir kez ateşlenir (INITIAL_SESSION).
      onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
        queueMicrotask(() => callback("INITIAL_SESSION", user ? { user, access_token: "test-access-token" } : null));
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOtp: vi.fn(async (_options?: unknown) => ({ data: {}, error: null })),
      signInWithOAuth: vi.fn(async (_options?: unknown) => ({ data: {}, error: null })),
      // Varsayılan: kod kabul edilir. Reddi sınayan test `mockResolvedValue` ile değiştirir.
      verifyOtp: vi.fn(async (_params?: unknown) => ({
        data: { user, session: user ? { user, access_token: "test-access-token" } : null },
        error: null as unknown,
      })),
      admin: {
        deleteUser: vi.fn(async (_id: string) => ({ data: {}, error: null as unknown })),
        getUserById: vi.fn(async (_id: string) => ({ data: { user }, error: null as unknown })),
      },
    },
  };

  return {
    client,
    calls,
    /** Bir tabloya / RPC'ye yapılan çağrılar, sırasıyla. */
    callsTo: (name: string) => calls.filter((call) => call.name === name),
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;
