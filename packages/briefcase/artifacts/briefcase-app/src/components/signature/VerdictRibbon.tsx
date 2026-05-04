/**
 * G20 / A15 — Verdict Ribbon Drop.
 *
 * Mock Jury simulation completes → a verdict ribbon drops from the top
 * with the verdict + distribution. Native plan called for a 3D Skia
 * ribbon; the web equivalent uses CSS gradients + Framer Motion for the
 * drop spring. Plays `verdictRibbon` sound + warning haptic on arrival.
 *
 * Fires once per (caseId, finalVerdict) per tab session — re-running
 * the simulator with the same outcome won't re-trigger; a different
 * verdict will. Reduced-motion swaps the spring drop for a static
 * ribbon that fades in.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gavel, X } from "lucide-react";
import { markIfFirst } from "@/lib/sessionFirsts";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { playSound } from "@/theme/sounds";
import { success, warning } from "@/lib/haptics";

type Verdict = "acquit" | "convict" | "hung";

interface Props {
  caseId: string;
  verdict: Verdict;
  distribution: { acquit: number; convict: number; undecided: number };
}

const TONE: Record<Verdict, { color: string; bg: string; label: string }> = {
  acquit: {
    color: "text-emerald-50",
    bg: "from-emerald-500 to-emerald-700",
    label: "Acquit",
  },
  convict: {
    color: "text-rose-50",
    bg: "from-rose-500 to-rose-800",
    label: "Convict",
  },
  hung: {
    color: "text-amber-50",
    bg: "from-amber-500 to-amber-700",
    label: "Hung jury",
  },
};

export function VerdictRibbon({ caseId, verdict, distribution }: Props) {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!caseId || !verdict) return;
    if (!markIfFirst(`verdict-ribbon:${caseId}:${verdict}`)) return;
    setShow(true);
    playSound("verdictRibbon");
    if (verdict === "convict") warning();
    else success();
  }, [caseId, verdict]);

  if (!verdict) return null;
  const tone = TONE[verdict];
  const total = Math.max(
    1,
    distribution.acquit + distribution.convict + distribution.undecided,
  );

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={`verdict-${verdict}`}
          data-testid="verdict-ribbon"
          data-verdict={verdict}
          initial={
            reduced
              ? { opacity: 0 }
              : { y: -260, opacity: 0, rotateX: -25 }
          }
          animate={
            reduced
              ? { opacity: 1 }
              : { y: 0, opacity: 1, rotateX: 0 }
          }
          exit={{ opacity: 0, y: -40 }}
          transition={
            reduced
              ? { duration: 0.18 }
              : { type: "spring", stiffness: 140, damping: 16, mass: 0.9 }
          }
          className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4"
        >
          <div
            className={`pointer-events-auto mt-3 w-full max-w-2xl overflow-hidden rounded-b-2xl border border-white/10 bg-gradient-to-br ${tone.bg} ${tone.color} shadow-2xl`}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Gavel className="size-5" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider opacity-80">
                    Mock jury verdict
                  </div>
                  <div className="text-lg font-semibold leading-tight">
                    {tone.label}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShow(false)}
                className="rounded-full p-1 transition-colors hover:bg-white/15"
                aria-label="Dismiss verdict ribbon"
                data-testid="verdict-ribbon-dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex h-2 w-full overflow-hidden bg-black/25">
              <div
                className="bg-emerald-300/95"
                style={{ width: `${(distribution.acquit / total) * 100}%` }}
              />
              <div
                className="bg-amber-200/95"
                style={{ width: `${(distribution.undecided / total) * 100}%` }}
              />
              <div
                className="bg-rose-300/95"
                style={{ width: `${(distribution.convict / total) * 100}%` }}
              />
            </div>
            <div className="flex justify-between px-4 py-1.5 text-[11px] opacity-90">
              <span>Acquit · {distribution.acquit}</span>
              <span>Undecided · {distribution.undecided}</span>
              <span>Convict · {distribution.convict}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
