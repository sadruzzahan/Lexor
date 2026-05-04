/**
 * G17 / M9 — Skeleton-to-content morph.
 *
 * Replaces the instant pop-in that used to happen when a page swapped
 * from `<Spinner>` to real content. Renders the skeleton on first paint,
 * cross-fades + scales into the children once `loading` flips to false.
 *
 * Uses `MotionSystem.bouncy` for the landing spring and respects
 * `prefers-reduced-motion` (instant swap, no scale).
 */
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { MotionSystem, duration } from "@/theme/motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Props {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  /** data-testid forwarded to the morph wrapper. */
  testId?: string;
}

export function SkeletonMorph({
  loading,
  skeleton,
  children,
  testId,
}: Props) {
  const reduced = useReducedMotion();
  const transition = reduced
    ? { duration: 0 }
    : { ...MotionSystem.bouncy, duration: duration.bouncy / 1000 };

  return (
    <div className="relative" data-testid={testId}>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div
            key="skeleton"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.985, filter: "blur(4px)" }
            }
            transition={transition}
            data-testid="skeleton-morph-skeleton"
          >
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={
              reduced
                ? { opacity: 1 }
                : { opacity: 0, scale: 0.985, filter: "blur(6px)" }
            }
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
            transition={transition}
            data-testid="skeleton-morph-content"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
