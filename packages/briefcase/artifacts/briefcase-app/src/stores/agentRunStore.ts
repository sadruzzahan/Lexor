import { create } from "zustand";
import type {
  AgentEvent,
  AgentEventToolCall,
  AgentEventToolResult,
} from "@workspace/api-client-react";

export type PaneStatus = "idle" | "active" | "completed" | "error";

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error";
  resultPreview?: string;
}

export interface PaneState {
  pane: number;
  subagent: string | null;
  status: PaneStatus;
  reasoning: string[];
  toolCalls: ToolCall[];
  partial: Record<string, unknown> | null;
  artifact: Record<string, unknown> | null;
  errorMessage?: string;
}

export interface AgentRunState {
  runId: string | null;
  goal: string | null;
  rolePack: string | null;
  prepActivity: string[];
  panes: PaneState[];
  citations: Array<{
    fileId: string;
    label: string;
    page?: number;
    snippet?: string;
  }>;
  done: boolean;
  cancelled: boolean;
  error: string | null;
  /** Highest event idx already applied; used to dedupe replay-on-resume. */
  lastIdx: number;
  /**
   * Raw event log for the Glass Box Theater (G15). Stored in apply()
   * after the dedupe gate so replays don't duplicate; capped at 2000
   * to bound memory on long runs.
   */
  rawEvents: AgentEvent[];
  reset: (runId: string | null) => void;
  apply: (event: AgentEvent) => void;
}

/**
 * Pane allocation is now dynamic: the planner can pick anywhere from
 * 1–7 defender subagents, and panes are appended (sorted by the
 * orchestrator's canonical pane index) as `subagent_started` events
 * arrive. This keeps the grid responsive to the planned set without
 * showing empty placeholder cards for subagents that were skipped.
 */
const blankPane = (i: number, subagent: string | null = null): PaneState => ({
  pane: i,
  subagent,
  status: subagent ? "active" : "idle",
  reasoning: [],
  toolCalls: [],
  partial: null,
  artifact: null,
});

const initialPanes = (): PaneState[] => [];

function updatePane(
  panes: PaneState[],
  index: number,
  patch: (p: PaneState) => PaneState,
): PaneState[] {
  if (index < 0 || index >= panes.length) return panes;
  return panes.map((p, i) => (i === index ? patch(p) : p));
}

function findPaneIndex(panes: PaneState[], subagent: string): number {
  return panes.findIndex((p) => p.subagent === subagent);
}

export const useAgentRunStore = create<AgentRunState>((set) => ({
  runId: null,
  goal: null,
  rolePack: null,
  prepActivity: [],
  panes: initialPanes(),
  citations: [],
  done: false,
  cancelled: false,
  error: null,
  lastIdx: -1,
  rawEvents: [],

  reset: (runId) =>
    set({
      runId,
      goal: null,
      rolePack: null,
      prepActivity: [],
      panes: initialPanes(),
      citations: [],
      done: false,
      cancelled: false,
      error: null,
      lastIdx: -1,
      rawEvents: [],
    }),

  apply: (event) =>
    set((state) => {
      // Dedupe replay-on-resume: the server replays persisted events from
      // `run_events` synchronously after a reconnect, so we may see indices
      // we've already applied. Drop them.
      if (typeof event.idx === "number" && event.idx <= state.lastIdx) {
        return {};
      }
      const newLastIdx =
        typeof event.idx === "number"
          ? Math.max(state.lastIdx, event.idx)
          : state.lastIdx;
      const result = applyEvent(state, event);
      const nextRaw =
        state.rawEvents.length >= 2000
          ? [...state.rawEvents.slice(-1999), event]
          : [...state.rawEvents, event];
      return { ...result, lastIdx: newLastIdx, rawEvents: nextRaw };
    }),
}));

