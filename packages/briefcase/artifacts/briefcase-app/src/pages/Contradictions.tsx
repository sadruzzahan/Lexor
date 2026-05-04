import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface TypedContradiction {
  claim: string;
  type: "timestamp" | "identity" | "sequence" | "fact";
  severity: "low" | "medium" | "high";
  sourceA: { fileName: string; quote: string };
  sourceB: { fileName: string; quote: string };
  explanation: string;
  anchor: { tsA: string; tsB: string; deltaSeconds: number } | null;
}

interface ContradictionsArtifactData {
  contradictions?: TypedContradiction[];
}

const SEVERITY_TONE: Record<TypedContradiction["severity"], string> = {
  high: "border-destructive/60 bg-destructive/5",
  medium: "border-amber-500/40 bg-amber-500/5",
  low: "border-border bg-muted/40",
};

function fmtDelta(seconds: number): string {
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${seconds < 0 ? "−" : "+"}${m}m ${s}s`;
}

export default function ContradictionsPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "Contradictions"),
    [data],
  );
  const items = useMemo<TypedContradiction[]>(() => {
    const d = artifact?.data as ContradictionsArtifactData | undefined;
    return d?.contradictions ?? [];
  }, [artifact]);
  const reduced = useReducedMotion();

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12"
      data-testid="contradictions-screen"
    >
      <GlassAppBar
        title="Contradictions"
        subtitle={data?.case.title ?? "Case"}
        backHref={`/case/${caseId}`}
        backLabel="Back to case"
      />

      {isLoading && (
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner />
        </div>
      )}

      {!isLoading && !artifact && (
        <p className="mt-8 text-sm text-muted-foreground" data-testid="empty">
          No contradictions artifact yet for this case.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run the agent
          </Link>{" "}
          first.
        </p>
      )}

      {!isLoading && artifact && items.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground" data-testid="empty">
          ContradictionEngine ran but did not surface any typed contradictions.
        </p>
      )}

      <section className="mt-2 flex flex-col gap-3" data-testid="contradiction-list">
        {items.map((c, i) => {
          // G20 — Contradiction Reveal. Each item enters with a soft
          // upward fade; high-severity items get a side-by-side
          // slide-in for source A and source B, joined by an animated
          // red SVG seam that strokes in to make the conflict visible
          // at a glance. Reduced-motion degrades to a static layout.
          const high = c.severity === "high";
          const baseDelay = i * 0.05;
          return (
            <motion.div
              key={i}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : baseDelay, duration: 0.35 }}
            >
              <Card
                className={cn(
                  "relative flex flex-col gap-2 p-4",
                  SEVERITY_TONE[c.severity],
                )}
                data-testid={`contradiction-${i}`}
                data-severity={c.severity}
                data-type={c.type}
              >
                <header className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{c.claim}</h3>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="rounded-full border px-2 py-0.5">{c.type}</span>
                    <span className="rounded-full border px-2 py-0.5">{c.severity}</span>
                    {c.anchor && (
                      <span className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-primary">
                        Δ {fmtDelta(c.anchor.deltaSeconds)}
                      </span>
                    )}
                  </div>
                </header>
                <p className="text-xs text-foreground/80">{c.explanation}</p>
                <div className="relative grid gap-2 md:grid-cols-2">
                  <motion.blockquote
                    initial={
                      reduced || !high ? false : { opacity: 0, x: -16 }
                    }
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: reduced ? 0 : baseDelay + 0.1,
                      duration: 0.4,
                    }}
                    className="rounded border bg-background/40 px-2 py-1.5 text-xs"
                  >
                    <div className="font-medium text-muted-foreground">
                      {c.sourceA.fileName}
                    </div>
                    <div className="mt-1 italic">“{c.sourceA.quote}”</div>
                  </motion.blockquote>
                  <motion.blockquote
                    initial={
                      reduced || !high ? false : { opacity: 0, x: 16 }
                    }
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: reduced ? 0 : baseDelay + 0.1,
                      duration: 0.4,
                    }}
                    className="rounded border bg-background/40 px-2 py-1.5 text-xs"
                  >
                    <div className="font-medium text-muted-foreground">
                      {c.sourceB.fileName}
                    </div>
                    <div className="mt-1 italic">“{c.sourceB.quote}”</div>
                  </motion.blockquote>
                  {high && !reduced && (
                    <svg
                      aria-hidden
                      className="pointer-events-none absolute inset-0 hidden md:block"
                      preserveAspectRatio="none"
                      viewBox="0 0 100 20"
                      data-testid={`contradiction-${i}-seam`}
                    >
                      <motion.line
                        x1="48"
                        y1="0"
                        x2="52"
                        y2="20"
                        stroke="hsl(0 80% 60%)"
                        strokeWidth="0.6"
                        strokeLinecap="round"
                        strokeDasharray="2 1.2"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 0.85 }}
                        transition={{
                          delay: baseDelay + 0.35,
                          duration: 0.5,
                          ease: "easeOut",
                        }}
                      />
                    </svg>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </section>
    </main>
  );
}
