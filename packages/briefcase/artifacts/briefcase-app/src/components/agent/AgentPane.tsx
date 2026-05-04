import { motion } from "framer-motion";
import { Link } from "wouter";
import { CheckCircle2, AlertCircle, Sparkles, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { PaneState } from "@/stores/agentRunStore";
import { Halo } from "./Halo";
import { ToolCallChip } from "./ToolCallChip";
import { ReasoningStream } from "./ReasoningStream";
import { Term } from "@/components/plain-english/Term";
import { ConfidenceLabel } from "@/components/ConfidenceLabel";

/**
 * G19 — `title` and `hint` may include glossary keys, which the
 * `<Term>` chip will rewrite to plain English when the toggle is on.
 */
const PANE_LABELS: Record<number, { title: string; hint: string }> = {
  0: { title: "Timeline", hint: "Building case timeline…" },
  1: { title: "Evidence Gaps", hint: "Auditing evidence — flags hearsay and chain of custody issues." },
  2: { title: "Cross-Examination", hint: "Drafting cross-examination prompts…" },
  3: { title: "Precedents", hint: "Finding precedents for the suppression motion." },
  4: { title: "Contradictions", hint: "Aligning timestamps…" },
  5: { title: "Rights Audit", hint: "Checking rights breaches…" },
  6: { title: "Brady / Disclosure", hint: "Diffing disclosure index…" },
};

interface AgentPaneProps {
  pane: PaneState;
  delay: number;
  caseId?: string;
}

/**
 * Pane → detail-screen route slug. Subagents not in this map have no
 * dedicated detail screen yet (Timeline / EvidenceGaps / etc. — those
 * surface inline). The pane only renders the open-detail affordance
 * once the subagent has actually completed.
 */
const DETAIL_ROUTE: Record<string, string> = {
  ContradictionEngine: "contradictions",
  RightsAuditor: "rights",
  BradyDetector: "brady",
  MockJurySimulator: "jury",
  PleaOutcomeSimulator: "plea",
  ProsecutionSimulator: "adversarial",
};

/** G19 / B4 — split a string and wrap any glossary terms in <Term>. */
function withGlossary(text: string): React.ReactNode {
  const TERMS = [
    "suppression motion",
    "Brady material",
    "voir dire",
    "cross-examination",
    "direct examination",
    "hearsay",
    "chain of custody",
    "Miranda rights",
    "probable cause",
    "Fourth Amendment",
    "Fifth Amendment",
    "Sixth Amendment",
    "discovery",
    "subpoena",
    "indictment",
    "deposition",
    "objection",
  ];
  // Build one regex with all terms (case-insensitive).
  const escaped = TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    out.push(<Term key={`t-${key++}`} term={match[1]} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length === 0 ? text : out;
}

function summarizeArtifact(data: Record<string, unknown> | null): string | null {
  if (!data) return null;

  for (const k of [
    "summary",
    "headline",
    "title",
    "text",
    "verdict",
    "conclusion",
  ]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  for (const k of ["events", "gaps", "questions", "precedents", "items", "results"]) {
    const v = data[k];
    if (Array.isArray(v)) return `${v.length} ${k}`;
  }
  const keys = Object.keys(data);
  return keys.length ? `${keys.length} fields` : null;
}

/** G19 / B9 — fish a numeric confidence out of common artifact shapes. */
function readConfidence(data: Record<string, unknown> | null): number | null {
  if (!data) return null;
  const candidates = ["confidence", "score", "certainty"];
  for (const k of candidates) {
    const v = data[k];
    if (typeof v === "number" && v >= 0 && v <= 1) return v;
  }
  return null;
}

export function AgentPane({ pane, delay, caseId }: AgentPaneProps) {
  const label = PANE_LABELS[pane.pane] ?? {
    title: `Pane ${pane.pane + 1}`,
    hint: "",
  };
  const artifactSummary = summarizeArtifact(pane.artifact);
  const confidence =
    readConfidence(pane.artifact) ?? readConfidence(pane.partial);
  const detailSlug = pane.subagent ? DETAIL_ROUTE[pane.subagent] : undefined;
  const detailHref =
    caseId && detailSlug && pane.status === "completed"
      ? `/case/${caseId}/${detailSlug}`
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 220, damping: 26 }}
      className="relative"
      data-testid={`agent-pane-${pane.pane}`}
      data-status={pane.status}
    >
      <Halo status={pane.status} />
      <Card
        className={cn(
          "relative flex h-full min-h-[18rem] flex-col gap-3 overflow-hidden p-4",
          pane.status === "completed" && "border-emerald-500/40",
          pane.status === "error" && "border-destructive/60",
        )}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              {pane.subagent ?? label.title}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {pane.status === "active"
                ? withGlossary(label.hint)
                : pane.status === "completed"
                  ? "Completed"
                  : pane.status === "error"
                    ? pane.errorMessage ?? "Error"
                    : "Waiting…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {confidence !== null && <ConfidenceLabel value={confidence} />}
            {pane.status === "active" && <Spinner className="text-primary" />}
            {pane.status === "completed" && (
              <CheckCircle2 className="size-4 text-emerald-500" />
            )}
            {pane.status === "error" && (
              <AlertCircle className="size-4 text-destructive" />
            )}
            {pane.status === "idle" && (
              <Sparkles className="size-4 text-muted-foreground" />
            )}
          </div>
        </header>

        {pane.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1">
            {pane.toolCalls.map((c, i) => (
              <ToolCallChip key={i} call={c} index={i} />
            ))}
          </div>
        )}

        {pane.reasoning.length > 0 && (
          <ReasoningStream lines={pane.reasoning} />
        )}

        {artifactSummary && (
          <div
            className="mt-auto rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs"
            data-testid={`pane-artifact-${pane.pane}`}
          >
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Result:{" "}
            </span>
            <span className="text-foreground/90">
              {withGlossary(artifactSummary)}
            </span>
          </div>
        )}

        {detailHref && (
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1 self-start rounded-md border px-2 py-1 text-[11px] font-medium text-foreground/80 hover:bg-accent"
            data-testid={`pane-detail-link-${pane.pane}`}
          >
            View details
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </Card>
    </motion.div>
  );
}
