import { useEffect, useRef, useState } from "react";

export interface PipelineEvent {
  type:
    | "ready"
    | "step_start"
    | "step_complete"
    | "complete"
    | "error";
  step?: string;
  label?: string;
  data?: unknown;
  message?: string;
  caseId?: string;
}

export function useEventStream(url: string | null): {
  events: PipelineEvent[];
  isComplete: boolean;
  error: string | null;
} {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as PipelineEvent;
        setEvents((prev) => [...prev, parsed]);
        if (parsed.type === "complete") setIsComplete(true);
        if (parsed.type === "error") setError(parsed.message ?? "unknown");
      } catch {
        // ignore malformed frames
      }
    };
    es.onerror = () => {
      // Browser will auto-reconnect; only surface persistent errors via
      // explicit "error" frames from the server.
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [url]);

  return { events, isComplete, error };
}
