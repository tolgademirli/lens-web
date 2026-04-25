import { createClient } from "@supabase/supabase-js";
import type { Report } from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchReport(id: string): Promise<Report | null> {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", id)
    .eq("is_public", true)
    .single();

  if (error) return null;
  return data as Report;
}

export async function analyzeAndCreateReport(
  books: string[],
  movies: string[],
  music: string[]
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("analyze", {
    body: { books, movies, music },
  });
  if (error) throw error;
  if (!data?.reportId) throw new Error("reportId dönmedi");
  return data.reportId as string;
}

export async function sendMagicLink(email: string, redirectTo: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
}

export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
