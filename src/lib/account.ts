import { supabase } from "./supabase";
import { clearLibraryStash } from "./pendingLibrary";
import { clearPendingReport } from "./pendingReport";
import { clearSessionDraft } from "./tasteDraft";

/**
 * Oturumdaki kullanıcının hesabını ve Lens'teki bütün kayıtlarını kalıcı olarak
 * siler. Neyin silineceği burada ya da edge function'da DEĞİL, veritabanında
 * tanımlı (CASCADE + `lens_purge_user_orphans`) — bkz.
 * `supabase/functions/delete-account`.
 *
 * Başarıda bu cihazdaki izler de temizlenir: oturum ve yarım kalmış taslaklar.
 * Taslak 60 dakika yaşıyor; silinmiş bir hesabın eser listesi aynı tarayıcıda
 * bir sonraki girişte rapora dönüşmemeli.
 */
export async function deleteAccount(): Promise<boolean> {
  const { error } = await supabase.functions.invoke("delete-account", { method: "POST" });
  if (error) {
    console.error("[delete-account] başarısız:", error);
    return false;
  }

  // `local`: sunucudaki oturumlar kullanıcıyla birlikte gitti, kapatılacak başka
  // cihaz kalmadı. Geriye yalnızca bu tarayıcıdaki kopyayı atmak kalıyor.
  await supabase.auth.signOut({ scope: "local" });

  clearSessionDraft();
  clearPendingReport();
  clearLibraryStash();
  return true;
}
