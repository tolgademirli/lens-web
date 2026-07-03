import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Auth token doğrula
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Yetkilendirme gerekli." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Geçersiz oturum. Lütfen tekrar giriş yap." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Geçerli bir bağlantı kodu gerekli." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Kodu telegram_link_codes tablosunda ara (süresi geçmemiş)
    const { data: linkCode, error: codeError } = await sb
      .from("telegram_link_codes")
      .select("telegram_user_id, expires_at")
      .eq("code", code)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (codeError || !linkCode) {
      return new Response(
        JSON.stringify({ error: "Geçersiz veya süresi dolmuş kod." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { telegram_user_id } = linkCode;

    // telegram_users tablosuna upsert
    const { error: upsertError } = await sb
      .from("telegram_users")
      .upsert({ telegram_user_id, user_id: user.id }, { onConflict: "telegram_user_id" });

    if (upsertError) throw upsertError;

    // Bu telegram_user_id'ye ait anonim raporları user_id ile güncelle
    const { error: updateError } = await sb
      .from("reports")
      .update({ user_id: user.id })
      .eq("telegram_user_id", telegram_user_id)
      .is("user_id", null);

    if (updateError) throw updateError;

    // Kullanılmış kodu sil
    await sb.from("telegram_link_codes").delete().eq("code", code);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[link-telegram] Beklenmeyen hata:", err);
    return new Response(
      JSON.stringify({ error: "Bir hata oluştu. Lütfen tekrar deneyin." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
