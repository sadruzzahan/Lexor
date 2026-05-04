import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { Camera, Play, Square, Users, Scale, Swords } from "lucide-react";
import { toast } from "sonner";
import {
  useGetCase,
  useStartCaseRun,
  useCancelRun,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/hooks/useApi";
import { useAgentRun } from "@/hooks/useAgentRun";
import {
  useOnDemandSubagent,
  type OnDemandSubagentName,
} from "@/hooks/useOnDemandSubagent";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { AgentPane } from "@/components/agent/AgentPane";
import { CitationChip } from "@/components/agent/CitationChip";
import EmptyState from "@/components/EmptyState";
import ScanSheet from "@/components/ScanSheet";
import { GlassAppBar } from "@/components/GlassAppBar";
import * as haptics from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonMorph } from "@/components/SkeletonMorph";
import { PlainEnglishToggle } from "@/components/plain-english/PlainEnglishToggle";
import { useTour } from "@/components/tour/TourProvider";
import {
  isPracticeCaseId,
  PRACTICE_CASE_TITLE,
  usePracticeRun,
} from "@/hooks/usePracticeRun";
import { BriefcaseOpenIntro } from "@/components/signature/BriefcaseOpenIntro";

export default function CaseDetail() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const isPractice = isPracticeCaseId(caseId);
  const { request } = useApi();
  const tour = useTour();

  // Real-case data path. Skipped entirely for the practice case.
  const { data: caseDetail, isLoading: loadingCase } = useGetCase(
    isPractice ? "" : caseId,
    {
      request,
      query: {
        enabled: !isPractice && !!caseId,
        queryKey: ["case", caseId],
      },
    },
  );
  const caseRecord = caseDetail?.case;
  const latestRun = caseDetail?.latestRun;

  const [runId, setRunId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (isPractice || runId || !latestRun) return;
    if (latestRun.status === "running" || latestRun.status === "pending") {
      setRunId(latestRun.id);
    }
  }, [isPractice, latestRun, runId]);

  const startRun = useStartCaseRun({
    request,
    mutation: {
      onSuccess: (res) => setRunId(res.runId),
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to start run";
        toast.error(msg);
      },
    },
  });

  const cancelRun = useCancelRun({
    request,
    mutation: {
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to cancel";
        toast.error(msg);
      },
    },
  });

  useEffect(() => {
    if (isPractice) return;
    if (!caseRecord || runId || startRun.isPending) return;
    if (caseRecord.status !== "ready" && caseRecord.status !== "prepared") {
      return;
    }
    if (
      latestRun &&
      (latestRun.status === "running" || latestRun.status === "pending")
    ) {
      return;
    }
    startRun.mutate({
      caseId,
      data: { idempotencyKey: crypto.randomUUID() },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPractice,
    caseRecord?.status,
    latestRun?.id,
    latestRun?.status,
    caseId,
  ]);

  // Real run subscription. Inert when no runId.
  useAgentRun(isPractice ? null : runId);
  // G19 / B2 — local fixture driver; only active for the practice case id.
  usePracticeRun(isPractice);

  const { panes, prepActivity, goal, done, cancelled, error, citations } =
    useAgentRunStore();

  // G13 — on-demand Jury / Plea / Adversarial. Each spawns its own run row;
  // the live SSE stream then takes over `useAgentRun` exactly like the
  // baseline pack run.
  const onDemand = useOnDemandSubagent();
  const handleOnDemand = async (subagent: OnDemandSubagentName) => {
    if (!caseId) return;
    haptics.selection();
    const id = await onDemand.start({ caseId, subagent });
    if (id) setRunId(id);
  };
  // G13 gating: on-demand simulators (especially Prosecution Sparring) only
  // make sense AFTER a baseline pack run has produced an evidence summary +
  // strategy. We require the most recent run for this case to be in a
  // terminal completed state (not just absent) before showing the rail.
  const baselineCompleted = !!latestRun && latestRun.status === "completed";
  const onDemandDisabled =
    onDemand.isPending || (!!runId && !done) || startRun.isPending;

  const headline = useMemo(() => {
    if (isPractice) return goal ?? "Streaming the practice run…";
    if (!runId) return "Preparing run…";
    if (cancelled) return "Run cancelled";
    if (error) return `Run error: ${error}`;
    if (done) return "Ready";
    return goal ?? "Streaming agent run…";
  }, [isPractice, runId, done, cancelled, error, goal]);

  useEffect(() => {
    if (isPractice) {
      if (done) haptics.success();
      return;
    }
    if (!runId) return;
    if (done && !cancelled && !error) haptics.success();
    else if (error) haptics.warning();
  }, [isPractice, runId, done, cancelled, error]);

  // G19 / B3 — register tour steps for the case detail screen.
  useEffect(() => {
    const steps = [
      {
        testId: "agent-pane-grid",
        text: "Each pane is a specialist subagent — they work in parallel.",
      },
      ...(citations.length > 0
        ? [
            {
              testId: `citation-${citations[0].fileId}`,
              text: "Tap any citation to jump straight to the source page.",
            },
          ]
        : []),
      {
        testId: "plain-english-toggle",
        text: "Flip Plain English on to see legal terms in everyday words.",
      },
    ];
    tour.setSteps(steps);
  }, [tour, citations]);

  const handleStart = () => {
    if (!caseId) return;
    haptics.selection();
    startRun.mutate({ caseId, data: { idempotencyKey: crypto.randomUUID() } });
  };

  const handleCancel = () => {
    if (!runId) return;
    haptics.selection();
    cancelRun.mutate({ runId });
  };

  const title = isPractice ? PRACTICE_CASE_TITLE : caseRecord?.title ?? "Case";

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-12"
      data-testid="case-detail-screen"
      data-practice={isPractice ? "1" : "0"}
    >
      <BriefcaseOpenIntro caseId={caseId} label={title} />
      <GlassAppBar
        title={title}
        subtitle={
          isPractice ? "Practice — local fixture, no backend" : headline
        }
        backHref="/cases"
        backLabel="Back to cases"
        actions={
          <>
            {isPractice && (
              <span
                data-testid="practice-badge"
                className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--violet)/0.45)] bg-[hsl(var(--violet)/0.12)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--violet))]"
              >
                Practice
              </span>
            )}
            <PlainEnglishToggle />
            {!isPractice && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  haptics.selection();
                  setScanOpen(true);
                }}
                data-testid="open-scan-sheet"
              >
                <Camera className="size-4" />
                Scan
              </Button>
            )}
            {!isPractice && runId && !done ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={cancelRun.isPending}
                data-testid="cancel-run"
              >
                <Square className="size-4" />
                Cancel
              </Button>
            ) : !isPractice ? (
              <Button
                size="sm"
                onClick={handleStart}
                disabled={startRun.isPending || (!!runId && !done)}
                data-testid="start-run"
              >
                <Play className="size-4" />
                {runId ? "Run again" : "Start run"}
              </Button>
            ) : null}
          </>
        }
      />

      {!isPractice && loadingCase && (
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner />
        </div>
      )}

      {/* G13 — on-demand simulators. Hidden until the baseline pack run has
          completed; only one run can be active per case at a time. */}
      {(!runId || done) && baselineCompleted && (
        <section
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/30 px-3 py-2"
          data-testid="on-demand-rail"
        >
          <span className="text-xs font-medium text-muted-foreground">
            Run a simulator:
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOnDemand("MockJurySimulator")}
            disabled={onDemandDisabled}
            data-testid="run-jury"
          >
            <Users className="size-4" />
            Mock Jury
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOnDemand("PleaOutcomeSimulator")}
            disabled={onDemandDisabled}
            data-testid="run-plea"
          >
            <Scale className="size-4" />
            Plea Forecast
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOnDemand("ProsecutionSimulator")}
            disabled={onDemandDisabled}
            data-testid="run-adversarial"
          >
            <Swords className="size-4" />
            Prosecution Sparring
          </Button>
        </section>
      )}

      {prepActivity.length > 0 && (
        <section
          className="mb-4 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="prep-activity"
        >
          <span className="mr-2 font-medium text-foreground">Planner:</span>
          {prepActivity.slice(-2).join(" · ")}
        </section>
      )}

      <SkeletonMorph
        loading={panes.length === 0 && !done && !error}
        testId="briefcase-grid-morph"
        skeleton={
          <section
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
            data-testid="agent-pane-grid-loading"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </section>
        }
      >
        <section
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          data-testid="agent-pane-grid"
        >
          {panes.map((pane, i) => (
            <AgentPane
              key={pane.pane}
              pane={pane}
              delay={0.06 * i}
              caseId={caseId}
            />
          ))}
        </section>
      </SkeletonMorph>

      {(citations.length > 0 || done) && (caseId) && (
        <section
          className="mt-4 flex flex-wrap items-center gap-2"
          data-testid="citations-rail"
        >
          {citations.length === 0 ? (
            <EmptyState
              variant="citations"
              className="w-full py-8"
            />
          ) : (
            <>
              <span className="text-[11px] font-medium text-muted-foreground">
                Sources:
              </span>
              {citations.map((c, i) => (
                <CitationChip
                  key={`${c.fileId}-${i}`}
                  caseId={caseId}
                  fileId={c.fileId}
                  label={c.label}
                  page={c.page}
                  snippet={c.snippet}
                />
              ))}
            </>
          )}
        </section>
      )}

      {!isPractice && (
        <ScanSheet
          open={scanOpen}
          onOpenChange={setScanOpen}
          caseId={caseId}
        />
      )}

      {!isPractice && !caseDetail && !loadingCase && (
        <p className="mt-8 text-sm text-muted-foreground">
          Case not found.{" "}
          <Link href="/cases" className="underline">
            Back to cases
          </Link>
        </p>
      )}
    </main>
  );
}
