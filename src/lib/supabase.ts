import { createClient } from "@supabase/supabase-js";
import type { Report, DailyDiscovery, WorkEntry } from "./types";
import type { TasteDraft } from "./tasteDraft";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchReport(id: string): Promise<Report | null> {
  const { data: { session } } = await supabase.auth.getSession();

  let query = supabase.from("reports").select("*").eq("id", id);

  if (session) {
    query = query.or(`is_public.eq.true,user_id.eq.${session.user.id}`);
  } else {
    query = query.eq("is_public", true);
  }

  const { data, error } = await query.single();
  if (error) return null;
  return data as Report;
}

export async function updateReportVisibility(
  reportId: string,
  isPublic: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from("reports")
    .update({ is_public: isPublic })
    .eq("id", reportId);
  return !error;
}

export class AnalyzeError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/**
 * Sinyaller `analyze`'a yapılı gider: edinim yolu ve havuz id'si her nesnenin
 * içindedir. Eskiden paralel dizilerdi ve indeks kayması sessizce yanlış
 * `source` yazıyordu. Edge function eski string biçimini de kabul ediyor —
 * o yol yalnızca 60 dk TTL'deki bekleyen kayıtlar için.
 */
function toWire(entry: WorkEntry) {
  return {
    title: entry.title,
    creator: entry.creator,
    source: entry.source,
    work_id: entry.workId,
  };
}

export async function analyzeAndCreateReport(draft: TasteDraft): Promise<string> {
  const { data, error } = await supabase.functions.invoke("analyze", {
    body: {
      books: draft.books.map(toWire),
      movies: draft.movies.map(toWire),
      music: draft.music.map(toWire),
    },
  });

  if (error) {
    let message = "Bir hata oluştu. Lütfen tekrar deneyin.";
    let status = 500;
    try {
      const res: Response | undefined = (error as any).context;
      if (res) {
        status = res.status;
        const body = await res.json();
        if (body?.error) message = body.error;
      }
    } catch { /* ignore */ }
    throw new AnalyzeError(message, status);
  }

  if (!data?.reportId) throw new Error("reportId dönmedi");
  return data.reportId as string;
}

export async function sendMagicLink(email: string, redirectTo: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
}

export async function signInWithGoogle(redirectTo: string) {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

export async function fetchDailyDiscovery(): Promise<DailyDiscovery | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke("daily-discovery", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    // invoke() hata gövdesini yutar; edge function'ın döndürdüğü `code`
    // olmadan hangi aşamanın patladığı görünmüyor.
    let detail: unknown = null;
    try {
      detail = await (error as { context?: Response }).context?.json();
    } catch {
      /* gövde okunamadıysa sessiz geç */
    }
    console.error("[daily-discovery] başarısız:", detail ?? error);
    return null;
  }
  return data as DailyDiscovery;
}

export async function fetchUserReports(): Promise<Report[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data as Report[];
}
