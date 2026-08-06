# Haftalık Film Seçkisi — Runbook

Manuel küre edilen seçkileri opt-in kullanıcılara mail olarak gönderme akışı.
Şema için bkz. [`schema.md`](schema.md) → `user_preferences`, `weekly_picks`.

**Kürasyon manuel.** `send-weekly-picks` film seçmez; tek işi göndermektir.

---

## Bir kerelik kurulum

```bash
# 1) Migration — Supabase Dashboard > SQL Editor'de çalıştır
#    supabase/migrations/weekly_picks.sql

# 2) Secret'lar
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set WEEKLY_PICKS_SECRET="$(openssl rand -hex 24)"
supabase secrets set WEEKLY_PICKS_REPLY_TO=tolga@gmail.com   # cevapların düştüğü kutu
# opsiyonel
supabase secrets set WEEKLY_PICKS_FROM="Tolga <tolga@lensestetik.com>"
supabase secrets set SITE_URL=https://lensestetik.com
supabase secrets set POSTHOG_KEY=phc_xxx
supabase secrets set POSTHOG_HOST=https://us.i.posthog.com

# 3) Deploy
supabase functions deploy send-weekly-picks
```

`RESEND_API_KEY` koda **gömülmez** — fonksiyon her çağrıda ortamdan okur.

---

## Haftalık akış

### 1. Seçkileri gir (elle)

```sql
insert into weekly_picks (user_id, week, films, intro_variant)
values (
  '00000000-0000-0000-0000-000000000000',  -- auth.users.id
  '2026-08-07',                             -- o haftanın işareti
  '[
    {"title":"Yeşil Işın","year":1986,"blurb":"Yalnızlığın tatil fotoğrafına sığmayan hali.","justwatch_url":"https://www.justwatch.com/tr/film/the-green-ray"},
    {"title":"Chungking Express","year":1994,"blurb":"Şehirde iki insanın birbirini ıskalaması, neon hızında.","justwatch_url":"https://www.justwatch.com/tr/film/chungking-express"}
  ]'::jsonb,
  'standart'   -- yakın zamanda rapor aldıysa 'standart', uzaklaştıysa 'sessiz'
);
```

`UNIQUE(user_id, week)` var: aynı kişiye aynı hafta ikinci satır girilemez.

### 2. Gönder (manuel invoke — cron yok)

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-weekly-picks" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-weekly-picks-secret: $WEEKLY_PICKS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"week":"2026-08-07"}'
```

Dönen özet:

```json
{ "week":"2026-08-07", "total":12, "sent":10, "skipped":2, "failed":0, "results":[...] }
```

`skipped` = opt-out yapmış kullanıcılar. Satırları `draft` kalır (tercih geri açılırsa
sonraki çağrıda gönderilir). `failed` satırları için Supabase function loglarına bak;
düzeltip `status`'ü tekrar `draft`'a çekerek yeniden çalıştırabilirsin.

Çağrı idempotent: `sent` olan satır bir daha çekilmez, aynı komutu iki kez çalıştırmak
çift mail atmaz.

---

## Doğrulama testleri

**Opt-out gerçekten atlanıyor mu?**

```sql
-- test kullanıcısını kapat
insert into user_preferences (user_id, weekly_picks_enabled)
values ('<test-user-id>', false)
on conflict (user_id) do update set weekly_picks_enabled = false;
```

Fonksiyonu çağır → yanıtta o `pick_id` için `{"status":"skipped","reason":"opted_out"}`
görünmeli, mail gitmemeli, satır `draft` kalmalı.

**RLS sızdırmıyor mu?** Kullanıcı oturumuyla (anon key) `select * from user_preferences`
ve `select * from weekly_picks` çek — yalnızca kendi satırların dönmeli.
`update weekly_picks set status='sent'` **hata vermeli** (INSERT/UPDATE policy'si yok).

**Mail testi:** kendine bir `weekly_picks` satırı gir, gönder. Kontrol et:
inbox'a mı düştü (Promotions/Spam değil), düz metin sürümü okunuyor mu (Gmail →
"Orijinali göster"), "buradan kapatabilirsin" linki `/settings`'e gidiyor mu,
maile cevap yazınca `WEEKLY_PICKS_REPLY_TO` kutusuna düşüyor mu.

---

## Sınırlar (bilinçli)

- **Cron yok** — ilk faz manuel tetikleme. Zamanlama sonraki iş.
- **Görsel/afiş yok** — Gmail Promotions riski. Değiştirmeden önce deliverability'yi ölç.
- **`List-Unsubscribe-Post` (One-Click) yok** — karşılığı olan POST endpoint'i olmadan
  eklemek deliverability'ye zarar verir. Endpoint yazılırsa header da eklenmeli.
