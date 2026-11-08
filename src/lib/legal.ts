import { WEEKLY_PICKS_EMAIL_PAUSED } from "./preferences";

/**
 * Hukuki metinlerin ortak verisi: veri sorumlusunun kimliği, metin sürümü ve
 * verinin gittiği hizmet sağlayıcılar. Metinlerin kendisi `src/pages/Legal.tsx`'te.
 *
 * BU DOSYA BİR BEYAN, AYAR DEĞİL. Aşağıdaki her satır kullanıcıya verilmiş bir
 * sözdür ve kodun gerçekte yaptığıyla birlikte değişmek zorundadır:
 *   - Yeni bir dış servis kişisel veri alıyorsa `PROCESSORS`'a girer.
 *   - Bir servisin ülkesi ya da aldığı veri değişirse satırı değişir.
 *   - Aktarımın kapsamı değişirse (yeni ülke, yeni alıcı türü)
 *     `TRANSFER_CONSENT_VERSION` de değişir — bkz. aşağıdaki not.
 */

/**
 * Veri sorumlusu (KVKK m.10/1-a). Lens bir şirket değil, gerçek bir kişinin
 * projesi; veri sorumlusu o kişidir (tüzel kişilik şart değil).
 *
 * AD ve E-POSTA DOLMADAN YAYINA ÇIKMA: boş kalan alan sayfada köşeli parantezle
 * görünür ve sayfaların başına "taslak" şeridi düşer (`LEGAL_DRAFT`). Kimliği
 * belli olmayan bir veri sorumlusunun aydınlatma metni aydınlatma sayılmaz.
 *
 * ADRES BİLEREK BOŞ ve boşken satırı çizilmez: kanun kimliği ister, adresi
 * değil, ve buraya yazılacak tek adres bir ev adresi olurdu. Başvuru kanalı
 * e-posta — kullanıcının hesabında kayıtlı adresinden yazdığı başvuru geçerli
 * bir başvurudur. Şirket kurulursa unvan, adres ve MERSİS numarası buraya girer.
 */
export const CONTROLLER = {
  name: "Tolga Demirli",
  address: "",
  /** KVKK başvurularının geldiği kutu. Yayından önce var olmalı ve OKUNMALI:
   *  başvurunun yasal yanıt süresi 30 gün.
   *
   *  Bu bir posta kutusu DEĞİL, Cloudflare Email Routing yönlendirmesi (29 Ekim
   *  2026): `kvkk@` Tolga'nın Gmail'ine iletilir, orada filtreyle işaretlenir.
   *  Ayar kod değil panel: yönlendirme kaldırılırsa bu adres sessizce ölür ve
   *  hiçbir test düşmez. Eskisi `lensestetik@gmail.com`'du. */
  email: "kvkk@lensestetik.com",
};

export const LEGAL_DRAFT = !CONTROLLER.name || !CONTROLLER.email;

/** Metinlerin altındaki "son güncelleme" satırı. */
export const LEGAL_UPDATED = "8 Kasım 2026";

/**
 * Yurt dışı aktarımına verilen açık rızanın metin sürümü. `user_consents.version`
 * kolonuna yazılır; girişteki kapı (`TransferConsentGate`) bu sürümde kaydı
 * olmayan herkese yeniden sorar.
 *
 * NE ZAMAN DEĞİŞİR: rızanın KAPSAMI değiştiğinde — yeni bir ülke, yeni bir alıcı
 * türü, aktarılan verinin niteliği. Yazım düzeltmesi için DEĞİŞTİRME: herkese
 * boş yere yeniden sorulur ve iki kez sorulan rıza ikincisinde okunmadan verilir.
 */
export const TRANSFER_CONSENT_VERSION = "2026-10-11";

/** Rıza cümlesinde ve metinlerde geçen ülkeler. `PROCESSORS` ile birlikte değişir. */
export const TRANSFER_COUNTRIES = "Güney Kore ve ABD";

export interface Processor {
  name: string;
  /** Sağlayıcının ne için kullanıldığı — TAM CÜMLE, sayfaya olduğu gibi basılır. */
  purpose: string;
  /** Sağlayıcıya hangi verinin gittiği — TAM CÜMLE. */
  data: string;
  country: string;
  note?: string;
}

/**
 * Kişisel veri alan hizmet sağlayıcılar (KVKK m.10/1-c). Aydınlatma Metni'ndeki
 * tablo buradan çizilir.
 *
 * `purpose`, `data` ve `note` sayfaya olduğu gibi basılır ve metnin geri
 * kalanıyla aynı kurala uyar: her biri yüklemle biten tam cümledir. "Veritabanı
 * ve giriş" gibi bir etiket ya da "Giden veri: …" gibi bir parça yazma.
 *
 * Eser adı sorduğumuz kataloglar (movieofthenight, Open Library, Wikidata)
 * burada YOK: onlara yalnızca eser ve yaratıcı adı gider, kullanıcıya dair bir
 * şey gitmez. Bir gün kullanıcı kimliği ya da IP'si de gidecek olursa girerler.
 *
 * Telegram da YOK: bot desteklenmiyor ve yayına alınmayacak (karar, 11 Ekim
 * 2026). Bağlama sayfası ve `link-telegram` 20 Ekim 2026'da kaldırıldı; Telegram
 * tabloları duruyor. Yeniden açılırsa buraya ve Aydınlatma Metni'ndeki veri
 * listesine girer.
 */
