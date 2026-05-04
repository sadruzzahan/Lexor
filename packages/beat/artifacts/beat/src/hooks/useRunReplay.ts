import { useState, useRef, useCallback, useEffect } from "react";
import type { SubagentData, AgentRunState } from "./useAgentRun";
import type { AgentEvent } from "@workspace/api-client-react";

const REPLAY_SPEED = 4;
const REPLAY_INTERVAL_MS = 80 / REPLAY_SPEED;

export interface ReplayState {
  isReplaying: boolean;
  state: AgentRunState;
  subagents: Record<string, SubagentData>;
  progress: number;
  startReplay: () => void;
  stopReplay: () => void;
}

const INITIAL_SUBAGENTS: Record<string, SubagentData> = {
  SceneCaptureTagger: { state: "idle", text: "", toolCalls: [] },
  WitnessMapper: { state: "idle", text: "", toolCalls: [] },
  SuspectBackground: { state: "idle", text: "", toolCalls: [] },
  StatementDrafter: { state: "idle", text: "", toolCalls: [] },
};

export function useRunReplay(runId: string | null): ReplayState {
  const [isReplaying, setIsReplaying] = useState(false);
  const [state, setState] = useState<AgentRunState>("idle");
  const [subagents, setSubagents] = useState<Record<string, SubagentData>>(
    JSON.parse(JSON.stringify(INITIAL_SUBAGENTS)),
  );
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsRef = useRef<AgentEvent[]>([]);
  const idxRef = useRef(0);
  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  const applyEvent = useCallback((event: AgentEvent, prev: Record<string, SubagentData>) => {
    const next = { ...prev };

    if (event.eventType === "subagent_started" && event.name) {
      const existing = next[event.name] ?? { state: "idle" as const, text: "", toolCalls: [] };
      next[event.name] = { ...existing, state: "active" };
    }

    if (event.eventType === "tool_call" && event.subagent) {
      const current = next[event.subagent] ?? { state: "active" as const, text: "", toolCalls: [] };
      const tool = event.tool as Record<string, unknown> | undefined;
      if (tool?.name) {
        next[event.subagent] = {
          ...current,
          state: "active",
          toolCalls: [
            ...current.toolCalls,
            { name: String(tool.name), args: (tool.args as Record<string, unknown>) ?? {} },
          ],
        };
      }
    }

    if (event.eventType === "partial_result" && event.subagent) {
      const current = next[event.subagent] ?? { state: "active" as const, text: "", toolCalls: [] };
      const appendedText = event.data?.text
        ? current.text + String(event.data.text)
        : current.text;
      next[event.subagent] = { ...current, state: "active", text: appendedText };
    }

    if (event.eventType === "subagent_completed" && event.name) {
      const existing = next[event.name] ?? { state: "idle" as const, text: "", toolCalls: [] };
      next[event.name] = { ...existing, state: "done" };
    }

    return next;
  }, []);

  const startReplay = useCallback(async () => {
    if (!runId || isReplaying) return;
    clearTimer();

    // Reset state
    setSubagents(JSON.parse(JSON.stringify(INITIAL_SUBAGENTS)));
    setState("idle");
    setProgress(0);
    idxRef.current = 0;
    eventsRef.current = [];

    setIsReplaying(true);

    // Fetch all events
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(`${apiBase}/api/v1/runs/${runId}/events?replay=true`, {
        headers: { Accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      let body = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }

      const events: AgentEvent[] = [];
      for (const line of body.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try { events.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
      }
      eventsRef.current = events;
    } catch {
      setIsReplaying(false);
      return;
    }

    const total = eventsRef.current.length;
    if (total === 0) { setIsReplaying(false); return; }

    setState("running");
    timerRef.current = setInterval(() => {
      const idx = idxRef.current;
      if (idx >= eventsRef.current.length) {
        clearTimer();
        setIsReplaying(false);
        setState("done");
        setProgress(100);
        return;
      }

      const event = eventsRef.current[idx];
      idxRef.current = idx + 1;
      setProgress(Math.round(((idx + 1) / total) * 100));

      if (event.eventType === "done") {
        setSubagents((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => {
            if (next[k].state === "active") next[k] = { ...next[k], state: "done" };
          });
          return next;
        });
        clearTimer();
        setIsReplaying(false);
        setState("done");
        return;
      }

      setSubagents((prev) => applyEvent(event, prev));
    }, REPLAY_INTERVAL_MS);
  }, [runId, isReplaying, apiBase, applyEvent]);

  const stopReplay = useCallback(() => {
    clearTimer();
    setIsReplaying(false);
  }, []);

  useEffect(() => () => clearTimer(), []);

  return { isReplaying, state, subagents, progress, startReplay, stopReplay };
}
