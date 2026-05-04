/**
 * G17 — MotionSystem (spec §7.5.B).
 *
 * Six named transitions that every animation in the app must resolve to.
 * Native plan used Reanimated `withSpring` / `withTiming` configs; on web
 * we expose the same shape as both Framer Motion `Transition` objects and
 * raw CSS `transition` strings so any layer can opt in.
 *
 * Lint rule (`scripts/lint-motion.mjs`) rejects:
 *   - `Easing.linear` references
 *   - raw `cubic-bezier(...)` / `transition: ... linear` strings
 *   - hard-coded ms durations in `transition` declarations
 * outside this module + generated code.
 */
import type { Transition } from "framer-motion";

/** Easing curve registry. Names map 1:1 to spec §7.5.B presets. */
export const easing: Record<string, [number, number, number, number]> = {
  whisper: [0.32, 0.0, 0.32, 1.0],
  soft: [0.22, 0.61, 0.36, 1.0],
  snap: [0.4, 0.0, 0.2, 1.0],
  dramatic: [0.65, 0.0, 0.35, 1.0],
};

/** CSS-friendly easing strings (kept in sync with `easing` above). */
export const cssEasing = {
  whisper: "cubic-bezier(0.32, 0.00, 0.32, 1.00)",
  soft: "cubic-bezier(0.22, 0.61, 0.36, 1.00)",
  snap: "cubic-bezier(0.40, 0.00, 0.20, 1.00)",
  dramatic: "cubic-bezier(0.65, 0.00, 0.35, 1.00)",
} as const;

/** Canonical durations in milliseconds. */
export const duration = {
  whisper: 120,
  soft: 220,
  bouncy: 380,
  elastic: 520,
  snap: 160,
  dramatic: 640,
} as const;

export type MotionPreset =
  | "whisper"
  | "soft"
  | "bouncy"
  | "elastic"
  | "snap"
  | "dramatic";

/**
 * Framer-motion transition objects keyed by preset name. Springs use the
 * Reanimated stiffness/damping numbers from spec §7.5.B so motion feels
 * identical to the native plan.
 */
// Framer-motion's `Transition.ease` type only accepts named keywords or
// EasingFunctions. Bezier-tuple ease values are runtime-supported but not in
// the public type, so we cast through `unknown` here (lint-motion-allow:
// motion.ts is the canonical token source and is on the lint allow-list).
export const MotionSystem: Record<MotionPreset, Transition> = {
  whisper: { duration: duration.whisper / 1000, ease: easing.whisper as unknown as Transition["ease"] },
  soft: { duration: duration.soft / 1000, ease: easing.soft as unknown as Transition["ease"] },
  bouncy: { type: "spring", stiffness: 320, damping: 22, mass: 0.9 },
  elastic: { type: "spring", stiffness: 180, damping: 14, mass: 1.1 },
  snap: { duration: duration.snap / 1000, ease: easing.snap as unknown as Transition["ease"] },
  dramatic: {
    duration: duration.dramatic / 1000,
    ease: easing.dramatic as unknown as Transition["ease"],
  },
};

/** CSS shorthand: `MotionCss.soft("opacity, transform")` → ready to drop into a `transition` declaration. */
export const MotionCss: Record<MotionPreset, (properties?: string) => string> = {
  whisper: (p = "all") => `${p} ${duration.whisper}ms ${cssEasing.whisper}`,
  soft: (p = "all") => `${p} ${duration.soft}ms ${cssEasing.soft}`,
  bouncy: (p = "all") => `${p} ${duration.bouncy}ms ${cssEasing.dramatic}`,
  elastic: (p = "all") => `${p} ${duration.elastic}ms ${cssEasing.dramatic}`,
  snap: (p = "all") => `${p} ${duration.snap}ms ${cssEasing.snap}`,
  dramatic: (p = "all") => `${p} ${duration.dramatic}ms ${cssEasing.dramatic}`,
};

/**
 * Resolve a motion preset, returning a static (no-op) transition under
 * `prefers-reduced-motion`. Components animating non-essential decoration
 * should pass the result through this helper.
 */
export function resolveMotion(
  preset: MotionPreset,
  reducedMotion: boolean,
): Transition {
  if (reducedMotion) return { duration: 0 };
  return MotionSystem[preset];
}
