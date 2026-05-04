import { cn } from "@/lib/utils";
import type { PaneStatus } from "@/stores/agentRunStore";

interface HaloProps {
  status: PaneStatus;
}

/**
 * Status halo behind each pane. Web stand-in for the spec's Skia gradient:
 * a soft radial-gradient layer that pulses while active and morphs to green
 * on completion. Disabled under `prefers-reduced-motion`.
 */
export function Halo({ status }: HaloProps) {
  const color =
    status === "completed"
      ? "from-emerald-400/40"
      : status === "error"
        ? "from-destructive/40"
        : status === "active"
          ? "from-primary/40"
          : "from-muted/30";

  return (
    <div
      aria-hidden
      style={{
        background:
          status === "completed"
            ? "radial-gradient(circle at 50% 0%, rgba(16,185,129,0.22), transparent 70%)"
            : status === "error"
              ? "radial-gradient(circle at 50% 0%, rgba(239,68,68,0.22), transparent 70%)"
              : status === "active"
                ? "radial-gradient(circle at 50% 0%, hsl(var(--violet) / 0.32), transparent 70%)"
                : "transparent",
      }}
      className={cn(
        // Hide the halo layer entirely under prefers-reduced-motion (no
        // gradient, no pulse) per the spec's reduced-motion contract.
        "pointer-events-none absolute inset-0 -z-10 rounded-2xl motion-reduce:hidden",
        color,
        status === "active" && "motion-safe:animate-pulse",
      )}
    />
  );
}
