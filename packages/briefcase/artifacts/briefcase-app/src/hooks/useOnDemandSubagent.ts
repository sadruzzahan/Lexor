import { useCallback, useState } from "react";
import { toast } from "sonner";
import { apiRequestOptions } from "@/lib/api";

/**
 * Fire the on-demand subagent endpoint (G13: Jury / Plea / Adversarial).
 * Direct fetch — the OpenAPI spec is not regenerated for this endpoint
 * yet because the schema is identical to R-10 (StartRunRequest body /
 * StartRunResponse). Once we regen, swap in the generated mutation hook.
 */
export type OnDemandSubagentName =
  | "MockJurySimulator"
  | "PleaOutcomeSimulator"
  | "ProsecutionSimulator";

interface StartResponse {
  runId: string;
  idempotent: boolean;
}

export function useOnDemandSubagent() {
  const [isPending, setPending] = useState(false);

  const start = useCallback(
    async (args: {
      caseId: string;
      subagent: OnDemandSubagentName;
      goal?: string;
    }): Promise<string | null> => {
      setPending(true);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...((apiRequestOptions.headers ?? {}) as Record<string, string>),
        };
        const res = await fetch(
          `/api/v1/cases/${encodeURIComponent(args.caseId)}/subagent/${encodeURIComponent(args.subagent)}/run`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              idempotencyKey: crypto.randomUUID(),
              ...(args.goal ? { goal: args.goal } : {}),
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(text || `${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as StartResponse;
        return body.runId;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to start subagent";
        toast.error(msg);
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { start, isPending };
}
