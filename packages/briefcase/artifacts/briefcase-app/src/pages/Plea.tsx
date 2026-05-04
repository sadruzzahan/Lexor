import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { AlertTriangle, ExternalLink, Scale } from "lucide-react";
import { motion } from "framer-motion";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { playSound } from "@/theme/sounds";
import { useEffect, useRef } from "react";

interface MonteCarloResult {
  iterations: number;
  outcomes: Array<{ label: string; probability: number }>;
  sentenceMonths: { mean: number; p10: number; p50: number; p90: number };
  histogram: Array<{ binStart: number; binEnd: number; count: number }>;
  engine: string;
}

interface PleaForecastData {
  charge?: string;
  trial?: MonteCarloResult;
  plea?: MonteCarloResult;
  datasetCitations?: Array<{ label: string; url: string; verifiedQuote: string }>;
  summaryForClient?: string;
  disclaimer?: string;
}

/**
 * Citation chips are stamped per-bar (not as a separate list at the bottom).
 * Every bar carries a small "[n]" footer; clicking the chip opens the
 * verified source. Citations are assigned to bars round-robin on the
 * non-empty bars so each authority is anchored to a real outcome region
 * rather than floating loose. (§G16: every quantitative claim in the UI
 * must have a verifiable source within one click.)
 */
function pickCitationsForBars(
  histogram: MonteCarloResult["histogram"],
  citations: Array<{ label: string; url: string; verifiedQuote: string }>,
): Array<number | null> {
  if (citations.length === 0) return histogram.map(() => null);
  const out: Array<number | null> = histogram.map(() => null);
  let cursor = 0;
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i]!.count === 0) continue;
    out[i] = cursor % citations.length;
    cursor += 1;
  }
  return out;
}

function Histogram({
  histogram,
  citations,
  testId,
  tone,
}: {
  histogram: MonteCarloResult["histogram"];
  citations: Array<{ label: string; url: string; verifiedQuote: string }>;
  testId: string;
  tone: "trial" | "plea";
}) {
  const max = Math.max(1, ...histogram.map((b) => b.count));
  const stamps = pickCitationsForBars(histogram, citations);
  const reduced = useReducedMotion();
  // G20 — Plea Histogram Bloom. Each bar grows from 0 → its real
  // height with an elastic spring, staggered left-to-right so the
  // distribution appears to rise into place. Citation stamps fade in
  // last as a coda. Reduced-motion swaps the spring for a static
  // initial state.
  const lastDelay = histogram.length * 0.025 + 0.4;
  return (
    <div
      className="flex h-28 items-end gap-[2px]"
      data-testid={testId}
      role="img"
      aria-label={`${tone} sentence-month distribution`}
    >
      {histogram.map((b, i) => {
        const stampIdx = stamps[i];
        const cite = stampIdx !== null ? citations[stampIdx] : null;
        const tooltip = cite
          ? `${b.binStart.toFixed(0)}-${b.binEnd.toFixed(0)} mo: ${b.count}\nSource [${stampIdx! + 1}] ${cite.label}: "${cite.verifiedQuote}"`
          : `${b.binStart.toFixed(0)}-${b.binEnd.toFixed(0)} mo: ${b.count}`;
        const targetHeight = `${(b.count / max) * 100}%`;
        return (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <motion.div
              className={
                tone === "trial"
                  ? "w-full origin-bottom rounded-sm bg-destructive/70"
                  : "w-full origin-bottom rounded-sm bg-emerald-500/70"
              }
              initial={
                reduced
                  ? { height: targetHeight, opacity: 1 }
                  : { height: 0, opacity: 0.6 }
              }
              animate={{ height: targetHeight, opacity: 1 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      type: "spring",
                      stiffness: 220,
                      damping: 14,
                      mass: 0.7,
                      delay: i * 0.025,
                    }
              }
              title={tooltip}
              data-testid={`${testId}-bar-${i}`}
              data-citation-index={stampIdx ?? ""}
            />
            {cite ? (
              <motion.a
                href={cite.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[9px] text-muted-foreground underline-offset-2 hover:underline"
                title={`[${stampIdx! + 1}] ${cite.label}`}
                data-testid={`${testId}-stamp-${i}`}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : lastDelay, duration: 0.3 }}
              >
                [{stampIdx! + 1}]
              </motion.a>
            ) : (
              <span className="h-[10px]" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScenarioCard({
  title,
  result,
  citations,
  tone,
  testId,
}: {
  title: string;
  result: MonteCarloResult;
  citations: Array<{ label: string; url: string; verifiedQuote: string }>;
  tone: "trial" | "plea";
  testId: string;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid={testId}>
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {result.iterations.toLocaleString()} iters · {result.engine}
        </span>
      </header>
      <Histogram
        histogram={result.histogram}
        citations={citations}
        testId={`${testId}-hist`}
        tone={tone}
      />
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Mean
          </div>
          <div className="font-mono">{result.sentenceMonths.mean} mo</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            P10
          </div>
          <div className="font-mono">{result.sentenceMonths.p10} mo</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            P50
          </div>
          <div className="font-mono">{result.sentenceMonths.p50} mo</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            P90
          </div>
          <div className="font-mono">{result.sentenceMonths.p90} mo</div>
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {result.outcomes.map((o, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate">{o.label}</span>
            <span className="font-mono text-muted-foreground">
              {(o.probability * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function PleaPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "PleaForecast"),
    [data],
  );
  const payload = (artifact?.data ?? {}) as PleaForecastData;

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12"
      data-testid="plea-screen"
    >
      <GlassAppBar
        title="Plea vs Trial Forecast"
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
          No plea forecast yet.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run it from the case dashboard
          </Link>
          .
        </p>
      )}

      {!isLoading && artifact && (
        <>
          {payload.disclaimer && (
            <Card
              className="mb-3 flex items-start gap-2 border-amber-500/50 bg-amber-500/10 p-3 text-xs"
              data-testid="plea-disclaimer"
            >
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <span>{payload.disclaimer}</span>
            </Card>
          )}

          <Card className="mb-3 flex items-start gap-2 p-3 text-sm" data-testid="plea-summary">
            <Scale className="mt-0.5 size-4 text-primary" />
            <div>
              {payload.charge && (
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Charge: {payload.charge}
                </div>
              )}
              <p>{payload.summaryForClient}</p>
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="plea-grid">
            {payload.trial && (
              <ScenarioCard
                title="Trial"
                result={payload.trial}
                citations={payload.datasetCitations ?? []}
                tone="trial"
                testId="trial-card"
              />
            )}
            {payload.plea && (
              <ScenarioCard
                title="Plea"
                result={payload.plea}
                citations={payload.datasetCitations ?? []}
                tone="plea"
                testId="plea-card"
              />
            )}
          </section>

          {(payload.datasetCitations?.length ?? 0) > 0 && (
            <section className="mt-4" data-testid="plea-citations">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cited datasets — referenced by [n] above each bar
              </h2>
              <ol className="flex flex-col gap-2">
                {payload.datasetCitations!.map((c, i) => (
                  <li
                    key={i}
                    className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs"
                    id={`cite-${i + 1}`}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        [{i + 1}]
                      </span>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium underline"
                      >
                        {c.label}
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <div className="mt-1 italic text-foreground/80">
                      “{c.verifiedQuote}”
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}