export const PROCESSORS: Processor[] = [
  {
    name: "Supabase",
    purpose: "Veritabanı, giriş ve sunucu işlemleri Supabase üzerinde çalışır.",
    data: "Lens'te tutulan bütün verilerin bu sağlayıcıda saklanır.",
    country: "Güney Kore",
  },
  {
    name: "Anthropic (Claude)",
    purpose:
      "Rapor, keşif ve seçki metinlerini Anthropic'in yapay zekâ modeli yazar; ekran görüntüsündeki eserleri de aynı model okur.",
    data: "Bu sağlayıcıya eserlerin, raporun, zevk profilin ve yüklediğin görsel ya da metin gönderilir; adın ve e-posta adresin gönderilmez.",
    country: "ABD",
  },
  {
    name: "Vercel",
    purpose: "Site Vercel üzerinden sunulur ve poster görselleri burada üretilir.",
    data: "Bu sağlayıcıya IP adresin ve tarayıcı bilgin, poster istediğinde ise raporun ulaşır.",
    country: "ABD",
  },
  {
    // Lens'in adreslerine (`lens@`, `kvkk@`) yazılan e-postalar alan adının
    // MX kayıtlarıyla Cloudflare'e düşer ve oradan Gmail'e iletilir (Email
    // Routing, 20 ve 29 Ekim 2026). Sitenin trafiği Cloudflare'den GEÇMİYOR:
    // alan adı doğrudan Vercel'e çözülüyor (proxy kapalı, ölçüldü 29 Ekim 2026).
    // Proxy açılırsa her ziyaretçinin IP'si ve tarayıcı bilgisi de buraya gider
    // ve `data` cümlesi değişir. Eklenmesi rıza sürümünü YÜKSELTMEDİ: rıza
    // cümlesi sağlayıcıları adıyla saymıyor ve ülke (ABD) zaten listede.
    name: "Cloudflare",
    purpose: "Lens'in alan adı Cloudflare'de yönetilir ve Lens'e yazılan e-postalar Cloudflare üzerinden iletilir.",
    data: "Lens'e e-posta yazarsan bu sağlayıcıya e-posta adresin ve iletin ulaşır.",
    country: "ABD",
  },
  {
    // İki ayrı rol: Google ile giriş ve Lens'e yazılan e-postaların okunduğu
    // Gmail kutusu (yönlendirmenin hedefi). Gmail'den vazgeçilirse ikinci
    // cümleler düşer.
    name: "Google",
    purpose:
      "Google ile giriş yapmayı seçersen giriş Google üzerinden yapılır. Lens'e yazdığın e-postalar da Google'ın e-posta hizmeti Gmail'de okunur.",
    data: "Google ile giriş yaparsan Google, e-posta adresini, adını ve profil görselini Lens ile paylaşır. Lens'e e-posta yazarsan e-posta adresin ve iletin Gmail'de saklanır.",
    country: "ABD",
  },
  {
    name: "Resend",
    // Giriş e-postası Supabase'in "Custom SMTP" ayarıyla Resend'den gider (20 Ekim
    // 2026). Ayar kod değil panel: kapatılırsa bu cümle de değişir.
    purpose: "Giriş e-postaları ve haftalık seçki e-postaları Resend üzerinden gönderilir.",
    data: "Giriş e-postası için bu sağlayıcıya e-posta adresin ile giriş bağlantın ve kodun iletilir. Haftalık seçki e-postası için e-posta adresin, adın ve o haftanın seçkisi iletilir.",
    country: "ABD",
    // Mail kanalı açılınca not kendiliğinden düşer; satırın kendisi kalır ki
    // lansman günü metne dokunmak gerekmesin. Not yalnızca seçkiyi anlatır:
    // giriş e-postaları her zaman gider.
    note: WEEKLY_PICKS_EMAIL_PAUSED ? "Haftalık seçki e-postaları şu anda gönderilmemektedir." : undefined,
  },
  {
    name: "PostHog",
    purpose: "Kullanım ölçümü PostHog ile yapılır ve yalnızca sen izin verirsen çalışır.",
    data: "Bu sağlayıcıya uğradığın ekranlar, uygulama içindeki adımların, IP adresin ve tarayıcı bilgin gönderilir; giriş yaptıysan bu kayıtlar hesap numaranla eşleşir.",
    country: "ABD",
  },
];
