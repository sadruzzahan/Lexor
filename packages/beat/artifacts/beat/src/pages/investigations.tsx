import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Plus, FolderOpen, Clock, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useListCases,
  getListCasesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Case } from "@workspace/api-client-react";

const STATUS_COLORS: Record<string, string> = {
  open: "text-primary border-primary/30 bg-primary/10",
  closed: "text-muted-foreground border-border bg-muted",
  archived: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
};

/** Returns the persisted run ID from localStorage for a case, or null. */
function useStoredRunId(caseId: string): string | null {
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setRunId(localStorage.getItem(`beat_run_${caseId}`));
    } catch {
      setRunId(null);
    }
  }, [caseId]);
  return runId;
}

/**
 * Shows a "Replay" chip on cards where:
 *  1. A completed run ID has been persisted in localStorage (client signal), AND
 *  2. The case has a server-populated `jurisdictionContext` — which is only written
 *     by the JurisdictionDetector subagent when the investigation ran to completion
 *     (server truth). This prevents stale or in-progress runs from showing the badge.
 */
function ReplayBadge({
  caseId,
  hasServerCompletion,
  onNavigate,
}: {
  caseId: string;
  hasServerCompletion: boolean;
  onNavigate: () => void;
}) {
  const storedRunId = useStoredRunId(caseId);
  if (!storedRunId || !hasServerCompletion) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onNavigate();
      }}
      className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      style={{ borderColor: "rgba(0,255,136,0.35)", color: "#00FF88" }}
      aria-label="Replay completed investigation"
      data-testid={`button-replay-case-${caseId}`}
    >
      <Play className="w-2.5 h-2.5" aria-hidden="true" />
      Replay
    </button>
  );
}

function CaseCard({ c, onClick }: { c: Case; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card p-4 flex flex-col gap-3 transition-colors hover:border-border/80"
      style={{ background: "#121814" }}
      data-testid={`card-case-${c.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{c.title}</p>
          {c.goal && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.goal}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ReplayBadge
            caseId={c.id}
            hasServerCompletion={c.jurisdictionContext != null}
            onNavigate={onClick}
          />
          <Badge
            variant="outline"
            className={`text-[10px] font-mono uppercase ${STATUS_COLORS[c.status] ?? ""}`}
            data-testid={`status-case-${c.id}`}
          >
            {c.status}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground font-mono">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
        </span>
        {c.jurisdictionContext && (
          <Badge variant="outline" className="text-[10px] font-mono border-border">
            {String((c.jurisdictionContext as Record<string, unknown>).country ?? "Unknown")}
          </Badge>
        )}
      </div>
    </motion.button>
  );
}

export default function Investigations() {
  const [, navigate] = useLocation();
  const { data: casesData, isLoading } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });

  const cases = casesData?.cases ?? [];
  const sorted = [...cases].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="min-h-screen bg-background pb-20" data-testid="investigations-screen">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground">Investigations</h1>
          {!isLoading && (
            <p className="text-[11px] text-muted-foreground font-mono">
              {cases.length} case{cases.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => navigate("/investigations/new")}
          className="h-8 gap-1 text-xs font-semibold"
          style={{ background: "#00FF88", color: "#0A0F0C" }}
          data-testid="button-new-investigation"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>

      <div className="px-4 py-4 space-y-2 max-w-2xl mx-auto">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))
        ) : sorted.length === 0 ? (
          <EmptyState onNew={() => navigate("/investigations/new")} />
        ) : (
          sorted.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <CaseCard c={c} onClick={() => navigate(`/investigations/${c.id}`)} />
            </motion.div>
          ))
        )}
      </div>

      <button
        onClick={() => navigate("/investigations/new")}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full flex items-center justify-center shadow-lg z-50"
        style={{
          background: "#00FF88",
          color: "#0A0F0C",
          boxShadow: "0 0 20px rgba(0,255,136,0.4)",
        }}
        data-testid="fab-new-investigation"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-24 gap-6 text-center"
      data-testid="empty-state-investigations"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)" }}
      >
        <FolderOpen className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">No investigations yet</p>
        <p className="text-xs text-muted-foreground">Start your first investigation to begin</p>
      </div>
      <Button
        onClick={onNew}
        className="h-10 gap-2 text-sm font-semibold"
        style={{ background: "#00FF88", color: "#0A0F0C" }}
        data-testid="button-empty-new"
      >
        <Plus className="w-4 h-4" />
        New Investigation
      </Button>
    </motion.div>
  );
}
