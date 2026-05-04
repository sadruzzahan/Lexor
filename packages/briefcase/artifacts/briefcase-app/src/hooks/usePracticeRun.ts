import { useEffect, useRef } from "react";
import type { AgentEvent } from "@workspace/api-client-react";
import { useAgentRunStore } from "@/stores/agentRunStore";
import practiceFixture from "@/lib/practice/state-v-sample.json";

/**
 * G19 / B2 — Practice Case driver.
 *
 * Pumps a canonical `AgentEvent` sequence into the same Zustand store that
 * `useAgentRun` writes to, but never touches the network. Designed so a
 * caller flips a single flag (`active`) and gets the full Briefcase pane
 * choreography against the local fixture.
 */

interface PracticeFixture {
  caseId: string;
  title: string;
  events: AgentEvent[];
}

const FIXTURE = practiceFixture as PracticeFixture;

export const PRACTICE_CASE_ID = FIXTURE.caseId;
export const PRACTICE_CASE_TITLE = FIXTURE.title;
export const isPracticeCaseId = (id: string | undefined | null): boolean =>
  id === FIXTURE.caseId;

const STEP_DELAY_MS = 380;

export function usePracticeRun(active: boolean): void {
  const reset = useAgentRunStore((s) => s.reset);
  const apply = useAgentRunStore((s) => s.apply);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    reset("practice-run-001");

    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      const ev = FIXTURE.events[i++];
      if (!ev) return;
      apply(ev);
      if (i < FIXTURE.events.length) {
        window.setTimeout(tick, STEP_DELAY_MS);
      }
    };
    const id = window.setTimeout(tick, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [active, reset, apply]);
}
