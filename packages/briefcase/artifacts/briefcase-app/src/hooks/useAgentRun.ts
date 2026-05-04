import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getStreamRunEventsUrl } from "@workspace/api-client-react";
import { streamSse } from "@/lib/sse";
import { apiRequestOptions } from "@/lib/api";
import { useAgentRunStore } from "@/stores/agentRunStore";

/**
 * Subscribe to `/v1/runs/:runId/events` (SSE) and reduce events into the
 * agent-run store. Resets store state when `runId` changes.
 */
export function useAgentRun(runId: string | null): void {
  const reset = useAgentRunStore((s) => s.reset);
  const apply = useAgentRunStore((s) => s.apply);
  const lastRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastRunIdRef.current !== runId) {
      reset(runId);
      lastRunIdRef.current = runId;
    }
    if (!runId) return;

    const controller = new AbortController();
    const url = getStreamRunEventsUrl(runId);
    const headers = (apiRequestOptions.headers ?? {}) as Record<string, string>;

    let toastedDone = false;

    streamSse({
      url,
      headers,
      signal: controller.signal,
      onEvent: (event) => {
        apply(event);
        if (event.type === "done" && !toastedDone) {
          toastedDone = true;
          if (event.cancelled) {
            toast.info("Run cancelled");
          } else {
            toast.success("Ready");
          }
        }
        if (event.type === "error") {
          toast.error(event.message || "Agent error");
        }
      },
      onError: (err) => {
        // Network blips are surfaced once; the SSE loop handles backoff.
        // eslint-disable-next-line no-console
        console.warn("[useAgentRun] sse error", err);
      },
    });

    return () => controller.abort();
  }, [runId, reset, apply]);
}
