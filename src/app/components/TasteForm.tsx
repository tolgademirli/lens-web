import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { EmailOptInModal } from "./EmailOptInModal";
import { ImportFlow } from "./ImportFlow";
import { SignalInput } from "./SignalInput";
import { SignalList } from "./SignalList";
import { CATEGORIES, CATEGORY_BY_KEY } from "./categories";
import { getCurrentUser } from "@/lib/supabase";
import { posthog, captureSourcePath } from "@/lib/posthog";
import { MIN_TOTAL_ENTRIES, MAX_ENTRIES_PER_CATEGORY } from "@/lib/formLimits";
import { readPendingReport, writePendingReport } from "@/lib/pendingReport";
import {
  CATEGORY_KEYS,
  draftTotal,
  emptyDraft,
  entryFromText,
  readSessionDraft,
  writeSessionDraft,
  type CategoryKey,
  type TasteDraft,
} from "@/lib/tasteDraft";
import type { WorkEntry } from "@/lib/types";

/**
 * Tek ekranlı sinyal formu — eski üç adımlı akışın (BooksStep/MoviesStep/MusicStep)
 * yerini alır.
 *
 * Eşik TOPLAMDA 6, dağılım serbest: 6+0+0 da geçerli. Kategori zorunluluğu
 * kaldırıldı çünkü "3 favori film yaz" ekranı, film izlemeyen kullanıcıya
 * "bu uygulama benim için değilmiş" dedirtip terk ettiriyordu.
 */
