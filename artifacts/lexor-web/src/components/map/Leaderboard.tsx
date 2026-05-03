import { Link } from "wouter";
import { Building2, Briefcase, Banknote, HelpCircle } from "lucide-react";
import type { MapStats } from "@/lib/api";

const KIND_ICON = {
  landlord: Building2,
  employer: Briefcase,
  debt_collector: Banknote,
  unknown: HelpCircle,
} as const;

interface Props {
  stats: MapStats | null;
}

export function Leaderboard({ stats }: Props) {
  if (!stats || stats.topEntities.length === 0) return null;
  // Duplicate the row so the marquee loops seamlessly.
  const items = [...stats.topEntities, ...stats.topEntities];
  return (
    <div className="rounded-xl2 border border-border-strong bg-bg-elevated/80 backdrop-blur-md overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          Most-pinned this week
        </div>
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle/60">
          live
        </div>
      </div>
      <div className="relative overflow-hidden">
        <div className="flex gap-6 py-3 px-4 animate-[marquee_35s_linear_infinite] whitespace-nowrap">
          {items.map((e, i) => {
            const Icon = KIND_ICON[e.kind] ?? HelpCircle;
            return (
              <Link
                key={`${e.entityId}-${i}`}
                href={`/entity/${e.entityId}`}
                className="inline-flex items-center gap-2 text-sm hover:text-accent transition-colors"
              >
                <span className="text-fg-subtle tabular-nums">
                  #{(i % stats.topEntities.length) + 1}
                </span>
                <Icon className="size-3.5 text-fg-muted" />
                <span className="text-fg">{e.displayName}</span>
                <span className="text-fg-subtle tabular-nums">
                  · {e.pinCount} pins
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
