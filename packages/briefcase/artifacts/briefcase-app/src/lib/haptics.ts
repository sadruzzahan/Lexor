/**
 * Web haptics shim. Spec calls for `expo-haptics` selection / success / warning
 * impacts on every interaction; on the web we use the Vibration API where
 * available (Android Chrome, some Samsung browsers). On platforms without
 * vibration support — desktop, iOS Safari — every call is a no-op so callers
 * never have to feature-detect.
 *
 * Reduced-motion users opt out of all haptics: the W3C reduced-motion
 * preference is the closest analog the web has to "I do not want
 * peripherally-perceived animation/feedback".
 */

function canVibrate(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }
  }
  return true;
}

function vibrate(pattern: number | number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw on long patterns; harmless */
  }
}

/** Tap / selection feedback. ~6 ms blip. */
export function selection(): void {
  vibrate(6);
}

/** Run-completion / positive confirmation. Two short blips. */
export function success(): void {
  vibrate([8, 24, 8]);
}

/** Subagent error / cancellation. Single longer blip. */
export function warning(): void {
  vibrate([18, 30, 32]);
}
