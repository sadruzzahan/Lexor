import { motion } from "framer-motion";
import type { MapStats } from "@/lib/api";

interface Props {
  stats: MapStats | null;
}

const VERTICAL_LABEL: Record<string, string> = {
  eviction: "evictions",
  debt: "debt cases",
  wage: "wage cases",
  other: "other",
};

export function StatTicker({ stats }: Props) {
  if (!stats) {
    return (
      <div className="rounded-xl2 border border-border-strong bg-bg-elevated/80 backdrop-blur-md px-5 py-3 text-fg-subtle text-sm">
        Counting…
      </div>
    );
  }
  return (
    <div className="rounded-xl2 border border-border-strong bg-bg-elevated/80 backdrop-blur-md px-5 py-3 flex items-center gap-6">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          Total pins
        </div>
        <motion.div
          key={stats.totalMarkers}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-2xl text-fg tabular-nums"
        >
          {stats.totalMarkers.toLocaleString()}
        </motion.div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          New this week
        </div>
        <div className="font-display text-2xl text-accent tabular-nums">
          +{stats.weekMarkers.toLocaleString()}
        </div>
      </div>
      <div className="h-8 w-px bg-border hidden sm:block" />
      <div className="hidden sm:flex items-center gap-3 text-xs text-fg-muted">
        {stats.byVertical.slice(0, 4).map((v) => (
          <div key={v.vertical} className="flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{
                background:
                  v.vertical === "eviction"
                    ? "#ff5470"
                    : v.vertical === "debt"
                      ? "#ffba49"
                      : v.vertical === "wage"
                        ? "#3ddbd9"
                        : "#9b87ff",
              }}
            />
            <span className="tabular-nums text-fg">{v.count}</span>
            <span>{VERTICAL_LABEL[v.vertical] ?? v.vertical}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
