/**
 * G17 / M3 — Animate the variable font weight axis on focus / active.
 *
 * Inter Variable + Geist Variable expose a continuous `wght` axis. We
 * apply `font-variation-settings: "wght" <n>` and animate it via CSS
 * `transition` (resolved through MotionSystem.soft) when the
 * `emphasized` / `active` flag flips.
 *
 * Returns a `style` object you can spread onto any element.
 */
import type { CSSProperties } from "react";
import { typography } from "@/theme/tokens";
import { MotionCss } from "@/theme/motion";
import { useReducedMotion } from "./useReducedMotion";

interface Options {
  emphasis?: boolean;
  active?: boolean;
  /** Override the resting weight; defaults to typography.weight.rest. */
  rest?: number;
}

export function useVariableFontWeight({
  emphasis = false,
  active = false,
  rest = typography.weight.rest,
}: Options): CSSProperties {
  const reduced = useReducedMotion();
  const target = active
    ? typography.weight.active
    : emphasis
      ? typography.weight.emphasis
      : rest;
  return {
    fontVariationSettings: `"wght" ${target}`,
    transition: reduced
      ? "none"
      : MotionCss.soft("font-variation-settings, font-weight"),
  };
}
