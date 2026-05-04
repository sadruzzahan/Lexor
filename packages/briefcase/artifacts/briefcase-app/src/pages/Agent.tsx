import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import {
  GitBranch,
  Activity,
  Cpu,
  Database,
  ChevronRight,
  Rewind,
} from "lucide-react";
import {
  useGetCase,
  useGetRun,
  useGetRunTrace,
  useListRunMessages,
  useGetRunCost,
  useBranchRun,
  type AgentEvent,
} from "@workspace/api-client-react";
import { useApi } from "@/hooks/useApi";
import { useAgentRun } from "@/hooks/useAgentRun";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { GlassAppBar } from "@/components/GlassAppBar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selection, success, warning } from "@/lib/haptics";

/**
 * G15 — Glass Box Theater + Time-Travel Debugger.
 *
 * Renders the live agent run as a DAG-ish timeline (grouped by subagent),
 * with a header strip showing live cost / model-routing / cache-hit
 * counters, an OTel trace + agent-message detail panel for the selected
 * event, a scrub wheel that filters the visible portion of the timeline,
 * and a Branch action that POSTs R-23 to fork a child run from the
 * scrub point with optional edited inputs.
 */
export default function Agent() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const [, setLocation] = useLocation();
  const { request } = useApi();

  const { data: caseDetail, isLoading: loadingCase } = useGetCase(caseId, {
    request,
    query: { enabled: !!caseId, queryKey: ["case", caseId] },
  });

  const latestRun = caseDetail?.latestRun ?? null;

  // Allow ?runId=... to override the latest-run anchor (used after Branch).
  const overrideRunId = useMemo(() => {
    const u = new URL(window.location.href);
    return u.searchParams.get("runId");
  }, []);
  const runId = overrideRunId ?? latestRun?.id ?? null;

  // Fetch the run row so we can surface parent lineage (R-23 branch metadata).
  const { data: runRow } = useGetRun(runId ?? "", {
    request,
    query: { enabled: !!runId, queryKey: ["run-row", runId] },
  });

  // Subscribe to live SSE; useAgentRunStore is fed by the hook.
  useAgentRun(runId);
  const panes = useAgentRunStore((s) => s.panes);
  const rawEvents = useAgentRunStore((s) => s.rawEvents);

  const events: AgentEvent[] = useMemo(() => rawEvents, [rawEvents]);
  const maxIdx = events.length > 0 ? events[events.length - 1]!.idx : 0;

  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  // Auto-track the live tail until the user scrubs.
  const visibleIdx = scrubIdx ?? maxIdx;
  const visibleEvents = events.filter((e) => e.idx <= visibleIdx);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  useEffect(() => {
    if (selectedIdx == null && visibleEvents.length > 0) {
      setSelectedIdx(visibleEvents[visibleEvents.length - 1]!.idx);
    }
  }, [selectedIdx, visibleEvents]);
  const selected = events.find((e) => e.idx === selectedIdx) ?? null;

  // ----- live header strip ------------------------------------------------
  const lastCost = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "cost_update") return e;
    }
    return null;
  }, [events]);
  const lastModel = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "model_routed") return e;
    }
    return null;
  }, [events]);
  const cacheHits = useMemo(
    () => events.filter((e) => e.type === "cache_hit").length,
    [events],
  );

  // ----- trace + messages (gated on runId) --------------------------------
  const { data: trace } = useGetRunTrace(runId ?? "", {
    request,
    query: {
      enabled: !!runId,
      queryKey: ["run-trace", runId],
      refetchInterval: 5000,
    },
  });
  const { data: messagesResp } = useListRunMessages(runId ?? "", {
    request,
    query: {
      enabled: !!runId,
      queryKey: ["run-messages", runId],
      refetchInterval: 5000,
    },
  });
  const { data: cost } = useGetRunCost(runId ?? "", {
    request,
    query: {
      enabled: !!runId,
      queryKey: ["run-cost", runId],
      refetchInterval: 5000,
    },
  });

  // ----- branch action ----------------------------------------------------
  const [branchOpen, setBranchOpen] = useState(false);
  const [editedGoal, setEditedGoal] = useState("");
  useEffect(() => {
    if (branchOpen && caseDetail?.case?.title) {
      setEditedGoal(latestRun?.goal ?? caseDetail.case.title);
    }
  }, [branchOpen, caseDetail, latestRun]);

  const branchMut = useBranchRun({
    request,
    mutation: {
      onSuccess: (resp) => {
        success();
        toast.success("Branched run started", {
          description: `Forked from idx ${resp.branchedAtIdx}. Switching view…`,
        });
        setBranchOpen(false);
        setLocation(`/case/${caseId}/agent?runId=${resp.childRunId}`);
        // Force-remount via reload — the store is keyed off useAgentRun(runId),
        // and the URL change above triggers a fresh subscribe.
        setTimeout(() => window.location.reload(), 250);
      },
      onError: (err: unknown) => {
        warning();
        toast.error(
          err instanceof Error ? err.message : "Failed to branch run",
        );
      },
    },
  });

  if (loadingCase) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!runId) {
    return (
      <div className="px-4 pb-16">
        <GlassAppBar
          title="Glass Box Theater"
          subtitle="No run yet — start one from the case dashboard."
          backHref={`/case/${caseId}`}
        />
        <div className="mt-12 text-center text-sm text-muted-foreground">
          Open the case and tap “Start run” to populate the theater.
        </div>
      </div>
    );
  }

  const branchedAtIdx = selectedIdx ?? visibleIdx;

  return (
    <div className="px-4 pb-24">
      <GlassAppBar
        title="Glass Box Theater"
        subtitle={
          overrideRunId ? "Branched run" : latestRun?.goal ?? "Live agent run"
        }
        backHref={`/case/${caseId}`}
        actions={
          <Button
            size="sm"
            variant="secondary"
            data-testid="open-branch-dialog"
            onClick={() => {
              selection();
              setBranchOpen(true);
            }}
            disabled={events.length === 0}
          >
            <GitBranch className="mr-1.5 size-3.5" />
            Branch from idx {branchedAtIdx}
          </Button>
        }
      />

      {/* Parent lineage banner — surfaces R-23 branch metadata so the
          operator can jump back to the timeline they forked from. */}
      {runRow?.parentRunId != null && (
        <div
          data-testid="parent-lineage"
          className="mb-3 flex items-center justify-between rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-100"
        >
          <span>
            Branched from parent run at idx{" "}
            <span className="font-mono">{runRow.branchedAtIdx ?? "?"}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            data-testid="view-parent-run"
            onClick={() => {
              selection();
              setLocation(
                `/case/${caseId}/agent?runId=${runRow.parentRunId}`,
              );
              setTimeout(() => window.location.reload(), 100);
            }}
          >
            View parent
          </Button>
        </div>
      )}

      {/* Header strip — live cost / model / cache. */}
      <div
        data-testid="glassbox-header"
        className="grid grid-cols-3 gap-3 rounded-lg border border-white/10 bg-background/40 p-3 backdrop-blur-md"
      >
        <Stat
          icon={<Activity className="size-3.5" />}
          label="Total cost"
          value={
            cost
              ? `$${cost.totalUsd.toFixed(4)}`
              : lastCost
              ? `$${lastCost.totalUsd.toFixed(4)}`
              : "$0.0000"
          }
        />
        <Stat
          icon={<Cpu className="size-3.5" />}
          label="Last model"
          value={lastModel?.chosenModel ?? "—"}
          sub={lastModel?.provider ?? undefined}
        />
        <Stat
          icon={<Database className="size-3.5" />}
          label="Cache hits"
          value={String(cacheHits)}
          sub={
            cacheHits > 0
              ? `last ${
                  events.filter((e) => e.type === "cache_hit").at(-1)
                    ?.taskKind ?? ""
                }`
              : undefined
          }
        />
      </div>

      {/* Scrub wheel */}
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-white/10 bg-background/30 px-3 py-2">
        <Rewind className="size-4 text-muted-foreground" />
        <div className="flex-1">
          <Slider
            value={[visibleIdx]}
            min={0}
            max={Math.max(maxIdx, 0)}
            step={1}
            onValueChange={(v) => {
              const idx = v[0] ?? 0;
              setScrubIdx(idx === maxIdx ? null : idx);
              setSelectedIdx(idx);
              selection();
            }}
            data-testid="time-scrub"
          />
        </div>
        <div className="w-24 text-right text-xs tabular-nums text-muted-foreground">
          idx {visibleIdx} / {maxIdx}
          {scrubIdx != null && (
            <button
              type="button"
              className="ml-2 underline hover:text-foreground"
              onClick={() => {
                setScrubIdx(null);
                selection();
              }}
              data-testid="scrub-live"
            >
              live
            </button>
          )}
        </div>
      </div>

      {/* Subagent-lane DAG view — one row per subagent with event nodes
          positioned by idx. Edges from planner → subagent_started land on
          the matching lane so the operator can see the dispatch fan-out
          rather than just a flat event list. */}
      <SubagentLanes
        events={visibleEvents}
        maxIdx={Math.max(maxIdx, 1)}
        selectedIdx={selectedIdx}
        onSelect={(idx) => {
          setSelectedIdx(idx);
          selection();
        }}
      />

      {/* DAG list + detail panel */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div
          data-testid="event-dag"
          className="space-y-2 rounded-lg border border-white/10 bg-background/30 p-3"
        >
          {visibleEvents.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Waiting for first event…
            </div>
          ) : (
            visibleEvents.map((e) => (
              <EventRow
                key={e.idx}
                event={e}
                selected={e.idx === selectedIdx}
                onSelect={() => {
                  setSelectedIdx(e.idx);
                  selection();
                }}
              />
            ))
          )}
        </div>

        <div className="space-y-3">
          <DetailPanel
            event={selected}
            spans={(trace?.spans ?? []) as Array<Record<string, unknown>>}
            messages={messagesResp?.items ?? []}
          />
          <PanesGlance panes={panes} />
          {runRow?.parentRunId ? (
            <ParentChildCompare
              parentRunId={runRow.parentRunId}
              childRun={runRow}
              childCost={cost ?? null}
              childFinal={
                events.find((e) => e.type === "final_result") ?? null
              }
              request={request}
            />
          ) : null}
        </div>
      </div>

      <Dialog
        open={branchOpen}
        onOpenChange={(o) => setBranchOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Branch run from idx {branchedAtIdx}</DialogTitle>
            <DialogDescription>
              Forks a new child run from the parent at this event. The
              child re-plans with the (optionally edited) goal below; the
              parent timeline is preserved untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Edited goal
            </label>
            <Textarea
              value={editedGoal}
              onChange={(e) => setEditedGoal(e.target.value)}
              rows={4}
              data-testid="branch-edited-goal"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBranchOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                branchMut.mutate({
                  runId,
                  data: {
                    branchedAtIdx,
                    editedInputs: editedGoal ? { goal: editedGoal } : {},
                  },
                });
              }}
              disabled={branchMut.isPending}
              data-testid="branch-confirm"
            >
              {branchMut.isPending ? <Spinner className="mr-2 size-3" /> : null}
              Fork run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono text-sm tabular-nums text-foreground">
        {value}
      </div>
      {sub ? (
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: AgentEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = TYPE_TONE[event.type] ?? "bg-white/5 text-foreground";
  const subagent =
    "subagent" in event && typeof event.subagent === "string"
      ? event.subagent
      : null;
  const summary = summarize(event);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`event-row-${event.idx}`}
      className={[
        "flex w-full items-center gap-3 rounded-md border px-2.5 py-1.5 text-left transition-colors",
        selected
          ? "border-violet-400/50 bg-violet-500/10"
          : "border-white/5 hover:bg-white/5",
      ].join(" ")}
    >
      <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {event.idx}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
      >
        {event.type}
      </span>
      {subagent ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {subagent}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-xs">{summary}</span>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

function DetailPanel({
  event,
  spans,
  messages,
}: {
  event: AgentEvent | null;
  spans: Array<Record<string, unknown>>;
  messages: Array<{
    id: string;
    from: string;
    to: string;
    body: Record<string, unknown>;
  }>;
}) {
  if (!event) {
    return (
      <div className="rounded-lg border border-white/10 bg-background/30 p-4 text-sm text-muted-foreground">
        Select an event on the left to inspect.
      </div>
    );
  }
  const subagent =
    "subagent" in event && typeof event.subagent === "string"
      ? event.subagent
      : null;
  const relatedSpans = subagent
    ? spans.filter((s) => {
        const attrs = s["attributes"] as Record<string, unknown> | undefined;
        return attrs?.["engine.subagent"] === subagent;
      })
    : spans.slice(0, 8);
  const relatedMessages = subagent
    ? messages.filter((m) => m.from === subagent || m.to === subagent)
    : messages.slice(0, 5);

  return (
    <div
      data-testid="detail-panel"
      className="space-y-3 rounded-lg border border-white/10 bg-background/30 p-3"
    >
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-xs text-muted-foreground">
          idx {event.idx} · {event.type}
        </div>
        {subagent ? (
          <div className="text-xs">{subagent}</div>
        ) : null}
      </div>

      <pre className="max-h-48 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(event, null, 2)}
      </pre>

      <Section title={`OTel spans (${relatedSpans.length})`}>
        {relatedSpans.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No spans recorded (buffer recycled after run completes).
          </div>
        ) : (
          <ul className="space-y-1 text-[11px]">
            {relatedSpans.slice(0, 12).map((s, i) => (
              <li
                key={i}
                className="flex items-center gap-2 truncate font-mono"
              >
                <span className="text-muted-foreground">
                  {String(s["kind"] ?? "?")}
                </span>
                <span>{String(s["name"] ?? "(unnamed)")}</span>
                {typeof s["durationMs"] === "number" ? (
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {(s["durationMs"] as number).toFixed(0)}ms
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Agent messages (${relatedMessages.length})`}>
        {relatedMessages.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No bus traffic for this subagent yet.
          </div>
        ) : (
          <ul className="space-y-1 text-[11px]">
            {relatedMessages.slice(0, 8).map((m) => (
              <li key={m.id} className="font-mono">
                <span className="text-muted-foreground">
                  {m.from} → {m.to}:
                </span>{" "}
                <span className="break-all">
                  {JSON.stringify(m.body).slice(0, 120)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function SubagentLanes({
  events,
  maxIdx,
  selectedIdx,
  onSelect,
}: {
  events: AgentEvent[];
  maxIdx: number;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  // Bucket events by their `subagent` (or "orchestrator" for top-level
  // events like run_started / planner_step / cost_update). The result is a
  // simple swimlane DAG: each lane is a subagent, each node is an event
  // positioned by its idx, and a planner→subagent_started dispatch shows
  // up as the first node on the spawned lane.
  const lanes = useMemo(() => {
    const map = new Map<string, AgentEvent[]>();
    const ORCH = "orchestrator";
    for (const ev of events) {
      const e = ev as unknown as Record<string, unknown>;
      const sub =
        typeof e["subagent"] === "string" && e["subagent"]
          ? (e["subagent"] as string)
          : ORCH;
      const bucket = map.get(sub);
      if (bucket) bucket.push(ev);
      else map.set(sub, [ev]);
    }
    // Pin orchestrator first; remaining lanes ordered by first-seen idx.
    const ordered: Array<[string, AgentEvent[]]> = [];
    if (map.has(ORCH)) ordered.push([ORCH, map.get(ORCH)!]);
    [...map.entries()]
      .filter(([k]) => k !== ORCH)
      .sort((a, b) => (a[1][0]?.idx ?? 0) - (b[1][0]?.idx ?? 0))
      .forEach((entry) => ordered.push(entry));
    return ordered;
  }, [events]);

  if (lanes.length === 0) return null;

  return (
    <div
      data-testid="subagent-lanes"
      className="mt-4 space-y-2 rounded-lg border border-white/10 bg-background/30 p-3"
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Subagent lanes
      </div>
      {lanes.map(([name, laneEvents]) => (
        <div
          key={name}
          className="flex items-center gap-3"
          data-testid={`lane-${name}`}
        >
          <div className="w-28 shrink-0 truncate text-xs text-muted-foreground">
            {name}
          </div>
          <div className="relative h-6 flex-1">
            {/* Lane backbone */}
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
            {laneEvents.map((ev) => {
              const left = `${(ev.idx / maxIdx) * 100}%`;
              const tone =
                TYPE_TONE[ev.type]?.split(" ")[0] ?? "bg-white/30";
              const isSel = ev.idx === selectedIdx;
              return (
                <button
                  key={ev.idx}
                  type="button"
                  onClick={() => onSelect(ev.idx)}
                  data-testid={`lane-node-${ev.idx}`}
                  title={`idx ${ev.idx} · ${ev.type}`}
                  style={{ left }}
                  className={[
                    "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/20 transition-transform",
                    tone,
                    isSel ? "scale-150 ring-violet-300/80" : "hover:scale-125",
                  ].join(" ")}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ParentChildCompare({
  parentRunId,
  childRun,
  childCost,
  childFinal,
  request,
}: {
  parentRunId: string;
  childRun: { goal: string; status: string };
  childCost: { totalUsd: number } | null;
  childFinal: AgentEvent | null;
  request: ReturnType<typeof useApi>["request"];
}) {
  const { data: parent } = useGetRun(parentRunId, {
    request,
    query: { queryKey: ["run-row", parentRunId] },
  });
  const { data: parentCost } = useGetRunCost(parentRunId, {
    request,
    query: { queryKey: ["run-cost", parentRunId] },
  });

  const childFinalKeys = childFinal
    ? Object.keys(
        ((childFinal as unknown as { data?: Record<string, unknown> }).data) ??
          {},
      )
    : [];

  const rows: Array<{ label: string; parent: string; child: string }> = [
    { label: "goal", parent: parent?.goal ?? "—", child: childRun.goal },
    {
      label: "status",
      parent: parent?.status ?? "—",
      child: childRun.status,
    },
    {
      label: "total cost",
      parent: parentCost ? `$${parentCost.totalUsd.toFixed(4)}` : "—",
      child: childCost ? `$${childCost.totalUsd.toFixed(4)}` : "—",
    },
    {
      label: "final keys",
      parent: "—",
      child: childFinalKeys.join(", ") || "(none yet)",
    },
  ];

  return (
    <div
      data-testid="parent-child-compare"
      className="rounded-lg border border-violet-400/30 bg-violet-500/5 p-3"
    >
      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Parent vs child
      </div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left font-normal">field</th>
            <th className="text-left font-normal">parent</th>
            <th className="text-left font-normal">child</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.parent !== r.child;
            return (
              <tr key={r.label} className={diff ? "" : "opacity-60"}>
                <td className="py-0.5 pr-2 font-mono text-[10px] text-muted-foreground">
                  {r.label}
                </td>
                <td className="py-0.5 pr-2 truncate font-mono text-[11px]">
                  {r.parent}
                </td>
                <td
                  className={[
                    "py-0.5 truncate font-mono text-[11px]",
                    diff ? "text-violet-200" : "",
                  ].join(" ")}
                >
                  {r.child}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PanesGlance({
  panes,
}: {
  panes: Array<{ pane: number; subagent: string | null; status: string }>;
}) {
  if (panes.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-background/30 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Subagent panes
      </div>
      <ul className="space-y-1 text-xs">
        {panes.map((p) => (
          <li
            key={p.pane}
            className="flex items-center justify-between"
          >
            <span className="truncate">
              {p.subagent ?? `pane ${p.pane}`}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {p.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const TYPE_TONE: Record<string, string> = {
  run_started: "bg-violet-500/15 text-violet-200",
  planner_step: "bg-sky-500/15 text-sky-200",
  subagent_started: "bg-emerald-500/15 text-emerald-200",
  subagent_completed: "bg-emerald-600/20 text-emerald-100",
  tool_call: "bg-amber-500/15 text-amber-200",
  tool_result: "bg-amber-600/15 text-amber-100",
  partial_result: "bg-cyan-500/15 text-cyan-200",
  model_routed: "bg-indigo-500/15 text-indigo-200",
  cache_hit: "bg-teal-500/15 text-teal-200",
  cost_update: "bg-fuchsia-500/15 text-fuchsia-200",
  judge_score: "bg-purple-500/15 text-purple-200",
  retry_exhausted: "bg-rose-500/15 text-rose-200",
  policy_drop: "bg-rose-600/20 text-rose-100",
  guardrail_warning: "bg-orange-500/15 text-orange-200",
  agent_message: "bg-slate-500/15 text-slate-200",
  error: "bg-red-600/25 text-red-100",
  done: "bg-emerald-700/25 text-emerald-100",
  final_result: "bg-emerald-600/25 text-emerald-100",
};

function summarize(ev: AgentEvent): string {
  // AgentEventAgentMessage redeclares `idx` in its intersection, which (in
  // current orval output) drops it from the discriminated union narrowing
  // on `ev.type` — so we treat the event payload as a loose record.
  const e = ev as unknown as Record<string, unknown>;
  const type = String(e["type"] ?? "");
  const num = (k: string): number =>
    typeof e[k] === "number" ? (e[k] as number) : 0;
  const str = (k: string): string =>
    typeof e[k] === "string" ? (e[k] as string) : "";
  const obj = (k: string): Record<string, unknown> =>
    e[k] && typeof e[k] === "object" ? (e[k] as Record<string, unknown>) : {};
  switch (type) {
    case "run_started":
      return str("goal");
    case "planner_step":
      return str("text");
    case "subagent_started":
      return `pane ${num("pane")}`;
    case "tool_call":
      return `${str("tool")} (${str("status")})`;
    case "tool_result":
      return str("resultPreview");
    case "partial_result":
      return Object.keys(obj("data")).join(", ") || "(no fields)";
    case "subagent_completed":
      return `${str("subagent")} ✓`;
    case "model_routed":
      return `${str("taskKind")} → ${str("chosenModel")}`;
    case "cache_hit":
      return `${str("taskKind")} sim=${num("similarity").toFixed(2)}`;
    case "cost_update":
      return `$${num("totalUsd").toFixed(4)}`;
    case "judge_score":
      return `${str("subagent")} ${num("score").toFixed(2)} ${
        e["passed"] ? "✓" : "✗"
      }`;
    case "retry_exhausted":
      return `${str("subagent")} attempts=${
        Array.isArray(e["attempts"]) ? (e["attempts"] as unknown[]).length : 0
      }`;
    case "policy_drop":
      return str("rule");
    case "guardrail_warning":
      return `${str("state")} $${num("remainingUsd").toFixed(4)}`;
    case "agent_message":
      return `${str("from")} → ${str("to")}`;
    case "error":
      return str("message");
    case "done":
      return e["cancelled"] ? "cancelled" : "ok";
    case "final_result":
      return Object.keys(obj("data")).join(", ");
    default:
      return "";
  }
}
