/**
 * Poster/OG endpoint'leri için rapor okuma.
 *
 * GİZLİLİK BURADA KOD İLE DEĞİL, RLS İLE KORUNUYOR. İstemcinin token'ı varsa
 * onunla, yoksa anon anahtarıyla client kuruluyor ve kararı veritabanı
 * veriyor: `is_public = true` ya da `auth.uid() = user_id`. Bu yüzden
 * `SUPABASE_SERVICE_ROLE_KEY` Vercel ortamına HİÇ konmuyor — service role ile
 * okusaydık her endpoint'te gizlilik kontrolünü elle yazmak zorunda kalırdık
 * ve bir gün biri unuturdu.
 */
import { createClient } from "@supabase/supabase-js";
import type { Report } from "../../src/lib/types.js";

function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return "";
}

const SUPABASE_URL = () => env("SUPABASE_URL", "VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY = () => env("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

/** `Authorization: Bearer <jwt>` başlığından token'ı çıkarır. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1] : null;
}

/**
 * Raporu getirir. Erişilemiyorsa (yok / özel / anahtar eksik) `null`.
 *
 * Çağıran taraf `null` ile "yok" ve "yetkin yok" arasında ayrım YAPMAMALI:
 * özel bir raporun varlığını 403 ile doğrulamak da bir sızıntıdır.
 */
export async function loadReport(id: string, accessToken?: string | null): Promise<Report | null> {
  const url = SUPABASE_URL();
  const key = SUPABASE_ANON_KEY();
  if (!url || !key) {
    console.error("[poster] Supabase ortam değişkenleri eksik");
    return null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });

  const { data, error } = await supabase.from("reports").select("*").eq("id", id).single();
  if (error || !data) return null;
  return data as Report;
}
