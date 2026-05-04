/**
 * Shared types between defender subagents and the orchestrator.
 *
 * Subagents emit "what happened" events (tool_call / tool_result /
 * partial_result) and return a structured artifact. The orchestrator
 * decorates each emit with subagent name + idx and bridges to the
 * AgentEvent SSE protocol via streamWriter.
 */

export type SubagentEmitEvent =
  | { type: "tool_call"; tool: string; args: Record<string, unknown>; status: "pending" | "running" | "success" | "error" }
  | { type: "tool_result"; tool: string; resultPreview: string }
  | { type: "partial_result"; data: Record<string, unknown> }
  | {
      type: "tool_progress";
      tool: string;
      /** 0..0.95 estimated completion fraction (caps at 0.95 while running). */
      progress: number;
      note?: string;
      elapsedMs: number;
      seq: number;
      meta?: Record<string, unknown>;
    }
  | {
      type: "model_routed";
      taskKind: string;
      chosenModel: string;
      provider: string;
      rationale: string;
      candidates: Array<{ modelId: string; provider: string; rank: number }>;
      predictedCostUsd: number;
    }
  | {
      type: "cache_hit";
      taskKind: string;
      similarity: number;
      cacheKey: string;
      costSavedUsd: number;
      lastUsedAt: string;
    }
  | {
      type: "policy_drop";
      subagent: string;
      rule: string;
      /** Redacted preview only — never the raw payload. */
      droppedPayloadPreview: string;
    }
  | {
      type: "judge_score";
      subagent: string;
      score: number;
      rationale: string;
      weakFields: string[];
      threshold: number;
      passed: boolean;
    }
  | {
      type: "guardrail_warning";
      state: "degrade" | "halt";
      remainingUsd: number;
      ceilingUsd: number;
      recommendation: string;
    }
  | {
      type: "retry_exhausted";
      subagent: string;
      attempts: Array<{
        attempt: number;
        ok: boolean;
        reason?: string;
        reformulation?: string;
        elapsedMs: number;
      }>;
    }
  | {
      // G23 NFR-E-014 — surfaces inter-subagent bus traffic on the
      // SSE channel so the Glass Box can render an "agent says agent"
      // strand alongside tool_call / partial_result.
      type: "agent_message";
      from: string;
      to: string;
      idx: number;
      body: Record<string, unknown>;
    };

export type SubagentEmit = (event: SubagentEmitEvent) => Promise<void>;

export interface SubagentResult<TArtifact> {
  artifact: TArtifact;
}
