import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlainEnglish } from "./PlainEnglishProvider";
import { cn } from "@/lib/utils";

interface TermProps {
  /** The legal jargon term as written. Looked up case-insensitively. */
  term: string;
  /** Optional override for the plain-language label. */
  plain?: string;
  className?: string;
}

/**
 * G19 / B4 — Plain English chip.
 *
 * - When the toggle is OFF: renders the term with a dotted underline and a
 *   tooltip showing the everyday-words definition.
 * - When the toggle is ON: renders the plain-English version inline, with
 *   the original term as the tooltip.
 */
export function Term({ term, plain, className }: TermProps) {
  const { enabled, lookup } = usePlainEnglish();
  const entry = lookup(term);
  const plainText = plain ?? entry?.plain ?? term;
  const definition = entry?.definition ?? "";

  const display = enabled ? plainText : term;
  const tooltip = enabled ? `Legal term: ${term}` : definition || plainText;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={`term-${term.toLowerCase().replace(/\s+/g, "-")}`}
          data-plain-english={enabled ? "on" : "off"}
          className={cn(
            "cursor-help underline decoration-dotted decoration-violet-400/60 underline-offset-4",
            className,
          )}
        >
          {display}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
