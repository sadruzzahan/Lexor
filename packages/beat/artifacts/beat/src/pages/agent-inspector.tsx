import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { AgentEvent } from "@workspace/api-client-react";
import {
  useGetCase,
  getGetCaseQueryKey,
  useStartRun,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

const EVENT_COLORS: Record<string, string> = {
  run_started: "text-primary border-primary/30 bg-primary/10",
  subagent_started: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  partial_result: "text-muted-foreground border-border bg-muted/30",
  subagent_completed: "text-primary border-primary/30 bg-primary/10",
  done: "text-primary border-primary/30 bg-primary/10",
  error: "text-destructive border-destructive/30 bg-destructive/10",
};

function EventRow({ event, ts }: { event: AgentEvent; ts: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border/30 py-2 px-3" data-testid={`event-row-${event.idx}`}>
      <div
        className="flex items-start gap-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <Badge
          variant="outline"
          className={`text-[9px] font-mono uppercase shrink-0 mt-0.5 ${EVENT_COLORS[event.eventType] ?? ""}`}
        >
          {event.eventType}
        </Badge>
        <div className="flex-1 min-w-0">
          {event.name && (
            <span className="text-[11px] font-mono text-foreground mr-2">{event.name}</span>
          )}
          {event.subagent && (
            <span className="text-[11px] font-mono text-foreground mr-2">{event.subagent}</span>
          )}
          {event.message && (
            <span className="text-[11px] font-mono text-destructive mr-2">{event.message}</span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">{ts}</span>
        </div>
        <button className="text-muted-foreground shrink-0 mt-0.5">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>
      {open && (
        <pre className="mt-1.5 text-[9px] font-mono text-muted-foreground bg-background/60 rounded p-2 overflow-auto max-h-32 border border-border/20">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Read the stored runId from beat-view (written to localStorage keyed by caseId) */
function getStoredRunId(caseId: string): string | null {
  try {
    return localStorage.getItem(`beat_run_${caseId}`);
  } catch (_) {
    return null;
  }
}

export default function AgentInspector() {
  const { id: caseId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [timestamps, setTimestamps] = useState<Record<number, string>>({});
  const [isConnecting, setIsConnecting] = useState(true);
  const [streamDone, setStreamDone] = useState(false);
  const [runCost, setRunCost] = useState<number | null>(null);
  const [totalEvents, setTotalEvents] = useState<number | null>(null);
  const startTime = useRef<number>(Date.now());
  const startRun = useStartRun();
  const esRef = useRef<EventSource | null>(null);
  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  const { data: caseData } = useGetCase(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) },
  });

  function connectToRun(rId: string) {
    esRef.current?.close();
    setRunId(rId);
    setIsConnecting(false);
    setStreamDone(false);
    startTime.current = Date.now();

    const es = new EventSource(`${apiBase}/api/v1/runs/${rId}/events`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data);
        const elapsed = ((Date.now() - startTime.current) / 1000).toFixed(2);
        setTimestamps((prev) => ({ ...prev, [event.idx]: `+${elapsed}s` }));
        setEvents((prev) => [...prev, event]);
        if (event.eventType === "done") {
          const d = event.data as Record<string, unknown> | undefined;
          if (d?.totalEvents != null) setTotalEvents(Number(d.totalEvents));
          if (d?.cost != null) setRunCost(Number(d.cost));
          setStreamDone(true);
          es.close();
        }
        if (event.eventType === "error") {
          setStreamDone(true);
          es.close();
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    es.onerror = () => {
      setIsConnecting(false);
      es.close();
    };
  }

  useEffect(() => {
    if (!caseId) return;

    // Prefer the run that beat-view already started so we don't create a new one
    const existingRunId = getStoredRunId(caseId);
    if (existingRunId) {
      connectToRun(existingRunId);
    } else {
      // Fallback: start a fresh run if we arrive here directly
      startRun.mutate(
        { caseId, data: {} },
        {
          onSuccess: (res) => {
            try {
              localStorage.setItem(`beat_run_${caseId}`, res.runId);
            } catch (_) {}
            connectToRun(res.runId);
          },
          onError: () => {
            setIsConnecting(false);
          },
        }
      );
    }

    return () => {
      esRef.current?.close();
    };
  }, [caseId]);

  function handleReplay() {
    setEvents([]);
    setTimestamps({});
    setStreamDone(false);
    // Clear stored run so retry starts a fresh one
    try { localStorage.removeItem(`beat_run_${caseId}`); } catch (_) {}
    startRun.mutate(
      { caseId, data: {} },
      {
        onSuccess: (res) => {
          try { localStorage.setItem(`beat_run_${caseId}`, res.runId); } catch (_) {}
          connectToRun(res.runId);
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="agent-inspector-screen">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(`/investigations/${caseId}`)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold tracking-tight text-foreground">Agent Inspector</h1>
          <p className="text-[11px] text-muted-foreground font-mono truncate">
            {caseData?.title ?? caseId}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-primary" data-testid="event-count">
            {events.length} events
          </span>
          {totalEvents != null && (
            <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
              /{totalEvents} total
            </span>
          )}
          {runCost != null && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              style={{ borderColor: "rgba(0,255,136,0.2)", color: "#00FF88" }}
              data-testid="run-cost"
            >
              ${runCost.toFixed(4)}
            </span>
          )}
          {runId && (
            <span className="text-[10px] font-mono text-muted-foreground hidden lg:inline">
              {runId.slice(0, 8)}...
            </span>
          )}
          {streamDone && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReplay}
              className="h-7 text-xs gap-1"
              data-testid="button-replay"
            >
              <RefreshCw className="w-3 h-3" />
              Re-run
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1" data-testid="event-log">
        {isConnecting ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-xs font-mono">
            <span className="h-3 w-3 rounded-full border border-primary border-t-transparent animate-spin mr-2" />
            Connecting...
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-xs font-mono">
            <span className="h-3 w-3 rounded-full border border-primary border-t-transparent animate-spin mr-2" />
            Waiting for events...
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <motion.div
                key={event.idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
              >
                <EventRow event={event} ts={timestamps[event.idx] ?? ""} />
              </motion.div>
            ))}
            {streamDone && (
              <div className="text-center py-4 text-[10px] font-mono text-muted-foreground">
                Stream complete
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
