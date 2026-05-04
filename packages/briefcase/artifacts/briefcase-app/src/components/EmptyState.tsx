import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Briefcase,
  FileSearch,
  MessageSquare,
  Quote,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ACCENT_VIOLET, HOLO_MARKER } from "@/theme/tokens";

/**
 * G19 / B6 — Smart empty states.
 *
 * Every empty pane / tab renders a brand-tinted animated illustration plus
 * a one-line teach. Native plan uses Skia; on web we use Canvas2D + a few
 * Lucide marks. Variants ship with copy presets but `title` / `description`
 * still let pages override.
 */

type EmptyVariant =
  | "cases"
  | "evidence"
  | "contradictions"
  | "citations"
  | "search"
  | "messages"
  | "generic";

interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  className?: string;
  /** Optional CTA — e.g. "Try a sample case". */
  action?: React.ReactNode;
}

const PRESETS: Record<EmptyVariant, { title: string; description: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  cases: {
    title: "No cases yet",
    description: "Tap + to start your first case — or try the practice case below.",
    Icon: Briefcase,
    color: ACCENT_VIOLET,
  },
  evidence: {
    title: "No evidence yet",
    description: "Scan or upload a document and the AI will start reading it for you.",
    Icon: FileSearch,
    color: HOLO_MARKER,
  },
  contradictions: {
    title: "No contradictions found",
    description: "When the AI finds contradictions in the evidence, they'll appear here.",
    Icon: AlertTriangle,
    color: "#F59E0B",
  },
  citations: {
    title: "No sources cited yet",
    description: "Sources appear here as the AI cites them — tap to jump to the page.",
    Icon: Quote,
    color: ACCENT_VIOLET,
  },
  search: {
    title: "Nothing matches",
    description: "Try a different keyword, or clear the filters.",
    Icon: FileSearch,
    color: HOLO_MARKER,
  },
  messages: {
    title: "No messages",
    description: "Conversations with your team show up here.",
    Icon: MessageSquare,
    color: "#5BD0B7",
  },
  generic: {
    title: "Nothing here yet",
    description: "When something shows up, you'll see it on this screen.",
    Icon: Sparkles,
    color: ACCENT_VIOLET,
  },
};

/** B6 — small Canvas2D bloom that gently breathes around the icon. */
function AnimatedBloom({ color }: { color: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reduce) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 120;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      for (let i = 0; i < 3; i++) {
        const phase = (t * 0.5 + i * 0.33) % 1;
        const r = 18 + phase * 38;
        const a = (1 - phase) * 0.35;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `${color}00`);
        grad.addColorStop(0.55, `${color}${Math.round(a * 255).toString(16).padStart(2, "0")}`);
        grad.addColorStop(1, `${color}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color, reduce]);

  return (
    <canvas
      ref={ref}
      data-testid="empty-bloom"
      style={{ width: 120, height: 120 }}
      className="pointer-events-none"
    />
  );
}

export default function EmptyState({
  variant = "generic",
  title,
  description,
  className,
  action,
}: EmptyStateProps) {
  const preset = PRESETS[variant] ?? PRESETS.generic;
  const Icon = preset.Icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center",
        className,
      )}
      data-testid="empty-state"
      data-empty-variant={variant}
    >
      <div className="relative mb-4 grid h-[120px] w-[120px] place-items-center">
        <AnimatedBloom color={preset.color} />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
          className="absolute inset-0 grid place-items-center"
        >
          <div
            className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-md"
            style={{
              background: `linear-gradient(135deg, ${preset.color} 0%, ${preset.color}cc 100%)`,
            }}
          >
            <Icon className="h-6 w-6" />
          </div>
        </motion.div>
      </div>
      <h2 className="text-base font-semibold text-foreground">
        {title ?? preset.title}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description ?? preset.description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export type { EmptyVariant };
