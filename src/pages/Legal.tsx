import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { AnalyticsPreferenceLink } from "@/app/components/AnalyticsConsent";
import { analyticsConfigured } from "@/lib/posthog";
import {
  CONTROLLER,
  LEGAL_DRAFT,
  LEGAL_UPDATED,
  PROCESSORS,
  TRANSFER_COUNTRIES,
} from "@/lib/legal";

/**
 * /privacy · /cookies · /terms — Aydınlatma Metni, Çerez Politikası, Kullanım
 * Koşulları. Rota dili İngilizce (BUG-01 dersi), başlıklar Türkçe.
 *
 * BU SAYFALAR KODUN YAPTIĞINI ANLATIR ve onunla birlikte değişmek zorunda.
 * Buradaki her cümle bir söz: "saklanmaz" yazıyorsa saklanmıyor, "7 gün" yazıyorsa
 * 7 günde siliniyor olmalı. Davranışı değiştiren commit metni de değiştirir:
 *   - yeni bir dış servis, yeni bir veri türü      -> Aydınlatma Metni (+ `legal.ts`)
 *   - PostHog'da yeni bir veri türü, yeni bir kayıt -> Çerez Politikası; analitik
 *     bandı ve Hesabım'daki "Kullanım ölçümü" kartıyla AYNI şeyi söyler, üçü
 *     birlikte güncellenir
 *   - `localStorage`'a yeni bir anahtar             -> Çerez Politikası'ndaki tablo
 *
 * HER CÜMLE TAM CÜMLEDİR: öznesi bellidir ve yüklemle biter. Bu bir üslup tercihi
 * değil, metnin sahibinin açık isteği (11 Ekim 2026). İlk sürüm arayüz diliyle
 * yazılmıştı ve hukuki metinde yarım kalmış gibi okundu. Şunları YAZMA:
 *   - başlık + parça:        "Hesabın. Giriş yaptığın e-posta adresi."
 *   - etiket + iki nokta:    "Hukuki sebep: meşru menfaat."  "IP adresi: 7 gün."
 *   - yüklemi düşmüş cümle:  "Ayrıntısı Çerez Politikası'nda."  "Güvenliği sende."
 *   - devrik cümle ve tek kelimelik cümle ("Hayır.")
 *   - "Hesabım → Verilerim" gibi ok işaretli yol tarifi (cümleyle yazılır)
 * Bölüm başlıkları ad öbeğidir ("Saklama süreleri"); soru ya da yarım cümle değil.
 * `legal.ts`'teki `purpose` / `data` / `note` alanları da bu kurala uyar.
 *
 * Metinler avukat görmedi; benzer platformların izlediği genel pratikle yazıldı.
 * Yurt dışı aktarımı açık rızaya dayanıyor — sürekli aktarımda bunun tek başına
 * yeterli sayılıp sayılmayacağı tartışmalı (KVKK m.9, 2024 değişikliği).
 *
 * "Ücret" dili YOK: premium anahtarı kapalıyken arayüz paket kelimelerini hiç
 * kurmuyor, metinler de kurmaz. Ödeme akışı geldiğinde Kullanım Koşulları'na
 * kendi bölümüyle girer.
 *
 * Telegram YOK: bot desteklenmiyor ve bağlama sayfası kaldırıldı (bkz. `legal.ts`).
 *
 * Düz koyu yüzey, gradyan değil: burası okuma sayfası. Alt boşluk analitik bandı
 * kadar büyür — karar vermemiş ziyaretçi metnin sonunu bandın altında okuyamazdı.
 */
const DOCS = [
  { to: "/privacy", label: "Aydınlatma Metni" },
  { to: "/cookies", label: "Çerez Politikası" },
  { to: "/terms", label: "Kullanım Koşulları" },
];

const who = CONTROLLER.name || "[veri sorumlusunun adı]";

const link = "text-white underline underline-offset-2 hover:text-purple-200";

