/**
 * G17 / M7 — Magnetic snap helper.
 *
 * Given an array of anchor positions and a current value, resolves to the
 * nearest anchor whenever the user's gesture finishes within `radius`.
 * Caller decides what "value" means (px on a slider, rotation degrees on
 * a picker wheel, x/y on a draggable FAB) — the helper just snaps the
 * scalar.
 *
 * Returns `{ value, snapping, snapNow, resetTo }`. `snapNow()` is meant
 * to fire on `pointerUp`; the resulting Framer Motion transition uses
 * `MotionSystem.bouncy` for the spring landing.
 */
import { useCallback, useMemo, useRef, useState } from "react";

export interface MagneticSnapOptions {
  anchors: number[];
  /** How far (in the same unit as anchors) from an anchor still magnets. */
  radius?: number;
  initial?: number;
  onSnap?: (value: number, index: number) => void;
}

export interface MagneticSnapResult {
  value: number;
  snapping: boolean;
  /** Called continuously while the user drags. */
  setValue: (next: number) => void;
  /** Call on pointerUp / drag-end to commit to the nearest anchor. */
  snapNow: () => { value: number; index: number };
  /** Programmatically jump to an anchor. */
  resetTo: (anchorIndex: number) => void;
}

export function useMagneticSnap({
  anchors,
  radius = Infinity,
  initial,
  onSnap,
}: MagneticSnapOptions): MagneticSnapResult {
  const sortedAnchors = useMemo(() => [...anchors].sort((a, b) => a - b), [anchors]);
  const [value, setValueState] = useState<number>(
    initial ?? sortedAnchors[0] ?? 0,
  );
  const [snapping, setSnapping] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue = useCallback((next: number) => {
    setSnapping(false);
    setValueState(next);
  }, []);

  const snapNow = useCallback(() => {
    let nearestIdx = 0;
    let nearestDelta = Infinity;
    sortedAnchors.forEach((a, i) => {
      const delta = Math.abs(a - valueRef.current);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIdx = i;
      }
    });
    if (nearestDelta > radius) {
      // Outside magnet zone — leave the value alone.
      setSnapping(false);
      return { value: valueRef.current, index: -1 };
    }
    const target = sortedAnchors[nearestIdx]!;
    setSnapping(true);
    setValueState(target);
    onSnap?.(target, nearestIdx);
    return { value: target, index: nearestIdx };
  }, [sortedAnchors, radius, onSnap]);

  const resetTo = useCallback(
    (i: number) => {
      const target = sortedAnchors[i];
      if (target === undefined) return;
      setSnapping(true);
      setValueState(target);
    },
    [sortedAnchors],
  );

  return { value, snapping, setValue, snapNow, resetTo };
}
