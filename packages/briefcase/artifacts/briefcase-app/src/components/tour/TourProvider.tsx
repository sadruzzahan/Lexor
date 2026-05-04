import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Spotlight, { type TourStep } from "./Spotlight";
import { setTourCompleted, tourCompleted } from "@/lib/firstRun";

/**
 * G19 / B3 — Spotlight tour orchestration.
 *
 * Pages register their steps via `useTour().setSteps(...)` whenever their
 * mount conditions change. Tour starts automatically the first time the
 * user lands on /cases (when `tourCompleted()` is false), or on demand from
 * Settings → "Replay tour".
 */

interface TourContextValue {
  setSteps: (steps: TourStep[]) => void;
  start: () => void;
  stop: () => void;
  isOpen: boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [steps, setStepsState] = useState<TourStep[]>([]);
  const [open, setOpen] = useState(false);

  const start = useCallback(() => setOpen(true), []);
  const stop = useCallback(() => {
    setOpen(false);
    setTourCompleted(true);
  }, []);

  const setSteps = useCallback((next: TourStep[]) => {
    setStepsState(next);
  }, []);

  const value = useMemo<TourContextValue>(
    () => ({ setSteps, start, stop, isOpen: open }),
    [setSteps, start, stop, open],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <Spotlight steps={steps} open={open && steps.length > 0} onClose={stop} />
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within <TourProvider>");
  }
  return ctx;
}

export const tourPreviouslyCompleted = tourCompleted;
