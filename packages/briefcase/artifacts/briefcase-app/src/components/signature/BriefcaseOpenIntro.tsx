/**
 * G20 Signature Moment — Briefcase Open.
 *
 * Native spec called for a Skia 3D briefcase with Reanimated lid hinge
 * + content float-up. On web we approximate the effect with CSS
 * perspective + Framer Motion: the case body scales in, the lid hinges
 * open along its top edge (rotateX from -180° → 0° around the upper
 * hinge), and the whole intro fades out under 1.4s so the bento grid
 * underneath morphs in with full focus.
 *
 * Gated by `markIfFirst("briefcase-open:<caseId>")` so subsequent
 * navigations to the same case in the same tab session go straight to
 * the grid. Reduced-motion swaps the cinematic for an instant fade.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase } from "lucide-react";
import { markIfFirst } from "@/lib/sessionFirsts";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { playSound } from "@/theme/sounds";
import { selection } from "@/lib/haptics";

interface Props {
  caseId: string;
  /** Optional — short label rendered on the case body (case title, etc.). */
  label?: string;
}

export function BriefcaseOpenIntro({ caseId, label }: Props) {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);

  // One-shot guard: only flip `show` true the first time per session
  // for this caseId. Decoupled from `reduced` so a mid-intro change to
  // the OS reduced-motion preference can never re-enter this branch
  // and re-trigger the markIfFirst guard (which would now be false).
  useEffect(() => {
    if (!caseId) return;
    if (!markIfFirst(`briefcase-open:${caseId}`)) return;
    setShow(true);
    playSound("briefcaseOpen");
    selection();
  }, [caseId]);

  // Dismiss timer lives in its own effect, keyed off `show` (and the
  // current motion preference). The hold duration is sized so that
  // hold + AnimatePresence exit fade together fit inside the spec's
  // 1.4s budget for the entire moment (G20 acceptance: ≤1.4s).
  useEffect(() => {
    if (!show) return;
    const ms = reduced ? 180 : 1000;
    const t = window.setTimeout(() => setShow(false), ms);
    return () => window.clearTimeout(t);
  }, [show, reduced]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="briefcase-intro"
          aria-hidden
          data-testid="briefcase-open-intro"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.4, ease: "easeOut" }}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm"
        >
          {reduced ? (
            <div className="flex flex-col items-center gap-3 text-foreground/80">
              <Briefcase className="size-12" />
              <span className="text-xs uppercase tracking-wide">
                Opening case
              </span>
            </div>
          ) : (
            <div
              className="relative"
              style={{ perspective: "1200px" }}
            >
              {/* Body of the briefcase — scales in from 0.85 with a
                  subtle lift; gives the lid something to hinge off of. */}
              <motion.div
                initial={{ scale: 0.84, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 240,
                  damping: 22,
                }}
                className="relative h-44 w-72 rounded-xl border border-[hsl(var(--violet)/0.45)] bg-gradient-to-br from-[hsl(var(--violet)/0.18)] to-[hsl(var(--violet)/0.04)] shadow-[0_30px_80px_-20px_hsl(var(--violet)/0.6)]"
                style={{ transformStyle: "preserve-3d" }}
              >
                {/* Latch */}
                <div className="absolute -top-1 left-1/2 h-2 w-12 -translate-x-1/2 rounded-sm bg-[hsl(var(--violet)/0.65)]" />
                {/* Handle */}
                <div className="absolute -top-5 left-1/2 h-3 w-20 -translate-x-1/2 rounded-full border border-[hsl(var(--violet)/0.55)]" />
                {/* Lid — hinged at the top edge, opens away from the
                    viewer so the contents below appear to float up. */}
                <motion.div
                  initial={{ rotateX: 0 }}
                  animate={{ rotateX: -125 }}
                  transition={{
                    delay: 0.18,
                    duration: 0.85,
                    ease: [0.22, 1.05, 0.36, 1],
                  }}
                  style={{
                    transformOrigin: "top center",
                    transformStyle: "preserve-3d",
                    backfaceVisibility: "hidden",
                  }}
                  className="absolute inset-0 rounded-xl border border-[hsl(var(--violet)/0.5)] bg-gradient-to-b from-[hsl(var(--violet)/0.32)] to-[hsl(var(--violet)/0.12)] shadow-inner"
                >
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground/85">
                    <Briefcase className="size-10" />
                    {label && (
                      <span className="max-w-[14rem] truncate text-center text-xs font-medium">
                        {label}
                      </span>
                    )}
                  </div>
                </motion.div>
                {/* Floating contents — cards lift up out of the case
                    after the lid clears. */}
                <div className="absolute inset-0 flex items-end justify-center overflow-visible">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12, scale: 0.85 }}
                      animate={{
                        opacity: [0, 1, 0],
                        y: [12, -56 - i * 10, -80 - i * 14],
                        scale: [0.85, 1, 0.95],
                      }}
                      transition={{
                        delay: 0.55 + i * 0.07,
                        duration: 0.85,
                        ease: "easeOut",
                      }}
                      className="absolute bottom-3 mx-1 h-12 w-20 rounded-md border border-[hsl(var(--violet)/0.35)] bg-card/90 shadow-md"
                      style={{
                        left: `${28 + i * 32}%`,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
