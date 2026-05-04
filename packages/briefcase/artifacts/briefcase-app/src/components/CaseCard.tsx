import { Card } from "@/components/ui/card";
import type { Case } from "@workspace/api-client-react";

interface CaseCardProps {
  caseRecord: Case;
  onClick?: () => void;
}

const STATUS_LABEL: Record<Case["status"], string> = {
  created: "Created",
  ingesting: "Ingesting",
  ready: "Ready",
  running: "Running",
  prepared: "Prepared",
  error: "Error",
  deleted: "Deleted",
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CaseCard({ caseRecord, onClick }: CaseCardProps) {
  const interactive = typeof onClick === "function";
  return (
    <Card
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Open case ${caseRecord.title}` : undefined}
      className={[
        "border-card-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        interactive
          ? "hover-elevate active-elevate-2 cursor-pointer"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`case-card-${caseRecord.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">
            {caseRecord.title}
          </h3>
          {caseRecord.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {caseRecord.description}
            </p>
          ) : null}
        </div>
        <span
          className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          data-testid={`case-status-${caseRecord.id}`}
        >
          {STATUS_LABEL[caseRecord.status] ?? caseRecord.status}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Updated {relativeTime(caseRecord.updatedAt)}</span>
      </div>
    </Card>
  );
}
