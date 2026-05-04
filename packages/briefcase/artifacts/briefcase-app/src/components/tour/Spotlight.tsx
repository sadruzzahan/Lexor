import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

/**
 * G19 / B3 — Spotlight tour.
 *
 * Renders a dim overlay with a pulsing ring around the next action and a
 * small caption + "Next / Skip" affordance. Steps target DOM elements by
 * `data-testid`. Skippable; replayable from Settings.
 *
 * Uses TTS via the browser's SpeechSynthesis API when available — the web
 * stand-in for `expo-speech`. Falls back silently when unavailable.
 */

export interface TourStep {
  testId: string;
  /** Caption shown next to the ring. */
  text: string;
  /** Spoken text. Defaults to `text` when omitted. */
  voice?: string;
  /** Optional persona color used to tint the ring. */
  color?: string;
}

interface SpotlightProps {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function speak(text: string) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export default function Spotlight({ steps, open, onClose }: SpotlightProps) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!open) {
      setIdx(0);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const step = steps[idx];
    if (!step) return;

    let cancelled = false;
    let raf = 0;
    const tries = { n: 0 };

    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-testid="${step.testId}"]`,
      );
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
        speak(step.voice ?? step.text);
        return;
      }
      // Element may not be mounted yet; retry briefly before bailing.
      tries.n += 1;
      if (tries.n < 30) {
        raf = window.setTimeout(measure, 120) as unknown as number;
      } else {
        // Skip steps whose target never appears (e.g. citations on a fresh case).
        next();
      }
    };
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelled = true;
      clearTimeout(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, steps]);

  if (!open || typeof document === "undefined") return null;

  const step = steps[idx];
  if (!step) return null;

  const next = () => {
    if (idx + 1 >= steps.length) onClose();
    else setIdx((i) => i + 1);
  };

  const ringColor = step.color ?? "hsl(var(--violet))";
  const pad = 8;
  const ringRect: Rect = rect
    ? { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }
    : { x: 0, y: 0, w: 0, h: 0 };

  // Caption position — below the rect when there's room, otherwise above.
  const belowSpace = window.innerHeight - (ringRect.y + ringRect.h) > 140;
  const captionTop = belowSpace
    ? ringRect.y + ringRect.h + 12
    : Math.max(12, ringRect.y - 120);

  return createPortal(
    <div
      data-testid="spotlight-overlay"
      className="pointer-events-none fixed inset-0 z-[90]"
    >
      {/* Dim */}
      <div className="absolute inset-0 bg-black/55" />

      {/* Cut-out via SVG mask */}
      {rect && (
        <svg className="absolute inset-0 h-full w-full">
          <defs>
            <mask id="spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={ringRect.x}
                y={ringRect.y}
                width={ringRect.w}
                height={ringRect.h}
                rx={14}
                ry={14}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.4)"
            mask="url(#spotlight-mask)"
          />
        </svg>
      )}

      {/* Pulsing ring */}
      <AnimatePresence>
        {rect && (
          <motion.div
            key={`ring-${idx}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{
              opacity: 1,
              scale: reduce ? 1 : [1, 1.04, 1],
            }}
            exit={{ opacity: 0 }}
            transition={
              reduce
                ? { duration: 0.2 }
                : { repeat: Infinity, duration: 1.6, ease: "easeInOut" }
            }
            data-testid="spotlight-ring"
            className="absolute rounded-2xl"
            style={{
              left: ringRect.x,
              top: ringRect.y,
              width: ringRect.w,
              height: ringRect.h,
              boxShadow: `0 0 0 2px ${ringColor}, 0 0 32px 8px ${ringColor}55`,
              border: `2px solid ${ringColor}`,
            }}
          />
        )}
      </AnimatePresence>

      {/* Caption + controls */}
      <div
        className="pointer-events-auto absolute left-1/2 max-w-md -translate-x-1/2 rounded-xl border bg-card px-4 py-3 shadow-lg"
        style={{ top: captionTop }}
        data-testid="spotlight-caption"
      >
        <p className="text-sm">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">
            Step {idx + 1} of {steps.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              data-testid="spotlight-skip"
            >
              Skip tour
            </Button>
            <Button size="sm" onClick={next} data-testid="spotlight-next">
              {idx + 1 >= steps.length ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