function Mail() {
  if (!CONTROLLER.email) return <span>[başvuru e-postası]</span>;
  return (
    <a href={`mailto:${CONTROLLER.email}`} className={link}>
      {CONTROLLER.email}
    </a>
  );
}

function LegalShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-300"
      style={{ paddingBottom: "var(--consent-banner-h, 0px)" }}
    >
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5">
          <Link to="/" className="text-lg font-light tracking-[0.2em] text-white">
            LENS
          </Link>
          <nav aria-label="Hukuki metinler" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {DOCS.map((doc) => (
              <NavLink
                key={doc.to}
                to={doc.to}
                className={({ isActive }) =>
                  isActive ? "text-white" : "text-slate-400 transition-colors hover:text-white"
                }
              >
                {doc.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {LEGAL_DRAFT && (
        <p role="note" className="border-b border-amber-400/30 bg-amber-400/10 px-5 py-3 text-center text-sm text-amber-200">
          Taslak: Veri sorumlusunun kimliği henüz girilmediği için bu metin yayımlanmamalıdır.
        </p>
      )}

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-serif text-3xl text-white sm:text-4xl">{title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-400">{lead}</p>
        <div className="mt-12 space-y-12">{children}</div>
        <p className="mt-14 border-t border-slate-800 pt-6 text-sm text-slate-500">
          Son güncelleme: {LEGAL_UPDATED}
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl text-white sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed">{children}</div>
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-3 pl-5 marker:text-slate-600">{children}</ul>;
}

/**
 * Cümlenin içindeki anahtar kavram. Göz maddeyi taramak istediğinde buna tutunur;
 * ama kavram cümleden KOPARILMAZ — ayrı bir başlık satırı değil, cümlenin öznesi
 * ya da nesnesidir.
 */
function Key({ children }: { children: ReactNode }) {
  return <span className="text-white">{children}</span>;
}

export function PrivacyPage() {
  return (
    <LegalShell
      title="Aydınlatma Metni"
      lead="Bu metin, Lens'in senden hangi verileri aldığını, bunları ne için kullandığını, kimlere aktardığını ve bu veriler üzerindeki haklarını anlatır. Metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesi uyarınca hazırlanmıştır."
    >
      <Section title="Veri sorumlusu">
        <p>
          Lens'te (lensestetik.com) işlenen kişisel verilerinin veri sorumlusu aşağıda
          belirtilmiştir. Verilerinle ilgili sorularını ve taleplerini başvuru adresine
          gönderebilirsin.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-slate-500">Veri sorumlusu</dt>
          <dd className="text-white">{who}</dd>
          {CONTROLLER.address && (
            <>
              <dt className="text-slate-500">Adres</dt>
              <dd>{CONTROLLER.address}</dd>
            </>
          )}
          <dt className="text-slate-500">Başvuru</dt>
          <dd>
            <Mail />
          </dd>
        </dl>
      </Section>

      <Section title="İşlenen veriler">
        <p>Lens, sen hizmeti kullanırken aşağıdaki verilerini işler.</p>
        <Bullets>
          <li>
            Giriş yaptığın <Key>e-posta adresi</Key> işlenir. Google ile giriş yaparsan Google'ın
            paylaştığı adın ve profil görselin de işlenir.
          </li>
          <li>
            Yazdığın, yapıştırdığın ya da ekran görüntüsünden okunan{" "}
            <Key>kitap, film, dizi ve müzik adları</Key> ile bunların yaratıcılarının adları
            işlenir.
          </li>
          <li>
            Eserlerinden yazılan <Key>estetik kimlik raporların</Key> saklanır. Hangi raporu
            paylaşıma açtığın ve bunu ne zaman yaptığın da kaydedilir.
          </li>
          <li>
            Sana gösterilen <Key>günlük keşifler ve haftalık seçkiler</Key> kaydedilir.
          </li>
          <li>
            Önerilere verdiğin <Key>yanıtlar</Key> ile listene aldığın ve bitirdiğin eserler
            kaydedilir. Bu kayıtlardan, ton, popülerlik ve dönem eğilimlerin ile tür
            ağırlıklarından oluşan bir <Key>zevk profili</Key> hesaplanır.
          </li>
          <li>
            Öneri ve e-posta <Key>tercihlerin</Key> ile yurt dışı aktarımına verdiğin iznin tarihi
            saklanır.
          </li>
          <li>
            <Key>IP adresin ve tarayıcı bilgin</Key>, siteyi sunan altyapının erişim kayıtlarına
            düşer. Giriş yapmadan ekran görüntüsü ya da metin okuttuğunda IP adresin günlük
            kullanım sayacında da tutulur.
          </li>
          <li>
            <Key>Kullanım ölçümü</Key> yalnızca sen izin verirsen yapılır. Bu durumda uğradığın
            ekranlar, uygulama içindeki adımların, dokunduğun yerlerin konumu ve sayfaların açılış
            hızı kaydedilir. Ölçümün ayrıntıları{" "}
            <Link to="/cookies" className={link}>
              Çerez Politikası
            </Link>
            'nda yer alır.
          </li>
        </Bullets>
        <p>
          Bu veriler doğrudan senden, sen Lens'i kullanırken elektronik ortamda toplanır. Google
          ile giriş yaparsan adın ve profil görselin Google'dan alınır.
        </p>
        <p>
          Lens senden inancın, siyasi görüşün, etnik kökenin, sağlığın ya da cinsel hayatın gibi
          özel nitelikli veriler istemez. Raporu yazan yapay zekâya bu konularda çıkarım
          yapmaması yönünde talimat verilir. Buna rağmen üretilen metinler tek tek denetlenmez.
          Böyle bir ifadeyle karşılaşırsan <Mail /> adresine yazabilirsin.
        </p>
      </Section>

      <Section title="İşleme amaçları ve hukuki sebepler">
        <p>Verilerin aşağıdaki amaçlarla ve belirtilen hukuki sebeplere dayanılarak işlenir.</p>
        <Bullets>
          <li>
            Verilerin öncelikle <Key>sana hizmet sunmak</Key> için işlenir. Bu kapsamda hesabın
            açılır, raporun yazılır, günlük keşiflerin ve haftalık seçkilerin hazırlanır, öneriler
            geri bildirimlerine göre ayarlanır ve paylaşmak istediğin rapor ile poster gösterilir.
            Bu işlemenin hukuki sebebi, seninle kurulan sözleşmenin ifasıdır (KVKK m.5/2-c).
          </li>
          <li>
            Verilerin, <Key>kötüye kullanımı önlemek ve hizmeti ayakta tutmak</Key> için de
            işlenir. Günlük kullanım sınırları ile güvenlik ve hata kayıtları bu amaçla tutulur.
            Bu işlemenin hukuki sebebi meşru menfaattir (KVKK m.5/2-f).
          </li>
          <li>
            <Key>Kullanım ölçümü</Key>, Lens'in nerede işe yaradığını ve nerede tökezlediğini
            görmek için yapılır. Bu işlemenin hukuki sebebi açık rızandır (KVKK m.5/1). İzin
            vermezsen hiçbir ölçüm yapılmaz.
          </li>
          <li>
            Verilerin, başvurularını yanıtlamak ve yetkili kurumların hukuka uygun taleplerini
            karşılamak için de işlenebilir. Bu işlemenin hukuki sebebi,{" "}
            <Key>hukuki yükümlülüklerin</Key> yerine getirilmesidir (KVKK m.5/2-ç).
          </li>
        </Bullets>
        <p>Verilerin satılmaz ve reklam amacıyla kullanılmaz.</p>
      </Section>

      <Section title="Yapay zekâ ile yazılan içerik">
        <p>
          Raporların, keşiflerin ve seçkilerin bir yapay zekâ modeli tarafından yazılır. Bu
          metinler zevkine dair yorumlardır. Bu yorumlar senin hakkında hukuki bir sonuç doğurmaz
          ve bir değerlendirme ya da tavsiye yerine geçmez. Bir raporun seni yanlış anlattığını
          düşünürsen yeni bir rapor oluşturabilir ya da <Mail /> adresine yazabilirsin.
        </p>
      </Section>

      <Section title="Verilerin aktarıldığı taraflar">
        <p>
          Lens'in çalışması için aşağıdaki hizmet sağlayıcılar kullanılır. Her sağlayıcı yalnızca
          kendi işi için gereken veriyi alır.
        </p>
        <ul className="space-y-3">
          {PROCESSORS.map((processor) => (
            <li key={processor.name} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-white">{processor.name}</span>
                <span className="text-sm text-slate-400">{processor.country}</span>
              </div>
              <p className="mt-2 text-sm">{processor.purpose}</p>
              <p className="mt-1 text-sm text-slate-400">
                {processor.data}
                {processor.note ? ` ${processor.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
        <p>Bu sağlayıcıların dışında, verilerin iki durumda başkalarına ulaşabilir.</p>
        <Bullets>
          <li>
            Paylaşıma açtığın bir raporu, bağlantısına sahip olan herkes görebilir. Raporların sen
            paylaşıma açana kadar yalnızca sana görünür ve açtığın bir raporu istediğin an yeniden
            kapatabilirsin.
          </li>
          <li>Hukuken zorunlu olduğunda verilerin yetkili kamu kurumlarıyla paylaşılabilir.</li>
        </Bullets>
      </Section>

      <Section title="Yurt dışına aktarım">
        <p>
          Yukarıdaki sağlayıcıların sunucuları yurt dışında ({TRANSFER_COUNTRIES}) bulunur. Lens
          bu altyapı olmadan çalışamadığı için verilerin bu ülkelere aktarılır. Aktarım, KVKK'nın
          9. maddesi uyarınca açık rızana dayanır. Bu rızayı ilk raporunu oluştururken giriş
          penceresinde verirsin. Rızan kayıtlı değilse giriş yaptıktan sonra sorulur.
        </p>
        <p>
          Bu aktarımın bir riski vardır. Kişisel Verileri Koruma Kurulu bu ülkeler hakkında bir
          yeterlilik kararı vermemiştir. Bu nedenle verilerin o ülkelerde KVKK'nın sağladığı
          korumanın aynısından yararlanmayabilir. O ülkelerin makamları verilere kendi kanunlarına
          göre erişebilir ve haklarını oradaki bir merci önünde araman zor olabilir.
        </p>
        <p>
          Rızanı istediğin an geri alabilirsin. Lens yurt dışındaki altyapı olmadan çalışamadığı
          için rızayı geri almanın yolu hesabını silmektir. Hesabını, Hesabım sekmesindeki
          Verilerim bölümünden silebilirsin. Hesabını sildiğinde Lens'teki bütün verilerin de
          silinir.
        </p>
      </Section>

      <Section title="Saklama süreleri">
        <Bullets>
          <li>
            Hesabın, eserlerin, raporların, keşif ve seçki geçmişin, geri bildirimlerin ve
            tercihlerin, sen hesabını silene kadar saklanır. Hesabını sildiğinde bu veriler
            Lens'in veritabanından kalıcı olarak silinir.
          </li>
          {/* Süre ve "saklanmaz" cümleleri kaynakta TEK SATIRDA durur: bekçi testi
              (`tests/guards/kvkk.test.ts`) bu cümleleri kodun yaptığıyla karşılaştırır. */}
          <li>
            Ekran görüntüleri ve yapıştırdığın metinler saklanmaz. Okuma tamamlandığında geriye
            yalnızca çıkarılan eser adları kalır.
          </li>
          <li>
            Giriş yapmadan önce yazdıkların
            yalnızca kendi tarayıcında durur ve 60 dakika sonra geçersizleşir.
          </li>
          <li>Günlük kullanım sayacındaki IP adresi 7 gün sonra silinir.</li>
          <li>
            Altyapı erişim kayıtları, sağlayıcıların kendi saklama süreleri boyunca tutulur.
          </li>
          <li>
            Kullanım ölçümü kayıtları PostHog'da hesap numaranla tutulur;
            adın ve e-posta adresin oraya gönderilmez. İzni kapattığında ölçüm durur. Hesabını
            sildiğinde bu numara Lens'te artık hiç kimseyi göstermez. Kayıtlarının PostHog'dan da
            silinmesini istersen <Mail /> adresine yazman yeterlidir.
          </li>
        </Bullets>
      </Section>

      <Section title="Hakların">
        <p>KVKK'nın 11. maddesi sana aşağıdaki hakları tanır.</p>
        <Bullets>
          <li>Kişisel verilerinin işlenip işlenmediğini öğrenebilirsin.</li>
          <li>Verilerin işlendiyse buna ilişkin bilgi isteyebilirsin.</li>
          <li>
            Verilerinin hangi amaçla işlendiğini ve amacına uygun kullanılıp kullanılmadığını
            öğrenebilirsin.
          </li>
          <li>Verilerinin yurt içinde ya da yurt dışında kimlere aktarıldığını öğrenebilirsin.</li>
          <li>Eksik ya da yanlış işlenen verilerinin düzeltilmesini isteyebilirsin.</li>
          <li>Verilerinin silinmesini ya da yok edilmesini isteyebilirsin.</li>
          <li>
            Düzeltme ve silme işlemlerinin, verilerinin aktarıldığı kişilere bildirilmesini
            isteyebilirsin.
          </li>
          <li>
            Verilerinin yalnızca otomatik sistemlerle analiz edilmesi sonucunda aleyhine bir sonuç
            ortaya çıkarsa bu sonuca itiraz edebilirsin.
          </li>
          <li>
            Verilerinin kanuna aykırı işlenmesi nedeniyle zarara uğrarsan zararının giderilmesini
            isteyebilirsin.
          </li>
        </Bullets>
        <p>
          Bu hakların ikisini kimseye yazmadan kullanabilirsin. Hesabım sekmesindeki Verilerim
          bölümünden kullanım ölçümünü açıp kapatabilir, hesabını ve bütün verilerini
          silebilirsin. Diğer taleplerin için hesabında kayıtlı e-posta adresinden <Mail />{" "}
          adresine yazabilirsin. Başvurun en geç 30 gün içinde yanıtlanır. Yanıt alamazsan ya da
          aldığın yanıtı yeterli bulmazsan Kişisel Verileri Koruma Kurulu'na şikâyette
          bulunabilirsin.
        </p>
      </Section>

      {/* 18 yaş sınırı YOK (karar: lise çağındaki biri de kullanabilmeli). Veli izni
          cümlesi bir doğrulama değil, beyan: küçüğün tek başına verdiği rıza zayıf
          olduğu için benzer platformların koyduğu asgari kayıt. */}
      <Section title="18 yaşından küçükler">
        <p>
          18 yaşından küçüksen Lens'i kullanabilirsin; ancak hesabını velinin bilgisi ve izniyle
          açman gerekir. Veli ya da vasi olarak çocuğunun hesabının ve verilerinin silinmesini
          istersen <Mail /> adresine yazman yeterlidir.
        </p>
      </Section>

      <Section title="Metindeki değişiklikler">
        <p>
          Bu metinde yapılan değişiklikler bu sayfada yayımlanır ve sayfanın altındaki tarih
          güncellenir. Verilerinin yurt dışına aktarımının kapsamı değişirse rızan Lens'i bir
          sonraki açışında yeniden sorulur.
        </p>
      </Section>
    </LegalShell>
  );
}

/**
 * Tarayıcıda tutulan kayıtlar. `localStorage`'a yeni bir anahtar ekleyen commit
 * buraya da satır ekler. Analitik çerezi BURADA DEĞİL, aşağıda kendi bölümünde:
 * o izne bağlı, bunlar değil.
 *
 * `purpose` ve `lifetime` sayfaya olduğu gibi basılır; ikisi de tam cümledir.
 */
const STORED = [
  {
    name: "Oturum kaydı",
    keys: "sb-…-auth-token",
    purpose: "Bu kayıt, giriş yaptığını hatırlar.",
    lifetime: "Kayıt, sen çıkış yapana kadar tarayıcında kalır.",
  },
  {
    name: "Analitik kararın",
    keys: "lens_analytics_consent",
    purpose:
      "Bu kayıt, ölçüme izin verip vermediğini hatırlar; böylece karar her ziyarette yeniden sorulmaz.",
    lifetime: "Kayıt, sen kararını değiştirene kadar tarayıcında kalır.",
  },
  {
    name: "Yarım kalan girişin",
    keys: "lens_pending_report, lens_pending_library, sekme belleğindeki taslak",
    purpose: "Bu kayıtlar, yazdığın eserleri sen giriş yapıp dönene kadar tutar.",
    lifetime: "Kayıtlar 60 dakika sonra geçersizleşir.",
  },
  {
    name: "Giriş köprüsü",
    keys: "lens_auth_method, lens_pending_consent",
    purpose:
      "Bu kayıtlar, hangi yolla giriş yaptığını ve yurt dışı aktarımına verdiğin izni giriş dönüşüne taşır.",
    lifetime: "Kayıtlar, giriş tamamlandığında silinir.",
  },
];

export function CookiesPage() {
  return (
    <LegalShell
      title="Çerez Politikası"
      lead="Bu metin, Lens'in tarayıcında hangi kayıtları ne amaçla tuttuğunu anlatır. Lens'in çalışması için gereken birkaç kayıt her zaman yazılır; ölçüm çerezi ise yalnızca sen izin verirsen yazılır."
    >
      <Section title="Her zaman yazılan kayıtlar">
        <p>
          Bu kayıtlar olmadan Lens çalışamaz ya da verdiğin kararı hatırlayamaz. Bu nedenle bu
          kayıtlar iznine bağlı değildir. Hiçbiri seni başka sitelerde izlemez. Teknik olarak
          bunlar çerez değil, tarayıcının yerel deposundaki kayıtlardır; ancak çerezlerle aynı işi
          gördükleri için bu metinde yer alırlar.
        </p>
        <ul className="space-y-3">
          {STORED.map((item) => (
            <li key={item.name} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <span className="text-white">{item.name}</span>
              <p className="mt-2 text-sm">
                {item.purpose} {item.lifetime}
              </p>
              <p className="mt-1 break-words font-mono text-xs text-slate-500">{item.keys}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Kullanım ölçümü çerezi">
        <p>
          Lens'in nerede işe yaradığını ve nerede tökezlediğini görmek için PostHog adlı bir ölçüm
          aracı kullanılır. Bu araç yalnızca sen izin verirsen çalışır. İzin verdiğinde
          aşağıdakiler gerçekleşir.
        </p>
        <Bullets>
          <li>
            Tarayıcına <span className="font-mono text-sm">ph_…_posthog</span> adlı bir çerez ve
            aynı adla bir yerel depo kaydı yazılır. Bu çerez seni ziyaretler arasında aynı
            ziyaretçi olarak tanır ve bir yıl boyunca tarayıcında kalır.
          </li>
          <li>
            Hangi ekranlara uğradığın, uygulama içinde hangi adımları attığın, dokunduğun yerlerin
            konumu ve sayfaların açılış hızı kaydedilir. Rapor oluşturmak ya da bir öneriye yanıt
            vermek bu adımlara örnektir.
          </li>
          <li>
            Giriş yaptıysan bu kayıtlar hesabınla eşleşir ve PostHog'un ABD'deki sunucularında
            tutulur.
          </li>
        </Bullets>
        <p>
          İzin vermezsen bunların hiçbiri gerçekleşmez. Çerez yazılmaz ve PostHog'a hiçbir istek
          gönderilmez. İzni sonradan kapatırsan ölçüm durur ve çerez silinir. Lens her iki durumda
          da aynı şekilde çalışır.
        </p>
      </Section>

      <Section title="Kararını değiştirmek">
        <p>
          Kararını istediğin an değiştirebilirsin. Giriş yaptıysan Hesabım sekmesindeki Verilerim
          bölümünde yer alan “Kullanım ölçümü” anahtarını kullanabilirsin. Giriş yapmadıysan ana
          sayfanın altındaki “Analitik tercihi” bağlantısını kullanabilirsin.
        </p>
        {analyticsConfigured && (
          <p>
            Kararını değiştirmek için{" "}
            <AnalyticsPreferenceLink className={`${link} font-normal`} /> bağlantısına da
            dokunabilirsin.
          </p>
        )}
      </Section>

      <Section title="Diğer çerezler">
        <p>
          Lens başka bir çerez kullanmaz; sitede reklam ya da sosyal medya çerezi bulunmaz. Google
          ile giriş yaparsan Google'ın kendi sayfasına yönlendirilirsin ve orada yazılan çerezler
          Google'ın kendi politikasına tabi olur.
        </p>
        <p>
          Tarayıcının ayarlarından bu siteye ait bütün kayıtları silebilirsin. Kayıtları sildiğinde
          oturumun kapanır ve analitik kararın yeniden sorulur.
        </p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      title="Kullanım Koşulları"
      lead="Bu metin, Lens'i kullanırken geçerli olan kuralları içerir. Giriş yaparak bu koşulları kabul etmiş olursun."
    >
      <Section title="Hizmetin tanımı">
        <p>
          Lens (lensestetik.com), okuduklarından, izlediklerinden ve dinlediklerinden yola çıkarak
          estetik kimliğine dair bir rapor yazan, sana günlük keşifler ve haftalık seçkiler öneren
          bir hizmettir. Hizmeti <span className="text-white">{who}</span> sunar.
        </p>
      </Section>

      <Section title="Hesabın">
        <p>
          Hesabını e-posta adresinle ya da Google hesabınla açarsın. Hesap sana aittir ve
          başkasına devredilemez. E-posta kutuna erişebilen herkes hesabına da girebilir; bu
          nedenle e-posta kutunun güvenliğinden sen sorumlusun. 18 yaşından küçüksen Lens'i
          velinin bilgisi ve izniyle kullanabilirsin.
        </p>
      </Section>

      <Section title="Yapay zekâ ile yazılan içerik">
        <p>
          Raporlar, keşifler ve seçkiler bir yapay zekâ modeli tarafından yazılır. Bu metinler
          zevkine dair yorumlardır; kesinlik iddia etmez ve psikolojik bir değerlendirme ya da
          profesyonel tavsiye yerine geçmez.
        </p>
        <p>
          Yapay zekâ yanılabilir. Model, var olmayan bir eseri önerebilir ya da bir eseri yanlış
          kişiye atfedebilir. Böyle bir durumla karşılaşırsan bunu bildirmen Lens'in iyileşmesine
          yardımcı olur.
        </p>
      </Section>

      <Section title="Senin içeriğin">
        <p>
          Yazdığın eser listeleri ve yüklediğin ekran görüntüleri sana aittir. Lens bunları
          yalnızca sana rapor ve öneri sunmak için kullanır.
        </p>
        <p>
          Yüklediğin görsel, içindeki eser adlarının okunması için yapay zekâya gönderilir. Bu
          nedenle görselde başkalarına ait mesaj, ad ya da fotoğraf gibi kişisel bilgilerin
          bulunmamasına dikkat etmelisin.
        </p>
      </Section>

      <Section title="Raporlar ve paylaşım">
        <p>
          Raporların, sen paylaşıma açana kadar yalnızca sana görünür. Bir raporu paylaşıma
          açarsan bağlantısına sahip olan herkes onu görebilir. Açtığın raporu istediğin an
          yeniden kapatabilirsin. Raporunu ve posterini dilediğin yerde paylaşabilirsin.
        </p>
        <p>
          İndirdiğin ya da başka bir yerde paylaştığın görseller Lens'in erişiminin dışında kalır.
          Raporu kapatman ya da hesabını silmen bu görselleri geri almaz.
        </p>
      </Section>

      <Section title="Yasak kullanımlar">
        <p>Lens'i kullanırken aşağıdaki kurallara uyman gerekir.</p>
        <Bullets>
          <li>
            Lens'i otomatik araçlarla ya da toplu biçimde yüklememeli ve günlük kullanım
            sınırlarını aşmaya çalışmamalısın.
          </li>
          <li>Başkasının hesabına ya da verisine erişmeye çalışmamalısın.</li>
          <li>Hizmetin işleyişini bozmamalı ve güvenlik önlemlerini aşmaya çalışmamalısın.</li>
          <li>Lens'i hukuka aykırı bir amaçla kullanmamalısın.</li>
        </Bullets>
        <p>
          Bu kurallardan biri ihlal edilirse hesabına erişim kısıtlanabilir ya da hesabın
          kapatılabilir.
        </p>
      </Section>

      <Section title="Fikri haklar">
        <p>
          Lens'in adı, tasarımı, metinleri ve yazılımı Lens'e aittir ve izinsiz kopyalanamaz. Sana
          yazılan raporlar bu kuralın dışındadır; onları kişisel amaçlarınla dilediğin gibi
          kullanabilirsin.
        </p>
      </Section>

      <Section title="Başka sitelere bağlantılar">
        <p>
          Seçkilerdeki “nerede izlenir” bağlantıları seni yayın platformlarına ya da JustWatch'a
          götürür. Bu siteler Lens'e ait değildir. Bu sitelerin içerikleri, koşulları ve gizlilik
          uygulamaları kendi sorumluluklarındadır.
        </p>
      </Section>

      <Section title="Hizmetin durumu">
        <p>
          Lens olduğu gibi sunulur. Özellikler değişebilir, yeni özellikler eklenebilir ya da
          mevcut özellikler kaldırılabilir. Hizmet zaman zaman kesintiye uğrayabilir. Kötüye
          kullanımı önlemek için günlük kullanım sınırları uygulanır.
        </p>
      </Section>

      <Section title="Sorumluluk">
        <p>
          Lens'in önerdiği bir eseri beğenmemen ya da bir raporda kendini bulamaman zarar
          sayılmaz. Hukukun izin verdiği ölçüde, hizmetin kullanımından doğan dolaylı zararlardan
          sorumluluk kabul edilmez. Tüketici mevzuatından doğan hakların saklıdır.
        </p>
      </Section>

      <Section title="Hesabın kapatılması">
        <p>
          Hesabını istediğin an Hesabım sekmesindeki Verilerim bölümünden silebilirsin. Hesabını
          sildiğinde Lens'teki bütün verilerin kalıcı olarak silinir.
        </p>
      </Section>

      <Section title="Kişisel verilerin">
        <p>
          Verilerinin nasıl işlendiğini{" "}
          <Link to="/privacy" className={link}>
            Aydınlatma Metni
          </Link>
          'nde, tarayıcında hangi kayıtların tutulduğunu{" "}
          <Link to="/cookies" className={link}>
            Çerez Politikası
          </Link>
          'nda okuyabilirsin.
        </p>
      </Section>

      <Section title="Koşullardaki değişiklikler">
        <p>
          Bu koşullar değişirse yeni hâli bu sayfada yayımlanır ve sayfanın altındaki tarih
          güncellenir. Değişiklikten sonra Lens'i kullanmaya devam edersen yeni koşulları kabul
          etmiş olursun.
        </p>
      </Section>

      <Section title="Uygulanacak hukuk">
        <p>
          Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır. Tüketici olarak, yerleşim yerindeki
          tüketici hakem heyetine ve tüketici mahkemesine başvurma hakkın saklıdır.
        </p>
      </Section>

      <Section title="İletişim">
        <p>
          Soruların ve taleplerin için <Mail /> adresine yazabilirsin.
        </p>
      </Section>
    </LegalShell>
  );
}
