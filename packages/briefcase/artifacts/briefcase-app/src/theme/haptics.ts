/**
 * G17 — HapticSystem.
 *
 * Native plan used `expo-haptics`; web equivalent is `navigator.vibrate`.
 * Events are *semantic* (selection / success / warning / error / impact)
 * so callers don't think in milliseconds — the mapping lives here.
 *
 * Honors the user's reduced-motion preference and the global mute toggle
 * (shared with `sounds.ts` so a single Settings switch silences both).
 */

export type HapticEvent =
  | "selection"
  | "soft"
  | "success"
  | "warning"
  | "error"
  | "impactLight"
  | "impactMedium"
  | "impactHeavy";

const PATTERN: Record<HapticEvent, number | number[]> = {
  selection: 8,
  soft: 14,
  success: [16, 40, 22],
  warning: [24, 30, 24],
  error: [40, 30, 60],
  impactLight: 12,
  impactMedium: 22,
  impactHeavy: 40,
};

let muted = false;

export function setHapticsMuted(value: boolean): void {
  muted = value;
}

export function areHapticsMuted(): boolean {
  return muted;
}

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fire a semantic haptic. Silently no-ops on:
 *   - non-browser environments
 *   - browsers without `navigator.vibrate` (Safari desktop, etc.)
 *   - when the user has muted haptics
 *   - when `prefers-reduced-motion: reduce` is set
 */
export function haptic(event: HapticEvent): void {
  if (muted || reducedMotion()) return;
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(PATTERN[event] as number | number[]);
  } catch {
    /* Some browsers throw on user-gesture rules; ignore. */
  }
}

/** Convenience aliases used throughout the app. */
export const HapticSystem = {
  selection: () => haptic("selection"),
  soft: () => haptic("soft"),
  success: () => haptic("success"),
  warning: () => haptic("warning"),
  error: () => haptic("error"),
  impactLight: () => haptic("impactLight"),
  impactMedium: () => haptic("impactMedium"),
  impactHeavy: () => haptic("impactHeavy"),
  setMuted: setHapticsMuted,
  isMuted: areHapticsMuted,
};
