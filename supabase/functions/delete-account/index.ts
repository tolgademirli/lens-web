// delete-account: oturumu açık kullanıcının KENDİ hesabını kalıcı olarak siler.
//
// Tek işi kimliği doğrulayıp auth.users satırını silmek. Verinin kendisi BURADA
// silinmez: reports, user_works, list_items, discovery_feedback... hepsi
// veritabanında ON DELETE CASCADE ile, yabancı anahtarın ulaşamadığı satırlar da
// auth.users üzerindeki `lens_purge_user_orphans` trigger'ı ile gider
// (20261010120000_account_deletion.sql). Böylece "bir kullanıcıyı silmek" tek
// tanıma sahip: bu fonksiyon, Supabase paneli ve SQL aynı sonucu verir.
// Buraya tablo tablo DELETE ekleme — ikinci bir liste ilk yeni tabloda eskir.
//
// Gövde ALMAZ: kimin silineceği yalnızca JWT'den okunur. Parametreyle user_id
// kabul etmek, oturumu olan herkese başkasını silme yolu açardı.
//
// KAPSAMADIĞI: PostHog'daki kişi kaydı ve Resend'in gönderim günlükleri. İkisi
// de bu ortamda bulunmayan yönetim anahtarları ister; şimdilik elle silinir
// (CLAUDE.md → "Veri akışı: hesap silme ve analitik izni").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Geçersiz istek." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Bu işlem için giriş yapman gerekiyor." }, 401);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Geçersiz oturum. Lütfen tekrar giriş yap." }, 401);
    }

    const { error: deleteError } = await sb.auth.admin.deleteUser(user.id);
    if (deleteError) {
      // Kullanıcı id'si loglanır, e-posta değil: silinmek isteyen birinin adresini
      // log deposuna yazmak, talebin tam tersini yapmak olurdu.
      console.error(`[delete-account] ${user.id} silinemedi:`, deleteError);
      return json({ error: "Hesabın silinemedi. Lütfen tekrar dene." }, 500);
    }

    console.log(`[delete-account] ${user.id} silindi`);
    return json({ success: true });
  } catch (err) {
    console.error("[delete-account] Beklenmeyen hata:", err);
    return json({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }, 500);
  }
});
