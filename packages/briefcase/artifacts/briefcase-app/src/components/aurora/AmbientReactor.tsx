/**
 * G17 / M5 — AmbientReactor.
 *
 * Subscribes to the active agent run store and modulates the Aurora
 * background's intensity + color drift. On bursts of activity (new tool
 * calls, citations) intensity ramps to 1.0; in idle it decays to ~0.4.
 *
 * Reduced-motion → returns a static medium intensity so the gradient
 * still looks alive but never animates.
 * Low battery (<20%) → throttles the canvas to 30 fps via the prop.
 */
import { useEffect, useRef, useState } from "react";
import { useAgentRunStore } from "@/stores/agentRunStore";
import { useHushModeStore } from "@/stores/hushModeStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { AuroraCanvas } from "./AuroraCanvas";

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

function useLowBattery(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const getBattery = (
      navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    ).getBattery;
    if (typeof getBattery !== "function") return;
    let battery: BatteryLike | null = null;
    let cancelled = false;
    const update = () => {
      if (battery) setLow(!battery.charging && battery.level < 0.2);
    };
    getBattery.call(navigator).then((b: BatteryLike) => {
      if (cancelled) return;
      battery = b;
      update();
      b.addEventListener?.("levelchange", update);
      b.addEventListener?.("chargingchange", update);
    });
    return () => {
      cancelled = true;
      battery?.removeEventListener?.("levelchange", update);
      battery?.removeEventListener?.("chargingchange", update);
    };
  }, []);
  return low;
}

interface AmbientReactorProps {
  trueBlack?: boolean;
  /** Optional callback so parents (OLED accent oscillator) can read activity. */
  onActivity?: (activity: number) => void;
}

export function AmbientReactor({
  trueBlack = false,
  onActivity,
}: AmbientReactorProps) {
  const panes = useAgentRunStore((s) => s.panes);
  const citations = useAgentRunStore((s) => s.citations);
  const done = useAgentRunStore((s) => s.done);
  const hush = useHushModeStore((s) => s.hush);
  const reduced = useReducedMotion();
  const lowBattery = useLowBattery();

  const [intensity, setIntensity] = useState(0.45);
  const [colorDrift, setColorDrift] = useState(0);
  const lastSignatureRef = useRef<string>("");
  const decayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse on every meaningful change in the run state.
  useEffect(() => {
    if (hush) {
      // G20 — Hush Mode: aurora freezes to a low, quiet floor so the
      // courtroom surface stays distraction-free. Pulses + decay loop
      // are short-circuited entirely below.
      const quiet = 0.18;
      setIntensity(quiet);
      setColorDrift(0);
      onActivity?.(quiet);
      return;
    }
    if (reduced) {
      const stable = 0.55;
      setIntensity(stable);
      setColorDrift(done ? 0.2 : 0);
      onActivity?.(stable);
      return;
    }
    const sig = `${panes.length}:${citations.length}:${done ? 1 : 0}`;
    if (sig !== lastSignatureRef.current) {
      lastSignatureRef.current = sig;
      const next = Math.min(1, 0.6 + panes.length * 0.05 + citations.length * 0.02);
      setIntensity(next);
      setColorDrift(Math.min(1, panes.length * 0.07));
      onActivity?.(next);
    }
  }, [panes.length, citations.length, done, reduced, hush, onActivity]);

  // Decay back toward the resting intensity between bursts.
  useEffect(() => {
    if (reduced || hush) return;
    decayTimerRef.current = setInterval(() => {
      setIntensity((curr) => {
        const next = curr * 0.92 + 0.45 * 0.08;
        onActivity?.(next);
        return next;
      });
      setColorDrift((curr) => curr * 0.94);
    }, 600);
    return () => {
      if (decayTimerRef.current) clearInterval(decayTimerRef.current);
    };
  }, [reduced, hush, onActivity]);

  return (
    <AuroraCanvas
      intensity={intensity}
      colorDrift={colorDrift}
      lowBattery={lowBattery}
      trueBlack={trueBlack}
    />
  );
}
