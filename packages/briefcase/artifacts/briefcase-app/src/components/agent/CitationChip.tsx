import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { FileText } from "lucide-react";
import { selection } from "@/lib/haptics";

/** Stable, short, collision-resistant id for a snippet (DJB2). Exported so
 * the source viewer can compute the same key from its `?q=` querystring. */
export function hashSnippet(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface CitationChipProps {
  caseId: string;
  fileId: string;
  label: string;
  page?: number;
  /** Cited text snippet — passed via querystring so the source viewer can
   * locate + highlight the exact span on render. */
  snippet?: string;
}

/**
 * Citation chip: links to the source viewer with a shared `layoutId` so the
 * chip morphs into the viewer's title pill (foundation for the spec's
 * Reanimated shared-element transition; A6/A11). Linear-violet pill per
 * spec §7.1. Selection haptic on tap.
 */
export function CitationChip({
  caseId,
  fileId,
  label,
  page,
  snippet,
}: CitationChipProps) {
  const reduce = useReducedMotion();
  const params = new URLSearchParams();
  if (typeof page === "number") params.set("page", String(page));
  if (snippet) params.set("q", snippet);
  const search = params.toString();
  const href = `/case/${caseId}/source/${fileId}${search ? `?${search}` : ""}`;
  const snippetKey = snippet ? hashSnippet(snippet) : "na";
  const layoutId = `citation-${fileId}-${page ?? "na"}-${snippetKey}`;

  return (
    <Link
      href={href}
      onClick={() => selection()}
      data-testid={`citation-${fileId}`}
    >
      <motion.span
        layout={!reduce}
        layoutId={reduce ? undefined : layoutId}
        className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium hover-elevate"
        style={{
          backgroundColor: "hsl(var(--violet) / 0.12)",
          borderColor: "hsl(var(--violet) / 0.35)",
          color: "hsl(var(--foreground))",
        }}
        whileHover={reduce ? undefined : { scale: 1.03 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
      >
        <FileText className="size-3" style={{ color: "hsl(var(--violet))" }} />
        <span className="truncate">{label}</span>
        {typeof page === "number" && (
          <span className="opacity-70">p.{page}</span>
        )}
      </motion.span>
    </Link>
  );
}
