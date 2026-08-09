/**
 * Rapora giren sinyal sayısının sınırları. "Kütüphane sınırsız, rapor bounded":
 * user_works havuzunun tavanı yoktur, bu sayılar yalnızca rapora giren seçim içindir.
 *
 * ALT SINIR TOPLAMDIR, kategori başına değil — 6+0+0 geçerli bir dağılımdır.
 * Kategori zorunluluğu bilinçli olarak kaldırıldı: kitap okuyup film izlemeyen
 * kullanıcı "3 favori film yaz" ekranında ürünü terk ediyordu.
 *
 * ÜST SINIR kategori başınadır.
 *
 * supabase/functions/analyze/index.ts içinde bu iki sayının kardeşi var ve ELLE
 * senkron tutulur — Deno bundle'ı src/'ten import edemez. İki tam sayı için
 * paylaşılan modül / build adımı açma.
 */
export const MIN_TOTAL_ENTRIES = 6;
export const MAX_ENTRIES_PER_CATEGORY = 8;
