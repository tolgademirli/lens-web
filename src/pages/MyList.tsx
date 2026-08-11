import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { BookOpen, Check, Film, Music, Trophy, X } from "lucide-react";
import { DashboardShell } from "@/app/components/DashboardShell";
import {
  COMPLETED_BANNER_MIN,
  COMPLETION_VERB,
  HIT_LABEL,
  completeListItem,
  completedThisYear,
  fetchListItems,
  removeListItem,
} from "@/lib/myList";
import { posthog } from "@/lib/posthog";
import type { HitResult, ListItem, WorkType } from "@/lib/types";

const TYPE_ICON: Record<WorkType, typeof BookOpen> = {
  book: BookOpen,
  film: Film,
  song: Music,
};

/** "Film & Dizi" yalnızca görünen metin — WorkType 'film' kalır. */
const TYPE_LABEL: Record<WorkType, string> = {
  book: "Kitap",
  film: "Film & Dizi",
  song: "Müzik",
};

const HIT_BADGE: Record<HitResult, string> = {
  hit: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  miss: "bg-slate-600/30 text-slate-300 border-slate-500/30",
};

type Tab = "pending" | "completed";

export function MyList() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [typeFilter, setTypeFilter] = useState<WorkType | "all">("all");
  const [asking, setAsking] = useState<string | null>(null);

  const load = async () => {
    setItems(await fetchListItems());
  };

  useEffect(() => {
    async function init() {
      await load();
      setLoading(false);
    }
    init();
  }, []);

  const inTab = useMemo(() => items.filter((i) => i.status === tab), [items, tab]);
  const visible = useMemo(
    () => (typeFilter === "all" ? inTab : inTab.filter((i) => i.work_type === typeFilter)),
    [inTab, typeFilter]
  );

  const finishedThisYear = completedThisYear(items);
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const completedCount = items.filter((i) => i.status === "completed").length;

  const handleComplete = async (item: ListItem, result: HitResult) => {
    const ok = await completeListItem(item, result);
    if (ok) {
      posthog.capture("list_item_completed", {
        hit_result: result,
        work_type: item.work_type,
        origin: item.added_from,
      });
      setAsking(null);
      await load();
    }
  };

  const handleRemove = async (item: ListItem) => {
    const ok = await removeListItem(item.id);
    if (ok) {
      posthog.capture("list_item_removed", { work_type: item.work_type, status: item.status });
      setAsking(null);
      await load();
    }
  };

  return (
    <DashboardShell loading={loading}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-5"
      >
        <div>
          <h2 className="font-serif text-2xl text-white">Listem</h2>
          <p className="mt-1 text-sm text-purple-300/70">
            Kaydettiklerin burada bekler; bitirdiklerin isabet sonucuyla arşivlenir.
          </p>
        </div>

        {/*
          Bant 3 eserin altında GİZLİ: 1 eserde bu satır övgü değil, kıtlık gibi
          okunuyor. Eşiği düşürme.
        */}
        {finishedThisYear >= COMPLETED_BANNER_MIN && (
          <div className="flex items-center gap-3 rounded-2xl border border-purple-500/25 bg-slate-800/50 px-5 py-4">
            <Trophy className="h-5 w-5 shrink-0 text-purple-300" />
            <p className="text-sm text-purple-100">
              Bu yıl Lens ile <strong className="text-white">{finishedThisYear} eser</strong> bitirdin.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-purple-500/20 bg-slate-800/40 p-1.5">
          <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
            Bekleyenler · {pendingCount}
          </TabButton>
          <TabButton active={tab === "completed"} onClick={() => setTab("completed")}>
            Bitirdiklerim · {completedCount}
          </TabButton>
        </div>

        {/* Kategori filtreleri — adet gösterilir; boş kategori "0" ile dürüstçe durur. */}
        <div className="flex flex-wrap gap-2">
          <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
            Tümü · {inTab.length}
          </FilterChip>
          {(Object.keys(TYPE_LABEL) as WorkType[]).map((type) => (
            <FilterChip
              key={type}
              active={typeFilter === type}
              onClick={() => setTypeFilter(type)}
            >
              {TYPE_LABEL[type]} · {inTab.filter((i) => i.work_type === type).length}
            </FilterChip>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState tab={tab} filtered={typeFilter !== "all"} />
        ) : (
          <div className="space-y-3">
            {visible.map((item) => (
              <Row
                key={item.id}
                item={item}
                asking={asking === item.id}
                onAsk={() => setAsking(item.id)}
                onCancel={() => setAsking(null)}
                onComplete={(result) => handleComplete(item, result)}
                onRemove={() => handleRemove(item)}
              />
            ))}
          </div>
        )}
      </motion.div>
    </DashboardShell>
  );
}

function Row({
  item,
  asking,
  onAsk,
  onCancel,
  onComplete,
  onRemove,
}: {
  item: ListItem;
  asking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onComplete: (result: HitResult) => void;
  onRemove: () => void;
}) {
  const Icon = TYPE_ICON[item.work_type];

  return (
    <div className="rounded-2xl border border-purple-500/20 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
            <Icon className="h-4 w-4 text-purple-200" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{item.work_title || item.work_creator}</p>
            {item.work_title && item.work_creator && (
              <p className="truncate text-sm text-purple-200/70">{item.work_creator}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {item.status === "completed" && item.hit_result ? (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs ${HIT_BADGE[item.hit_result]}`}
            >
              {HIT_LABEL[item.hit_result]}
            </span>
          ) : (
            !asking && (
              <button
                type="button"
                onClick={onAsk}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-purple-500/30 px-3 py-1.5 text-xs text-purple-100 transition-colors hover:border-purple-400/50 hover:bg-slate-700/50"
              >
                <Check className="h-3.5 w-3.5" />
                {COMPLETION_VERB[item.work_type]}
              </button>
            )
          )}

          {/* Listeden tamamen çıkarma. "Vazgeç" yalnızca soruyu kapatır — çıkarma yolu budur. */}
          <button
            type="button"
            onClick={onRemove}
            aria-label="Listeden çıkar"
            className="rounded-lg p-1.5 text-purple-300/50 transition-colors hover:bg-slate-700/50 hover:text-purple-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Alt soru satır İÇİNDE yerine-koyma ile açılır; satır yüksekliği dışında büyümez. */}
      {asking && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-purple-500/15 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-purple-300/70">İsabet miydi?</span>
            <SmallChip onClick={() => onComplete("hit")}>Evet</SmallChip>
            <SmallChip onClick={() => onComplete("partial")}>Kısmen</SmallChip>
            <SmallChip onClick={() => onComplete("miss")}>Hayır</SmallChip>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="whitespace-nowrap text-xs text-purple-300/70 transition-colors hover:text-purple-200"
          >
            Vazgeç
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab, filtered }: { tab: Tab; filtered: boolean }) {
  const text = filtered
    ? "Bu kategoride henüz bir şey yok."
    : tab === "pending"
      ? "Bekleyen bir şey yok. Keşiflerde \"İlgimi çekti\" dediklerin burada birikir."
      : "Henüz bir eser bitirmedin. Bekleyenler'den birini bitirdiğinde burada arşivlenir.";

  return (
    <div className="rounded-2xl border border-dashed border-purple-500/25 bg-slate-800/30 px-6 py-12 text-center">
      <p className="text-sm text-purple-200/80">{text}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-sm transition-colors ${
        active
          ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
          : "text-purple-200/80 hover:bg-slate-700/40"
      }`}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-purple-400/60 bg-purple-500/20 text-white"
          : "border-purple-500/25 text-purple-200/70 hover:border-purple-400/40 hover:text-purple-100"
      }`}
    >
      {children}
    </button>
  );
}

function SmallChip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-purple-500/30 px-3 py-1 text-xs text-purple-100 transition-colors hover:border-purple-400/50 hover:bg-slate-700/50"
    >
      {children}
    </button>
  );
}
