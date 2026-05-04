import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { Swords, ExternalLink, Shield, Gavel } from "lucide-react";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";

interface AdversarialData {
  directExamOutline?: Array<{
    witness: string;
    topic: string;
    pivotalQuestion: string;
    expectedAnswer: string;
  }>;
  anticipatedArguments?: Array<{
    thesis: string;
    evidence: string;
    rebuttalForDefense: string;
  }>;
  weaknessReport?: Array<{
    weakness: string;
    recordAnchor: string;
    sourceFileName: string;
    citedAuthority: { label: string; url: string; verifiedQuote: string } | null;
    defenseCounter: string;
  }>;
}

/**
 * Sparring "transcript" — a paired view that puts every prosecution beat
 * directly opposite the defense's counter, so the lawyer can rehearse the
 * exchange line-by-line. Three sections (weaknesses, anticipated arguments,
 * direct exam) are normalized into the same left/right shape.
 */
type Exchange = {
  kind: "weakness" | "argument" | "direct";
  prosecution: { headline: string; body: React.ReactNode };
  defense: { headline: string; body: React.ReactNode };
};

function buildTranscript(payload: AdversarialData): Exchange[] {
  const out: Exchange[] = [];

  for (const w of payload.weaknessReport ?? []) {
    out.push({
      kind: "weakness",
      prosecution: {
        headline: w.weakness,
        body: (
          <>
            <div className="rounded border bg-background/40 px-2 py-1.5 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Record anchor · {w.sourceFileName}
              </div>
              <div className="mt-1 italic">“{w.recordAnchor}”</div>
            </div>
            {w.citedAuthority ? (
              <a
                href={w.citedAuthority.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline"
              >
                {w.citedAuthority.label}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <div className="mt-2 text-[11px] italic text-muted-foreground">
                No verified authority on point.
              </div>
            )}
          </>
        ),
      },
      defense: {
        headline: "Counter",
        body: <p>{w.defenseCounter}</p>,
      },
    });
  }

  for (const a of payload.anticipatedArguments ?? []) {
    out.push({
      kind: "argument",
      prosecution: {
        headline: a.thesis,
        body: <p className="text-xs">{a.evidence}</p>,
      },
      defense: {
        headline: "Rebuttal",
        body: <p className="text-xs">{a.rebuttalForDefense}</p>,
      },
    });
  }

  for (const d of payload.directExamOutline ?? []) {
    out.push({
      kind: "direct",
      prosecution: {
        headline: `Direct: ${d.witness}`,
        body: (
          <div className="text-xs">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.topic}
            </div>
            <div className="mt-1">
              <span className="font-medium">Q:</span> {d.pivotalQuestion}
            </div>
          </div>
        ),
      },
      defense: {
        headline: "Expected answer & cross",
        body: (
          <p className="text-xs">
            <span className="font-medium">A:</span> {d.expectedAnswer}
          </p>
        ),
      },
    });
  }

  return out;
}

const KIND_LABEL: Record<Exchange["kind"], string> = {
  weakness: "Weakness",
  argument: "Argument",
  direct: "Direct examination",
};

export default function AdversarialPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "Adversarial"),
    [data],
  );
  const payload = (artifact?.data ?? {}) as AdversarialData;
  const transcript = useMemo(() => buildTranscript(payload), [payload]);

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-12"
      data-testid="adversarial-screen"
    >
      <GlassAppBar
        title="Prosecution Sparring"
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
          No prosecution sparring yet.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run it from the case dashboard
          </Link>
          .
        </p>
      )}

      {!isLoading && artifact && (
        <>
          {/* Two-column header so the eye locks onto Prosecution vs Defense
              before reading any one exchange. */}
          <div
            className="sticky top-16 z-10 mb-3 grid grid-cols-2 gap-3 rounded-lg border bg-background/80 px-3 py-2 backdrop-blur"
            data-testid="transcript-header"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
              <Gavel className="size-3.5" /> Prosecution
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              <Shield className="size-3.5" /> Defense
            </div>
          </div>

          <ol className="flex flex-col gap-2" data-testid="transcript">
            {transcript.map((ex, i) => (
              <li
                key={i}
                className="grid grid-cols-2 gap-3"
                data-testid={`exchange-${i}`}
                data-kind={ex.kind}
              >
                <Card
                  className="flex flex-col gap-2 border-destructive/40 bg-destructive/5 p-3"
                  data-testid={`exchange-${i}-prosecution`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[ex.kind]} · #{i + 1}
                    </span>
                    <Swords className="size-3 text-destructive/70" />
                  </div>
                  <h3 className="text-sm font-semibold">{ex.prosecution.headline}</h3>
                  <div className="text-xs">{ex.prosecution.body}</div>
                </Card>
                <Card
                  className="flex flex-col gap-2 border-emerald-500/40 bg-emerald-500/5 p-3"
                  data-testid={`exchange-${i}-defense`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Response · #{i + 1}
                    </span>
                    <Shield className="size-3 text-emerald-600/70" />
                  </div>
                  <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    {ex.defense.headline}
                  </h3>
                  <div className="text-xs">{ex.defense.body}</div>
                </Card>
              </li>
            ))}
            {transcript.length === 0 && (
              <li className="text-xs italic text-muted-foreground">
                The simulator returned no sparring exchanges for this case.
              </li>
            )}
          </ol>
        </>
      )}
    </main>
  );
}
