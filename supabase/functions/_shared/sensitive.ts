// Kullanıcı hakkında metin üreten ÜÇ prompt'un ortak kuralı:
// analyze (rapor) · daily-discovery (günlük gerekçe) · generate-weekly-picks (blurb).
//
// NEDEN VAR: okunan, izlenen ve dinlenen şeyler bir insanın inancını, siyasi
// görüşünü ya da cinsel yönelimini ele verebilir. KVKK bunları "özel nitelikli"
// sayıyor (m.6) ve işlenmeleri ayrı, çok daha ağır bir rejime bağlı. Girdiyi
// almamak mümkün değil — liste kullanıcının kendi zevki. Ama model o listeden
// "inançlı biri", "solcu bir okur" diye bir cümle kurduğu an, kullanıcının
// vermediği bir özel nitelikli veriyi BİZ üretmiş ve veritabanına yazmış oluruz.
// Rapor herkese açılabildiği için bu cümle bir de paylaşılır.
//
// NEDEN TEK DOSYA: üç fonksiyon ayrı Deno bundle'ı ve prompt'ları elle senkron
// tutuluyordu. Bu kural ayrışmayı kaldırmaz — birinde gevşerse sızıntı oradan olur.
//
// KAPSAMADIĞI: "felsefi inanç" da m.6'da sayılıyor ama burada YOK. Arketip dili
// "Sokak Filozofu", "Varoluşçu" gibi adları estetik bir duruş olarak kullanıyor;
// onları yasaklamak ürünün sesini değiştirirdi. Bilinçli bırakılmış bir gri alan.
//
// Bu bir prompt kuralıdır, doğrulama değil: çıktı kodla denetlenmiyor.

export const SENSITIVE_INFERENCE_RULE = `## HASSAS ÇIKARIM YOK
Kullanıcının KİM olduğuna dair şu konularda çıkarım yapma, ima da etme: dini inancı
ya da inançsızlığı, mezhebi, siyasi görüşü, etnik kökeni, cinsel yönelimi ya da cinsel
hayatı, bedensel ya da ruhsal sağlığı, sabıka geçmişi, dernek ya da sendika üyeliği.
- Listede bu konuları işleyen eserler olabilir. Onları tonu, biçimi ve atmosferi
  üzerinden oku; kullanıcının kimliğine dair bir teşhise çevirme.
- Yazdığın HİÇBİR alanda (ad, özet, açıklama, gerekçe) "inançlı", "muhafazakâr",
  "solcu", "depresif" gibi bir etiket ya da bunların iması geçmez.
- "Karanlık", "melankolik", "huzursuz" gibi sözcükler eserlerin ve zevkin tonunu
  anlatmak için serbesttir; kullanıcının ruh hâline ya da sağlığına teşhis koymak
  için değil.`;
