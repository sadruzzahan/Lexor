import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * G19 / B9 — Plain-language confidence.
 *
 * Numeric confidence renders as a label:
 *   ≥ 0.85 → "Pretty sure"      (brand violet)
 *   ≥ 0.60 → "Likely"           (neutral)
 *   <  0.6 → "Worth checking"   (warm/amber)
 *
 * Long-press / right-click reveals the underlying numeric value via tooltip.
 */

export type ConfidenceTier = "pretty-sure" | "likely" | "worth-checking";

export function tierFor(value: number): ConfidenceTier {
  if (value >= 0.85) return "pretty-sure";
  if (value >= 0.6) return "likely";
  return "worth-checking";
}

const LABELS: Record<ConfidenceTier, string> = {
  "pretty-sure": "Pretty sure",
  likely: "Likely",
  "worth-checking": "Worth checking",
};

const STYLES: Record<ConfidenceTier, string> = {
  "pretty-sure":
    "border-[hsl(var(--violet)/0.45)] bg-[hsl(var(--violet)/0.12)] text-[hsl(var(--violet))]",
  likely:
    "border-foreground/15 bg-foreground/5 text-foreground/80",
  "worth-checking":
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

interface ConfidenceLabelProps {
  /** 0.0 – 1.0 */
  value: number;
  className?: string;
  /** Hide the prefix label (e.g. when used in dense tables). */
  compact?: boolean;
}

export function ConfidenceLabel({
  value,
  className,
  compact,
}: ConfidenceLabelProps) {
  const [revealed, setRevealed] = useState(false);
  const tier = tierFor(value);
  const label = LABELS[tier];
  const pct = Math.round(value * 100);

  // Long-press to reveal numeric (mobile + accessible). Touch + mouse paths.
  let pressTimer: number | undefined;
  const startPress = () => {
    pressTimer = window.setTimeout(() => setRevealed(true), 380);
  };
  const endPress = () => {
    clearTimeout(pressTimer);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="confidence-label"
          data-confidence-tier={tier}
          data-confidence-value={value.toFixed(2)}
          onMouseDown={startPress}
          onMouseUp={endPress}
          onMouseLeave={endPress}
          onTouchStart={startPress}
          onTouchEnd={endPress}
          onContextMenu={(e) => {
            e.preventDefault();
            setRevealed(true);
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STYLES[tier],
            className,
          )}
        >
          {!compact && <span>{label}</span>}
          {revealed && (
            <span
              data-testid="confidence-numeric"
              className="font-mono text-[10px] opacity-80"
            >
              {pct}%
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label} · {pct}% confidence
      </TooltipContent>
    </Tooltip>
  );
}
