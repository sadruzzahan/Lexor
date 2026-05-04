import { useEffect, useState, useRef } from "react";
import type { AgentEvent } from "@workspace/api-client-react";

export type AgentRunState = "idle" | "running" | "done" | "error";
export type SubagentState = "idle" | "active" | "done" | "error";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
}

export interface SubagentData {
  state: SubagentState;
  text: string;
  toolCalls: ToolCallRecord[];
}

export interface RunData {
  runId: string | null;
  state: AgentRunState;
  subagents: Record<string, SubagentData>;
  events: AgentEvent[];
}

const INITIAL_SUBAGENTS: Record<string, SubagentData> = {
  SceneCaptureTagger: { state: "idle", text: "", toolCalls: [] },
  WitnessMapper: { state: "idle", text: "", toolCalls: [] },
  SuspectBackground: { state: "idle", text: "", toolCalls: [] },
  StatementDrafter: { state: "idle", text: "", toolCalls: [] },
};

function makeInitialRunData(runId: string | null): RunData {
  return {
    runId,
    state: runId ? "running" : "idle",
    subagents: JSON.parse(JSON.stringify(INITIAL_SUBAGENTS)),
    events: [],
  };
}

export function useAgentRun(caseId: string, runIdToMonitor: string | null) {
  const [data, setData] = useState<RunData>(() => makeInitialRunData(runIdToMonitor));
  const eventSourceRef = useRef<EventSource | null>(null);
  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  useEffect(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    if (!runIdToMonitor) {
      setData(makeInitialRunData(null));
      return;
    }

    setData(makeInitialRunData(runIdToMonitor));

    const es = new EventSource(`${apiBase}/api/v1/runs/${runIdToMonitor}/events`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data);

        setData((prev) => {
          const newEvents = [...prev.events, event];
          const newSubagents = { ...prev.subagents };

          if (event.eventType === "run_started") {
            return { ...prev, state: "running", events: newEvents };
          }

          if (event.eventType === "subagent_started" && event.name) {
            const existing = newSubagents[event.name] ?? { state: "idle" as SubagentState, text: "", toolCalls: [] };
            newSubagents[event.name] = { ...existing, state: "active" };
          }

          if (event.eventType === "tool_call" && event.subagent) {
            const current = newSubagents[event.subagent] ?? { state: "active" as SubagentState, text: "", toolCalls: [] };
            const tool = event.tool as Record<string, unknown> | undefined;
            if (tool?.name) {
              const newToolCalls = [...(current.toolCalls ?? []), {
                name: String(tool.name),
                args: (tool.args as Record<string, unknown>) ?? {},
              }];
              newSubagents[event.subagent] = { ...current, state: "active", toolCalls: newToolCalls };
            }
          }

          if (event.eventType === "partial_result" && event.subagent) {
            const current = newSubagents[event.subagent] ?? { state: "active" as SubagentState, text: "", toolCalls: [] };
            const appendedText = event.data?.text
              ? (current.text ?? "") + String(event.data.text)
              : (current.text ?? "");
            newSubagents[event.subagent] = { ...current, state: "active", text: appendedText };
          }

          if (event.eventType === "subagent_completed" && event.name) {
            const existing = newSubagents[event.name] ?? { state: "idle" as SubagentState, text: "", toolCalls: [] };
            newSubagents[event.name] = { ...existing, state: "done" };
          }

          if (event.eventType === "done") {
            Object.keys(newSubagents).forEach((key) => {
              if (newSubagents[key].state === "active") {
                newSubagents[key] = { ...newSubagents[key], state: "done" };
              }
            });
            es.close();
            return { ...prev, state: "done", subagents: newSubagents, events: newEvents };
          }

          if (event.eventType === "error") {
            es.close();
            return { ...prev, state: "error", events: newEvents };
          }

          return { ...prev, subagents: newSubagents, events: newEvents };
        });
      } catch (err) {
        console.error("Failed to parse SSE event", err);
      }
    };

    es.onerror = () => {
      console.error("SSE connection error");
      setData((prev) => ({ ...prev, state: "error" }));
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runIdToMonitor]);

  return data;
}
