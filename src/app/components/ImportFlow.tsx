import { useState, useRef, useEffect } from "react";
import {
  Upload, ClipboardList, X, Check, Pencil, Trash2, AlertTriangle, Loader2, Plus,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { motion, AnimatePresence } from "motion/react";
import { posthog } from "@/lib/posthog";
import { extractWorks, fileToBase64, workToEntry, ExtractError } from "@/lib/extractWorks";
import { saveWorksToLibrary } from "@/lib/userWorks";
import type { ExtractedWork, WorkSource, WorkType } from "@/lib/types";

// Rapora giren eser sayısı bounded: kategori başına 3-8 ("kütüphane sınırsız, rapor bounded").
const MIN_SELECTED = 3;
const MAX_SELECTED = 8;
const MAX_FILES = 5;

const YARATICI_LABEL: Record<WorkType, string> = {
  book: "Yazar",
  film: "Yönetmen",
  song: "Sanatçı",
};

type Phase = "input" | "processing" | "confirm" | "empty";

/** Onay ekranındaki satır — çıkarılan eser + kullanıcının seçim/düzenleme durumu. */
interface Row extends ExtractedWork {
  id: string;
  selected: boolean;
}

interface ImportFlowProps {
  type: WorkType;
  /** "Kitap" | "Film" | "Müzik" — kullanıcıya dönük metinlerde geçer. */
  categoryLabel: string;
  /** Bu kategoride en iyi sonucu veren kaynaklar (brief §2b çipleri). */
  sourceChips: string[];
  textPlaceholder: string;
  /** Halihazırda listede olan giriş sayısı — üst sınır buna göre daralır. */
  existingCount: number;
  /** workIds: rapora giren satırların havuzdaki karşılıkları (yoksa boş string). */
  onConfirm: (entries: string[], sources: WorkSource[], workIds: string[]) => void;
  onCancel: () => void;
}

export function ImportFlow({
  type, categoryLabel, sourceChips, textPlaceholder, existingCount, onConfirm, onCancel,
}: ImportFlowProps) {
  const [tab, setTab] = useState<"screenshot" | "paste">("screenshot");
  const [phase, setPhase] = useState<Phase>("input");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [batchId, setBatchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const yaraticiLabel = YARATICI_LABEL[type];
  const remainingSlots = Math.max(0, MAX_SELECTED - existingCount);
  const selectedCount = rows.filter((r) => r.selected).length;
  // Yaratıcısı çözülemeyen satırlar — kullanıcı tamamlamadan rapora giremezler.
  const unresolvedCount = rows.filter((r) => !r.creator.trim()).length;
  const canConfirm = selectedCount >= 1 && selectedCount + existingCount >= MIN_SELECTED;
  const hasInput = tab === "screenshot" ? files.length > 0 : text.trim().length > 0;

  // Ctrl+V ile panodan ekran görüntüsü yapıştırma (brief §2b).
  useEffect(() => {
    if (phase !== "input" || tab !== "screenshot") return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (pasted.length) addFiles(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [phase, tab, files]);

  // Onay ekranındaki yan yana karşılaştırma için object URL'leri.
  // Güveni en çok artıran unsur bu: kullanıcı çıkarımı kaynağıyla karşılaştırabiliyor.
  useEffect(() => {
    if (phase !== "confirm" || files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [phase, files]);

  function addFiles(incoming: File[]) {
    setError(null);
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
  }

  async function handleExtract() {
    setError(null);
    setPhase("processing");
    posthog.capture("screenshot_upload_started", { type, mode: tab });

    try {
      const payload =
        tab === "screenshot"
          ? { type, images: await Promise.all(files.map(fileToBase64)) }
          : { type, text: text.trim() };

      const result = await extractWorks(payload);

      if (result.works.length === 0) {
        posthog.capture("extraction_empty", { type, mode: tab });
        setPhase("empty");
        return;
      }

      posthog.capture("works_extracted", { type, mode: tab, count: result.works.length });
      setBatchId(result.batch_id);
      setRows(
        result.works.map((w, i) => ({
          ...w,
          id: `${result.batch_id}-${i}`,
          // Üst sınırı aşan satırlar listede kalır ama seçimsiz gelir —
          // kullanıcı hangilerinin rapora gireceğini kendisi belirlesin.
          // Yaratıcısı çözülemeyenler de seçimsiz: önce tamamlanmalı.
          selected: i < remainingSlots && !!w.creator.trim(),
        }))
      );
      setPhase("confirm");
    } catch (err) {
      setError(err instanceof ExtractError ? err.message : "Bir hata oluştu. Lütfen tekrar deneyin.");
      setPhase("input");
    }
  }

  function toggle(id: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        // Yaratıcısı boş satır rapora giremez — önce düzenlenmeli.
        if (!r.creator.trim()) return r;
        if (!r.selected && selectedCount + existingCount >= MAX_SELECTED) return r;
        return { ...r, selected: !r.selected };
      })
    );
  }

  function removeRow(id: string) {
    posthog.capture("item_removed", { type });
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addManualRow() {
    const id = `manual-${Date.now()}`;
    setRows((prev) => [
      ...prev,
      {
        id,
        creator: "",
        title: "",
        confidence: "high",
        title_readable: true,
        // Elle eklenen eser 'manual' — 'paste' DEĞİL. Edinim analitiği buna bağlı.
        source: "manual" as WorkSource,
        selected: selectedCount + existingCount < MAX_SELECTED,
      } as Row,
    ]);
    setEditingId(id);
  }

  async function handleConfirm() {
    // Havuza rapora girecekler DEĞİL, onay ekranında bırakılan HER ŞEY yazılır.
    // Kullanıcının sildiği satırlar zaten rows'ta yok; kalanlar kütüphaneye ait.
    const kept = rows.filter((r) => r.creator.trim());
    posthog.capture("extraction_confirmed", {
      type,
      selected_count: kept.filter((r) => r.selected).length,
      saved_count: kept.length,
    });

    setSaving(true);
    let ids: string[] = [];
    try {
      ids = await saveWorksToLibrary(
        type,
        kept.map((r) => ({
          creator: r.creator,
          title: r.title,
          source: r.source,
          confidence: r.source === "manual" ? undefined : r.confidence,
        })),
        batchId || crypto.randomUUID()
      );
    } finally {
      setSaving(false);
    }

    const chosenIdx = kept.map((r, i) => ({ row: r, id: ids[i] ?? "" })).filter((x) => x.row.selected);
    onConfirm(
      chosenIdx.map((x) => workToEntry(x.row)),
      chosenIdx.map((x) => x.row.source),
      chosenIdx.map((x) => x.id)
    );
  }

  // ---------------------------------------------------------------- işleniyor
  if (phase === "processing") {
    return (
      <div className="py-12 text-center">
        <Loader2 className="w-12 h-12 mx-auto mb-6 text-purple-400 animate-spin" />
        <h3 className="text-2xl text-white mb-2">Listen okunuyor</h3>
        <p className="text-purple-200 mb-8">
          Genelde birkaç saniye sürüyor. Sonucu onayına sunacağım.
        </p>
        <div className="space-y-3 max-w-md mx-auto mb-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-slate-700/40 animate-pulse" />
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={onCancel}
          className="text-purple-200 hover:text-white hover:bg-slate-700"
        >
          İptal
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------- guardrail (boş/hata)
  if (phase === "empty") {
    return (
      <div className="py-8">
        <div className="max-w-lg mx-auto bg-slate-700/40 border border-purple-500/30 rounded-2xl p-8">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-5">
            <AlertTriangle className="w-6 h-6 text-amber-300" />
          </div>
          <h3 className="text-2xl text-white mb-3">Bu listeyi okuyamadım</h3>
          <p className="text-purple-200 mb-6">
            Görselde tanıyabildiğim bir eser ya da yaratıcı yok. Uydurma bir profil
            çıkarmak yerine duruyorum — gerçek bir liste ver, birlikte devam edelim.
          </p>
          <div className="bg-slate-800/60 border border-purple-500/20 rounded-xl p-4 mb-6">
            <p className="text-xs uppercase tracking-wide text-purple-300 mb-1">
              İşe yarayan kaynaklar
            </p>
            <p className="text-sm text-purple-100">{sourceChips.join(" · ")}</p>
          </div>
          <div className="space-y-3">
            <Button
              onClick={() => { setFiles([]); setText(""); setPhase("input"); }}
              className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl"
            >
              Yeniden dene
            </Button>
            <Button
              variant="ghost"
              onClick={onCancel}
              className="w-full h-12 text-purple-200 hover:text-white hover:bg-slate-700 rounded-xl"
            >
              Elle yazarak devam et
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ onay & düzeltme
  if (phase === "confirm") {
    return (
      <div>
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="text-2xl text-white mb-1">Doğru anladım mı?</h3>
            <p className="text-purple-200 text-sm">
              Yaratıcı adı yeterli — başlıkları boş bırakabilirsin. Sana ait olmayanı
              çıkar, yanlış yazılmışı düzelt.
            </p>
          </div>
          <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-900/40 border border-emerald-500/40 text-emerald-200 text-sm">
            <Check className="w-4 h-4" />
            {selectedCount} / {rows.length} seçili
          </span>
        </div>

        <p className="text-xs text-purple-300 mb-4">
          İşaretli satırlar rapora dahil edilecek. Kategori başına en fazla{" "}
          {MAX_SELECTED} eser rapora girer — kalanlar kütüphanende durur.
        </p>

        {unresolvedCount > 0 && (
          <p className="text-sm text-amber-100 bg-amber-900/25 border border-amber-500/30 rounded-xl p-3 mb-4">
            <strong className="font-medium">
              {unresolvedCount} satırı çözemedim.
            </strong>{" "}
            Bunları tahmin etmek yerine sana bırakıyorum — aşağıda sarı işaretli
            satırlardaki {yaraticiLabel.toLowerCase()} adını doldurursan rapora
            girebilirler.
          </p>
        )}

        <div className="grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-6 mb-6">
          {/* Sol: kaynak. Sağdaki satırlarla karşılaştırılabilsin diye yan yana. */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <p className="text-[11px] uppercase tracking-wide text-purple-300 mb-2">
              {previews.length > 0 ? "Yüklediğin görsel" : "Yapıştırdığın metin"}
            </p>
            <div className="rounded-xl border border-purple-500/20 bg-slate-900/40 p-2 max-h-[28rem] overflow-y-auto space-y-2">
              {previews.length > 0 ? (
                previews.map((url, i) => (
                  <figure key={url}>
                    <img
                      src={url}
                      alt={`Yüklenen görsel ${i + 1}`}
                      className="w-full rounded-lg border border-purple-500/10"
                    />
                    <figcaption className="text-[11px] text-purple-300/70 mt-1 px-1 truncate">
                      {files[i]?.name} · {i + 1}/{previews.length}
                    </figcaption>
                  </figure>
                ))
              ) : (
                <pre className="text-xs text-purple-100 whitespace-pre-wrap break-words p-2 font-sans">
                  {text}
                </pre>
              )}
            </div>
            <p className="text-[11px] text-purple-300/70 mt-2">
              Sağdaki satırlarla karşılaştırabilirsin.
            </p>
          </div>

        <div className="space-y-3">
          <AnimatePresence>
            {rows.map((row) => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`group flex items-start gap-3 p-4 rounded-xl border transition-colors ${
                  !row.creator.trim()
                    ? "bg-amber-900/15 border-amber-500/40"
                    : row.selected
                    ? "bg-slate-700/50 border-purple-500/40"
                    : "bg-slate-800/40 border-slate-600/40"
                }`}
              >
                <button
                  onClick={() => toggle(row.id)}
                  aria-label={row.selected ? "Rapordan çıkar" : "Rapora ekle"}
                  className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center border transition-colors ${
                    row.selected
                      ? "bg-purple-500 border-purple-400 text-white"
                      : "border-purple-400/40 text-transparent hover:border-purple-400"
                  }`}
                >
                  <Check className="w-4 h-4" />
                </button>

                <div className="flex-1 min-w-0">
                  {editingId === row.id ? (
                    <div className="space-y-2">
                      <Input
                        autoFocus
                        value={row.creator}
                        onChange={(e) => updateRow(row.id, { creator: e.target.value })}
                        placeholder="Yaratıcı adı (zorunlu)"
                        className="h-10 bg-slate-800 border-purple-500/40 text-white placeholder:text-purple-300/50"
                      />
                      <Input
                        value={row.title}
                        onChange={(e) =>
                          updateRow(row.id, { title: e.target.value, title_readable: true })
                        }
                        placeholder="Eser adı (opsiyonel)"
                        className="h-10 bg-slate-800 border-purple-500/40 text-white placeholder:text-purple-300/50"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          posthog.capture("item_edited", { type });
                          setEditingId(null);
                        }}
                        className="bg-purple-500 hover:bg-purple-600 text-white"
                      >
                        Tamam
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="text-purple-50 font-medium truncate">
                        {row.creator || <span className="text-purple-300/60">Yaratıcı adı gerekli</span>}
                      </p>
                      <p className="text-sm text-purple-300 truncate">
                        {row.title || "Eser adı — boş kalabilir"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-500/30 text-[11px] text-purple-200">
                          {row.source === "screenshot"
                            ? "ekran görüntüsü"
                            : row.source === "paste"
                            ? "yapıştırıldı"
                            : "manuel"}
                        </span>
                        {/* Model tamamladıysa "yüksek eşleşme" demek yanıltıcı olur —
                            kullanıcı doğrulayabilsin diye ayrı ve öne çıkan rozet. */}
                        {row.creator_inferred && row.creator ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-500/40 text-[11px] text-amber-200">
                            yazarı ben tamamladım — kontrol et
                          </span>
                        ) : !row.creator ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-500/40 text-[11px] text-amber-200">
                            {yaraticiLabel} adı gerekli
                          </span>
                        ) : row.source !== "manual" ? (
                          <span className="text-[11px] text-purple-300/80">
                            {!row.title_readable
                              ? "başlık okunamadı"
                              : row.confidence === "high"
                              ? "yüksek eşleşme"
                              : row.confidence === "medium"
                              ? "orta eşleşme"
                              : "düşük eşleşme"}
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>

                {editingId !== row.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingId(row.id)}
                      aria-label="Düzenle"
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-purple-300 hover:text-white hover:bg-slate-600/50"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeRow(row.id)}
                      aria-label="Sil"
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-purple-300 hover:text-white hover:bg-slate-600/50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          <button
            onClick={addManualRow}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-purple-500/30 text-purple-200 hover:text-white hover:border-purple-400 transition-colors"
          >
            <Plus className="w-4 h-4" /> Manuel ekle
          </button>
        </div>
        </div>

        {!canConfirm && (
          <p className="text-sm text-amber-200 bg-amber-900/30 border border-amber-500/30 rounded-xl p-3 mb-4 text-center">
            Devam etmek için en az {MIN_SELECTED} eser gerekiyor
            {existingCount > 0 && ` (listende ${existingCount} tane var)`}.
          </p>
        )}

        <div className="flex justify-between items-center pt-4 border-t border-purple-500/20">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-purple-200 hover:text-white hover:bg-slate-700"
          >
            Elle yazmaya devam et
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm || saving}
            size="lg"
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-8 rounded-xl disabled:opacity-50"
          >
            {saving ? "Kaydediliyor..." : `${selectedCount} eserle devam et`}
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ yükle / yapıştır
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900/50 rounded-xl mb-6">
        {(["screenshot", "paste"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-11 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              tab === t ? "bg-purple-500 text-white" : "text-purple-200 hover:bg-slate-700/50"
            }`}
          >
            {t === "screenshot" ? <Upload className="w-4 h-4" /> : <ClipboardList className="w-4 h-4" />}
            {t === "screenshot" ? "Ekran görüntüsü" : "Metin yapıştır"}
          </button>
        ))}
      </div>

      {tab === "screenshot" ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              dragging ? "border-purple-400 bg-purple-900/20" : "border-purple-500/30 hover:border-purple-400/60"
            }`}
          >
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Upload className="w-6 h-6 text-white" />
            </div>
            <p className="text-white mb-1">Ekran görüntüsünü buraya sürükle</p>
            <p className="text-sm text-purple-300">
              PNG, JPG · en fazla {MAX_FILES} dosya · dosya başına 10 MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          <p className="text-xs text-purple-300 mt-3">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-700 border border-purple-500/30">Ctrl + V</kbd>{" "}
            Panodaki ekran görüntüsünü doğrudan yapıştırabilirsin.
          </p>

          {files.length > 0 && (
            <div className="space-y-2 mt-4">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-700/40 border border-purple-500/20"
                >
                  <span className="flex-1 text-sm text-purple-100 truncate">{f.name}</span>
                  <span className="text-xs text-purple-300 shrink-0">
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                    aria-label="Dosyayı çıkar"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-purple-300 hover:text-white hover:bg-slate-600/50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={textPlaceholder}
            rows={8}
            className="w-full rounded-2xl bg-slate-700/50 border-2 border-purple-500/30 focus:border-purple-400 text-white placeholder:text-purple-300/50 p-4 outline-none resize-none"
          />
          <p className="text-xs text-purple-300 mt-2">
            Her satıra bir eser ekle. Yaratıcı adı veya başlık yeterli — gerisini ben çıkarırım.
          </p>
        </>
      )}

      <div className="mt-6">
        <p className="text-xs uppercase tracking-wide text-purple-300 mb-2">
          En iyi sonuç veren kaynaklar
        </p>
        <div className="flex flex-wrap gap-2">
          {sourceChips.map((chip) => (
            <span
              key={chip}
              className="px-3 py-1 rounded-full bg-slate-700/50 border border-purple-500/20 text-xs text-purple-200"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-200 bg-red-900/30 border border-red-500/30 rounded-xl p-3">
          {error}
        </p>
      )}

      <div className="flex justify-between items-center gap-3 pt-6 mt-6 border-t border-purple-500/20">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="text-purple-200 hover:text-white hover:bg-slate-700"
        >
          Elle yazmaya devam et
        </Button>
        <Button
          onClick={handleExtract}
          disabled={!hasInput}
          size="lg"
          className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-8 rounded-xl disabled:opacity-50"
        >
          {hasInput ? `${categoryLabel} eserlerini çıkar` : "Önce görsel ya da metin ekle"}
        </Button>
      </div>
    </div>
  );
}