function applyEvent(
  state: AgentRunState,
  event: AgentEvent,
): Partial<AgentRunState> {
  switch (event.type) {
        case "run_started":
          return {
            runId: event.runId,
            goal: event.goal,
            rolePack: event.rolePack,
          };

        case "planner_step":
          return {
            prepActivity: [...state.prepActivity, event.text],
          };

        case "subagent_started": {
          const pane = event.pane;
          // Out-of-grid subagent (negative pane index, e.g.
          // JurisdictionDetector when wired through this channel) →
          // surface in the prep activity rail instead.
          if (pane < 0) {
            return {
              prepActivity: [
                ...state.prepActivity,
                `${event.subagent} started`,
              ],
            };
          }
          // Already allocated (resume / replay) → just refresh.
          const existing = state.panes.findIndex(
            (p) => p.pane === pane || p.subagent === event.subagent,
          );
          if (existing >= 0) {
            return {
              panes: updatePane(state.panes, existing, (p) => ({
                ...p,
                subagent: event.subagent,
                status: p.status === "completed" ? "completed" : "active",
              })),
            };
          }
          // New pane: insert in sorted-by-pane-index order so the grid
          // matches the orchestrator's canonical layout.
          const inserted = [
            ...state.panes,
            blankPane(pane, event.subagent),
          ].sort((a, b) => a.pane - b.pane);
          return { panes: inserted };
        }

        case "tool_call": {
          const e = event as AgentEventToolCall;
          const idx = findPaneIndex(state.panes, e.subagent);
          if (idx < 0) {
            return {
              prepActivity: [
                ...state.prepActivity,
                `${e.subagent}: ${e.tool}`,
              ],
            };
          }
          return {
            panes: updatePane(state.panes, idx, (p) => ({
              ...p,
              toolCalls: [
                ...p.toolCalls,
                {
                  tool: e.tool,
                  args: e.args ?? {},
                  status: e.status,
                },
              ],
            })),
          };
        }

        case "tool_result": {
          const e = event as AgentEventToolResult;
          const idx = findPaneIndex(state.panes, e.subagent);
          if (idx < 0) return {};
          return {
            panes: updatePane(state.panes, idx, (p) => {
              // Update the most recent matching tool call.
              const calls = [...p.toolCalls];
              for (let i = calls.length - 1; i >= 0; i--) {
                if (calls[i].tool === e.tool && calls[i].status !== "success") {
                  calls[i] = {
                    ...calls[i],
                    status: "success",
                    resultPreview: e.resultPreview,
                  };
                  break;
                }
              }
              return { ...p, toolCalls: calls };
            }),
          };
        }

        case "partial_result": {
          const idx = findPaneIndex(state.panes, event.subagent);
          if (idx < 0) return {};
          const data = event.data ?? {};
          // Harvest citations from any partial that carries them so the UI
          // can surface CitationChips alongside reasoning.
          const newCitations: AgentRunState["citations"] = [];
          const rawCites = (data as { citations?: unknown }).citations;
          if (Array.isArray(rawCites)) {
            for (const c of rawCites) {
              if (c && typeof c === "object") {
                const obj = c as Record<string, unknown>;
                const fileId = obj["fileId"] ?? obj["sourceId"];
                const label = obj["label"] ?? obj["title"] ?? obj["snippet"];
                if (typeof fileId === "string" && typeof label === "string") {
                  // Pull a citation snippet (text we'll search for + highlight
                  // in the source viewer). Many subagents emit it as `snippet`
                  // / `text` / `quote` / `excerpt` — accept all.
                  const snippetCandidate =
                    obj["snippet"] ?? obj["text"] ?? obj["quote"] ?? obj["excerpt"];
                  newCitations.push({
                    fileId,
                    label,
                    page: typeof obj["page"] === "number"
                      ? (obj["page"] as number)
                      : undefined,
                    snippet:
                      typeof snippetCandidate === "string"
                        ? snippetCandidate
                        : undefined,
                  });
                }
              }
            }
          }
          // Dedupe by (fileId|page|label|snippet) so long streams that
          // re-emit the same source don't pile up duplicate chips, but
          // distinct snippets on the same page still surface as separate
          // chips (each one anchors to a different highlight).
          const seen = new Set(
            state.citations.map(
              (c) => `${c.fileId}|${c.page ?? ""}|${c.label}|${c.snippet ?? ""}`,
            ),
          );
          const merged = [...state.citations];
          for (const c of newCitations) {
            const key = `${c.fileId}|${c.page ?? ""}|${c.label}|${c.snippet ?? ""}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(c);
            }
          }
          return {
            citations:
              merged.length !== state.citations.length
                ? merged
                : state.citations,
            panes: updatePane(state.panes, idx, (p) => {
              const next: PaneState = { ...p, partial: data };
              const reasoning =
                typeof data["text"] === "string"
                  ? (data["text"] as string)
                  : typeof data["summary"] === "string"
                    ? (data["summary"] as string)
                    : null;
              if (reasoning) {
                next.reasoning = [...p.reasoning, reasoning].slice(-6);
              }
              return next;
            }),
          };
        }

        case "subagent_completed": {
          const idx = findPaneIndex(state.panes, event.subagent);
          if (idx < 0) return {};
          return {
            panes: updatePane(state.panes, idx, (p) => ({
              ...p,
              // Preserve error terminality: orchestrator emits a synthetic
              // `subagent_completed` after an error so artifacts always
              // appear, but the pane should keep its failed status.
              status: p.status === "error" ? "error" : "completed",
              artifact: event.data ?? {},
            })),
          };
        }

        case "error": {
          const sub = event.subagent;
          if (sub) {
            const idx = findPaneIndex(state.panes, sub);
            if (idx >= 0) {
              return {
                panes: updatePane(state.panes, idx, (p) => ({
                  ...p,
                  status: "error",
                  errorMessage: event.message,
                })),
              };
            }
          }
          return { error: event.message };
        }

        case "final_result":
          // Final result is captured by subagent_completed events; nothing
          // pane-specific to reduce here.
          return {};

        case "done":
          return {
            done: true,
            cancelled: Boolean(event.cancelled),
          };

    default:
      return {};
  }
}
