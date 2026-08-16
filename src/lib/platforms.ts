import { supabase } from "./supabase";

/**
 * Haftalık seçkinin sınırlanabileceği platformlar.
 *
 * SÖZLÜK BURADA DEĞİL, `watch_providers` TABLOSUNDA. Sebebi: üretim fonksiyonu da
 * aynı tablodan okuyor, yani UI kullanıcıya ÜRETİMİN FİLTRELEYEMEDİĞİ bir platformu
 * asla teklif edemez. Listeyi TS sabiti yapmak bu garantiyi kaybettirirdi —
 * yeni bir platform eklemek iki yerde değişiklik ve bir deploy isterdi.
 */
export type PlatformOption = {
  slug: string;
  label: string;
};

/**
 * Erişilebilirlik verisinin künyesi. Sağlayıcının kullanım koşulları, akış
 * bilgisini gösteren uygulamanın kaynağı belirtmesini ve API sayfasına link
 * vermesini ZORUNLU tutuyor.
 *
 * Künye maile DEĞİL Ayarlar'daki platform kartının altına konuyor: mailin link
 * tavanı 5 ve dolu (ölçülmüş deliverability kararı, email.ts başındaki not) ve
 * kurumsal bir cümle mailin kurucu ağzından tonunu kırardı. Ücretsiz yolda API
 * hiç çağrılmıyor, yani künye yükümlülüğü de platform filtresiyle BİRLİKTE doğuyor.
 */
export const WATCH_DATA_CREDIT = {
  name: "Movie of the Night",
  url: "https://www.movieofthenight.com/about/api",
} as const;

/**
 * Seçilebilir platformlar, Ayarlar ekranının sırasıyla.
 *
 * `service_id IS NULL` olan satırlar ELENİR: o platformun erişilebilirlik
 * sağlayıcısındaki karşılığı henüz doğrulanmadı, yani seçilse bile filtreye
 * giremez. Filtreleyemeyeceğimiz bir platformu teklif etmek, kullanıcıya
 * tutamayacağımız bir söz vermektir — seçer, hiçbir şey değişmez, sebebini de
 * göremez.
 *
 * Okuma başarısızsa BOŞ DİZİ döner ve çağıran platform kartını hiç göstermez:
 * yarım dolu bir liste, kullanıcının "Netflix yok demek ki desteklenmiyor" diye
 * yanlış sonuç çıkarmasına yol açar.
 */
export async function fetchPlatformOptions(): Promise<PlatformOption[]> {
  const { data, error } = await supabase
    .from("watch_providers")
    .select("slug, label_tr, service_id")
    .not("service_id", "is", null)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[platforms] okunamadı:", error);
    return [];
  }

  return (data ?? []).map((row) => ({ slug: row.slug, label: row.label_tr }));
}

/**
 * "Tümü" mü? NULL ve boş dizi aynı şeye çıkar — ama DB'ye boş dizi ASLA yazılmaz
 * (CHECK yasaklıyor). Bu yardımcı yalnızca OKUMA tarafını yumuşatır.
 */
export const isAllPlatforms = (platforms: string[] | null): boolean =>
  platforms === null || platforms.length === 0;
