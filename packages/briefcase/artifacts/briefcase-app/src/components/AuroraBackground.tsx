import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Aurora mesh gradient. Web stand-in for the spec's Skia mesh-gradient drift:
 * three soft radial blobs (Linear-violet, cyan, pink) drift in a fixed
 * full-bleed layer. Animation is paused under `prefers-reduced-motion`.
 *
 * Pointer-events disabled so it never intercepts taps.
 */
export function AuroraBackground({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className,
      )}
      data-testid="aurora-bg"
    >
      <div
        className="absolute -top-1/3 -left-1/4 h-[60vh] w-[60vw] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--violet) / 0.55), transparent 70%)",
          animation: reduce ? undefined : "aurora-drift-a 22s ease-in-out infinite",
        }}
      />
      <div
        className="absolute top-1/4 -right-1/4 h-[55vh] w-[55vw] rounded-full opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(190 95% 62% / 0.45), transparent 70%)",
          animation: reduce ? undefined : "aurora-drift-b 26s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -bottom-1/4 left-1/4 h-[55vh] w-[55vw] rounded-full opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(330 90% 70% / 0.40), transparent 70%)",
          animation: reduce ? undefined : "aurora-drift-c 30s ease-in-out infinite",
        }}
      />
      {/* Subtle vignette so cards stay readable on bright auroras. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, hsl(var(--background) / 0.55) 100%)",
        }}
      />
    </div>
  );
}
