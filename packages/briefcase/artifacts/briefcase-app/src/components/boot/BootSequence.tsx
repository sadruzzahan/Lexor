import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCENT_VIOLET, HOLO_MARKER } from "@/theme/tokens";

/**
 * G19 / B1 — First-launch boot sequence.
 *
 * 1) Particles converge into the Briefcase logo (Canvas2D — the web stand-in
 *    for Skia on native; honors `prefers-reduced-motion`).
 * 2) Personas introduce themselves with name + role.
 * 3) "Continue" / "Skip" — both call `onComplete` and persist the flag.
 *
 * Runs once per install; replay from Settings clears the flag.
 */

interface BootSequenceProps {
  onComplete: () => void;
}

const PERSONAS = [
  {
    name: "Counsel",
    role: "I'm Counsel, your second chair. I draft, plan, and brief.",
    color: ACCENT_VIOLET,
  },
  {
    name: "Investigator",
    role: "I'm Investigator. I hunt contradictions and gaps in the evidence.",
    color: HOLO_MARKER,
  },
  {
    name: "Clerk",
    role: "I'm Clerk. I find precedents and keep the citations honest.",
    color: "#5BD0B7",
  },
] as const;

type Phase = "particles" | "personas" | "done";

export default function BootSequence({ onComplete }: BootSequenceProps) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduce ? "personas" : "particles");
  const [personaIdx, setPersonaIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ---- Particle assembly ----
  useEffect(() => {
    if (phase !== "particles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    ctx.scale(dpr, dpr);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    // Sample a "B" by drawing it offscreen and reading pixel positions.
    const sample = document.createElement("canvas");
    sample.width = cw;
    sample.height = ch;
    const sctx = sample.getContext("2d")!;
    sctx.fillStyle = "#fff";
    sctx.font = "bold 200px 'Geist Variable', 'Inter Variable', sans-serif";
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.fillText("B", cw / 2, ch / 2);
    const data = sctx.getImageData(0, 0, cw, ch).data;

    const targets: Array<{ x: number; y: number }> = [];
    const step = 6;
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        const a = data[(y * cw + x) * 4 + 3];
        if (a > 128) targets.push({ x, y });
      }
    }

    const particles = targets.map((t) => ({
      tx: t.x,
      ty: t.y,
      x: Math.random() * cw,
      y: Math.random() * ch,
      vx: 0,
      vy: 0,
    }));

    let raf = 0;
    const t0 = performance.now();
    const DURATION = 1600;

    const tick = (now: number) => {
      const elapsed = now - t0;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = ACCENT_VIOLET;
      for (const p of particles) {
        // Critically-damped pull toward target.
        p.vx = (p.vx + (p.tx - p.x) * 0.06) * 0.78;
        p.vy = (p.vy + (p.ty - p.y) * 0.06) * 0.78;
        p.x += p.vx;
        p.y += p.vy;
        ctx.fillRect(p.x, p.y, 2, 2);
      }
      if (elapsed < DURATION) {
        raf = requestAnimationFrame(tick);
      } else {
        setPhase("personas");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Auto-advance personas on a timer; user can also click Next.
  useEffect(() => {
    if (phase !== "personas") return;
    if (personaIdx >= PERSONAS.length - 1) return;
    const id = window.setTimeout(() => setPersonaIdx((i) => i + 1), 2200);
    return () => window.clearTimeout(id);
  }, [phase, personaIdx]);

  const finish = () => {
    setPhase("done");
    onComplete();
  };

  return (
    <div
      data-testid="boot-sequence"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
    >
      <button
        type="button"
        onClick={finish}
        data-testid="boot-skip"
        className="absolute right-4 top-4 rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      >
        Skip
      </button>

      <AnimatePresence mode="wait">
        {phase === "particles" && (
          <motion.div
            key="particles"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <canvas
              ref={canvasRef}
              data-testid="boot-particles"
              style={{ width: 320, height: 320 }}
            />
            <p className="mt-2 text-xs text-muted-foreground">Briefcase</p>
          </motion.div>
        )}

        {phase === "personas" && (
          <motion.div
            key="personas"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex w-full max-w-md flex-col items-center px-6 text-center"
          >
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-md"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_VIOLET} 0%, hsl(265 85% 65%) 100%)`,
              }}
            >
              <Briefcase className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Briefcase</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Meet your team
            </p>

            <div
              className="mt-6 min-h-[7rem] w-full"
              data-testid="persona-stage"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={personaIdx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 220, damping: 26 }}
                  className="rounded-xl border bg-card p-4 text-left"
                  data-testid={`persona-${PERSONAS[personaIdx].name.toLowerCase()}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: PERSONAS[personaIdx].color }}
                    />
                    <span className="text-sm font-semibold">
                      {PERSONAS[personaIdx].name}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {PERSONAS[personaIdx].role}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-6 flex w-full items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {PERSONAS.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full transition"
                    style={{
                      background:
                        i === personaIdx
                          ? ACCENT_VIOLET
                          : "hsl(var(--muted-foreground) / 0.3)",
                    }}
                  />
                ))}
              </div>
              {personaIdx < PERSONAS.length - 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPersonaIdx((i) => i + 1)}
                  data-testid="persona-next"
                >
                  Next
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={finish}
                  data-testid="boot-continue"
                >
                  Get started
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