export function TasteForm() {
  const navigate = useNavigate();

  // Taslak sessionStorage'dan geri yüklenir; boşsa OAuth köprüsünden seed edilir
  // (magic link'i yeni sekmede açan kullanıcının sessionStorage'ı boş gelir).
  const [data, setData] = useState<TasteDraft>(() => {
    const session = readSessionDraft();
    if (draftTotal(session) > 0) return session;
    return readPendingReport() ?? emptyDraft();
  });

  const [active, setActive] = useState<CategoryKey>("books");
  const [importing, setImporting] = useState<CategoryKey | null>(null);
  const [scope, setScope] = useState<"all" | "active">("all");
  const [drafts, setDrafts] = useState<Record<CategoryKey, string>>({
    books: "", movies: "", music: "",
  });
  const [showEmailModal, setShowEmailModal] = useState(false);

  // Taslak her değişimde yazılır, yalnızca gönderimde değil: kullanıcı sayfayı
  // yenilediğinde ya da sekmeyi kazara kapattığında yazdıkları durmalı.
  useEffect(() => {
    writeSessionDraft(data);
  }, [data]);

  const formStartedRef = useRef(false);
  // Edinim yolu event'i kategori başına bir kez düşer — her giriş için ayrı değil.
  const pathCapturedRef = useRef<Record<CategoryKey, boolean>>({
    books: false, movies: false, music: false,
  });

  const counts = {
    books: data.books.length,
    movies: data.movies.length,
    music: data.music.length,
  };
  const total = counts.books + counts.movies + counts.music;
  const ready = total >= MIN_TOTAL_ENTRIES;
  const activeConfig = CATEGORY_BY_KEY[active];

  /**
   * Tüm mutasyonlar buradan geçer. Sinyaller tek dizi olduğu için eskiden üç
   * paralel diziyi (entries/sources/workIds) elle senkron tutma derdi yok.
   */
  function mutate(key: CategoryKey, fn: (entries: WorkEntry[]) => WorkEntry[]) {
    setData((prev) => ({ ...prev, [key]: fn(prev[key]) }));
  }

  function markStarted() {
    if (formStartedRef.current) return;
    formStartedRef.current = true;
    posthog.capture("form_started");
  }

  function handleAdd(key: CategoryKey) {
    // Kaynak tek yerde belirlenir: aynı değişken hem listeye (oradan analyze →
    // user_works.source) hem event'e gider.
    const source = "manual" as const;
    const entry = entryFromText(drafts[key], source);
    if (!entry || counts[key] >= MAX_ENTRIES_PER_CATEGORY) return;

    markStarted();
    if (!pathCapturedRef.current[key]) {
      pathCapturedRef.current[key] = true;
      captureSourcePath(CATEGORY_BY_KEY[key].workType, [source]);
    }
    mutate(key, (entries) => [...entries, entry]);
    setDrafts((prev) => ({ ...prev, [key]: "" }));
  }

  function handleImported(key: CategoryKey, imported: WorkEntry[]) {
    mutate(key, (entries) =>
      [...entries, ...imported].slice(0, MAX_ENTRIES_PER_CATEGORY)
    );
    markStarted();
    // Kütüphaneye yazılan source dizisinin ta kendisi event'e geçer.
    captureSourcePath(CATEGORY_BY_KEY[key].workType, imported.map((e) => e.source));
    setImporting(null);
  }

  /** Yalnızca title/creator değişir: source tarihsel bir gerçek, workId aynı kayıt. */
  function handleEdit(
    key: CategoryKey,
    index: number,
    patch: { title: string; creator: string }
  ) {
    const before = data[key][index];
    if (!before) return;

    const changedCreator = before.creator !== patch.creator;
    const changedTitle = before.title !== patch.title;
    if (!changedCreator && !changedTitle) return;

    posthog.capture("signal_edited", {
      field: changedCreator && changedTitle ? "both" : changedCreator ? "creator" : "title",
      source: before.source,
    });
    mutate(key, (entries) =>
      entries.map((e, i) => (i === index ? { ...e, ...patch } : e))
    );
  }

  function handleRemove(key: CategoryKey, index: number) {
    mutate(key, (entries) => entries.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!ready) return;

    // sessionStorage'ı yukarıdaki effect zaten güncel tutuyor; burada yalnızca
    // OAuth/magic link köprüsü yazılır — redirect sekme sessionStorage'ını sıfırlar.
    // İkisinin ayrı durması kasıtlı, tek kaynağa indirme.
    writePendingReport(data);

    posthog.capture("form_completed", {
      total,
      books: counts.books,
      movies: counts.movies,
      music: counts.music,
      empty_categories: CATEGORY_KEYS.filter((k) => counts[k] === 0).length,
    });

    const user = await getCurrentUser();
    if (user) {
      navigate("/generating");
      return;
    }
    posthog.capture("auth_gate_shown");
    setShowEmailModal(true);
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-start justify-center p-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl w-full bg-slate-800/90 backdrop-blur-sm rounded-3xl shadow-2xl p-8 md:p-12 border border-purple-500/20"
        >
          {/* Üç satır, üç ayrı iş: başlık davet eder, alt başlık ne ekleneceğini
              söyler, ilerleme satırı durumu verir. "6" yalnızca ilerleme satırında
              yaşıyor — başlıkta ve alt başlıkta da tekrarlanınca kaldırmaya
              çalıştığımız "kota" hissini geri getiriyordu. */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center justify-center w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl mb-1 text-white">Hadi, seni tanıyayım</h1>
              <p className="text-purple-200">
                Son zamanlarda seni etkileyen kitap, film veya müzikleri ekle.
              </p>
            </div>
          </div>

          {/* Sayaç: sürekli çubuk değil, altı segment. Hedef altı sinyal. */}
          <div className="bg-purple-900/30 border border-purple-500/30 rounded-2xl px-5 py-4 mb-8">
            <p className="flex items-center gap-2 text-sm">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  ready ? "bg-emerald-400" : "bg-purple-400"
                }`}
              />
              {ready ? (
                <span className="text-emerald-200">
                  Hazırım, istersen birkaç şey daha ekle · {total} sinyal
                </span>
              ) : (
                <span className="text-purple-100">
                  Nereden geldiği değil, sende ne bıraktığı önemli ·{" "}
                  <strong className="font-medium">{total}/{MIN_TOTAL_ENTRIES}</strong>
                </span>
              )}
            </p>
            <div className="flex gap-2 mt-3" aria-hidden>
              {Array.from({ length: MIN_TOTAL_ENTRIES }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i < total
                      ? ready ? "bg-emerald-400" : "bg-purple-500"
                      : "bg-slate-700"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Sekmeler. İçe aktarım sürerken kilitli: sekme değişimi ImportFlow'u
              unmount edip kullanıcının onay ekranını çöpe atardı. */}
          <div
            role="tablist"
            aria-label="Sinyal kategorileri"
            className="flex gap-6 border-b border-purple-500/20"
          >
            {CATEGORIES.map((cfg, i) => {
              const selected = active === cfg.key;
              return (
                <button
                  key={cfg.key}
                  role="tab"
                  aria-selected={selected}
                  disabled={importing !== null}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + CATEGORIES.length) % CATEGORIES.length;
                    setActive(CATEGORIES[next].key);
                  }}
                  onClick={() => setActive(cfg.key)}
                  className={`flex items-center gap-2 pb-3 -mb-px border-b-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    selected
                      ? "border-purple-400 text-white"
                      : "border-transparent text-purple-300 hover:text-purple-100"
                  }`}
                >
                  <cfg.icon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
                  {cfg.label}
                  {counts[cfg.key] > 0 && (
                    <span
                      className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                        counts[cfg.key] >= MAX_ENTRIES_PER_CATEGORY
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-purple-500/25 text-purple-100"
                      }`}
                    >
                      {counts[cfg.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {importing !== null && (
            <p className="text-xs text-purple-300 mt-3">
              Önce bu listeyi onayla ya da vazgeç.
            </p>
          )}

          {/* pb-24: yapışkan footer yüksekliği kadar pay. Yoksa kaydırırken son
              sinyal butonun altında kalıp kesiliyor. */}
          <div className="mt-8 pb-24">
            {importing === active ? (
              <ImportFlow
                type={activeConfig.workType}
                sourceChips={activeConfig.sourceChips}
                textPlaceholder={activeConfig.textPlaceholder}
                existingCount={counts[active]}
                onConfirm={(entries) => handleImported(active, entries)}
                onCancel={() => setImporting(null)}
              />
            ) : (
              <>
                <SignalInput
                  value={drafts[active]}
                  placeholder={activeConfig.placeholder}
                  help={activeConfig.help}
                  full={counts[active] >= MAX_ENTRIES_PER_CATEGORY}
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [active]: value }))}
                  onAdd={() => handleAdd(active)}
                  onImport={() => setImporting(active)}
                />

                <SignalList
                  draft={data}
                  activeKey={active}
                  scope={scope}
                  onScopeChange={setScope}
                  onEdit={handleEdit}
                  onRemove={handleRemove}
                />
              </>
            )}
          </div>

          {/* İçe aktarımın kendi birincil butonu var; iki birincil yan yana durmasın.
              CTA yapışkan: liste uzayınca görüş alanında kalır. Arkasındaki zemin
              şart — yoksa altındaki satırın üstüne binip ikisi de okunmaz oluyor. */}
          {importing === null && (
            <div className="sticky bottom-4 -mt-16 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl bg-slate-800/95 backdrop-blur-sm border border-purple-500/20 px-5 py-4 shadow-2xl">
              <p className="text-xs text-purple-300">
                Onaylamadan hiçbir şey rapora girmez.
              </p>
              <Button
                onClick={handleSubmit}
                disabled={!ready}
                size="lg"
                // Etiket iki durumda da aynı: hedefi söyler, kotayı değil.
                // Kaç sinyal kaldığı bilgisi ilerleme satırında yaşıyor — "6"yı
                // butona da koyunca kaldırmaya çalıştığımız eşik hissi geri geliyordu.
                // Pasifken de okunur olmalı: slate-700 üstünde purple-200 7.61:1.
                // disabled:opacity-100 şart: Button tabanında disabled:opacity-50
                // var ve %50 opaklık ölçülen oranı geri düşürüyor.
                className={`w-full sm:w-auto h-14 px-8 rounded-xl transition-all ${
                  ready
                    ? "text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-purple-500/40"
                    : "bg-slate-700 text-purple-200 cursor-not-allowed disabled:opacity-100"
                }`}
              >
                Arketipimi Göster
              </Button>
            </div>
          )}
        </motion.div>
      </div>

      <EmailOptInModal open={showEmailModal} onOpenChange={setShowEmailModal} />
    </>
  );
}
