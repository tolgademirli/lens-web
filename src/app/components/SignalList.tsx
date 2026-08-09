import { useState } from "react";
import { Pencil, X, type LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CATEGORY_BY_KEY, CATEGORIES, SOURCE_LABELS } from "./categories";
import { CATEGORY_KEYS, type CategoryKey, type TasteDraft } from "@/lib/tasteDraft";
import type { WorkEntry } from "@/lib/types";

interface SignalListProps {
  draft: TasteDraft;
  activeKey: CategoryKey;
  scope: "all" | "active";
  onScopeChange: (scope: "all" | "active") => void;
  /** Yalnızca title/creator değişir — source ve workId korunur. */
  onEdit: (key: CategoryKey, index: number, patch: { title: string; creator: string }) => void;
  onRemove: (key: CategoryKey, index: number) => void;
}

interface Editing {
  key: CategoryKey;
  index: number;
  creator: string;
  title: string;
}

/**
 * Satırın kategori işareti. Eskiden "Kt/Fl/Mz" kısaltmasıydı — hem soluk hem
 * anlamı belirsizdi. İkon tarama hızını artırıyor; ad ekran okuyucuya kalıyor.
 */
function CategoryIcon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span
      className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-200"
      title={label}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SignalList({
  draft, activeKey, scope, onScopeChange, onEdit, onRemove,
}: SignalListProps) {
  const [editing, setEditing] = useState<Editing | null>(null);

  const total = CATEGORY_KEYS.reduce((sum, key) => sum + draft[key].length, 0);
  if (total === 0) return null;

  const shownKeys = scope === "active" ? [activeKey] : CATEGORY_KEYS;
  const rows = shownKeys.flatMap((key) =>
    draft[key].map((entry, index) => ({ key, index, entry }))
  );

  const emptyLabels = CATEGORIES.filter((c) => draft[c.key].length === 0).map((c) => c.label);

  function startEdit(key: CategoryKey, index: number, entry: WorkEntry) {
    setEditing({ key, index, creator: entry.creator, title: entry.title });
  }

  function save() {
    if (!editing) return;
    const creator = editing.creator.trim();
    const title = editing.title.trim();
    // İkisi birden boş bir sinyal rapora giremez — kaydetmeyi engelle.
    if (!creator && !title) return;
    onEdit(editing.key, editing.index, { creator, title });
    setEditing(null);
  }

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="text-sm text-purple-300">Sinyallerin · {total}</p>
        <button
          onClick={() => onScopeChange(scope === "all" ? "active" : "all")}
          className="text-sm text-purple-200 hover:text-white underline underline-offset-4 decoration-purple-500/40 transition-colors"
        >
          {scope === "all" ? "sadece bu kategori" : "hepsini göster"}
        </button>
      </div>

      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {rows.map(({ key, index, entry }) => {
            const isEditing =
              editing !== null && editing.key === key && editing.index === index;
            const sourceLabel = SOURCE_LABELS[entry.source];

            return (
              <motion.li
                key={`${key}-${index}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="p-4 bg-slate-700/50 rounded-xl border border-purple-500/20 hover:bg-slate-700 transition-colors"
              >
                {isEditing ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <CategoryIcon
                      icon={CATEGORY_BY_KEY[key].icon}
                      label={CATEGORY_BY_KEY[key].label}
                    />
                    <Input
                      value={editing.creator}
                      onChange={(e) => setEditing({ ...editing, creator: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && save()}
                      placeholder="Yazar / yönetmen / sanatçı"
                      aria-label="Yaratıcı adı"
                      autoFocus
                      className="flex-1 min-w-0 h-11 rounded-lg bg-slate-800/60 border-purple-500/30 text-white placeholder:text-purple-300/70 focus:border-purple-400"
                    />
                    <Input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && save()}
                      placeholder="Eser adı — boş kalabilir"
                      aria-label="Eser adı"
                      className="flex-1 min-w-0 h-11 rounded-lg bg-slate-800/60 border-purple-500/30 text-purple-100 placeholder:text-purple-300/70 focus:border-purple-400"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={save}
                        disabled={!editing.creator.trim() && !editing.title.trim()}
                        className="h-11 px-4 rounded-lg bg-purple-500 hover:bg-purple-600 text-white disabled:bg-slate-600 disabled:opacity-60"
                      >
                        Kaydet
                      </Button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-sm text-purple-300 hover:text-white transition-colors px-2"
                      >
                        Vazgeç
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <CategoryIcon
                      icon={CATEGORY_BY_KEY[key].icon}
                      label={CATEGORY_BY_KEY[key].label}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-white font-medium">
                        {entry.creator || entry.title}
                      </span>
                      {entry.creator && entry.title && (
                        <span className="text-purple-200 sm:ml-2 block sm:inline">
                          {entry.title}
                        </span>
                      )}
                      {sourceLabel && (
                        <span className="text-xs text-purple-300 sm:ml-3 block sm:inline">
                          {sourceLabel}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(key, index, entry)}
                      aria-label="Sinyali düzenle"
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-purple-300 hover:text-white hover:bg-slate-600/50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onRemove(key, index)}
                      aria-label="Sinyali çıkar"
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-purple-300 hover:text-white hover:bg-slate-600/50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {emptyLabels.length > 0 && (
        <div className="mt-6 bg-purple-900/30 border border-purple-500/30 rounded-2xl p-4">
          <p className="text-sm text-purple-100 leading-relaxed">
            <strong className="font-medium">{emptyLabels.join(" ve ")}</strong> tarafında
            veri vermedin. Arketipini eldeki sinyallerden kuracağım ve raporda bunu
            açıkça yazacağım — sonradan eklersen yeni bir okuma çıkarabilirsin.
          </p>
        </div>
      )}
    </div>
  );
}
