import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { Users, Gavel, AlertTriangle } from "lucide-react";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { VerdictRibbon } from "@/components/signature/VerdictRibbon";

interface JurorEntry {
  persona: {
    id: string;
    displayName: string;
    ageBand: string;
    occupationFamily: string;
    livedExperienceAnchor: string;
    priorTrustInSystem: string;
    decisionStyle: string;
    disclaimerLabel: string;
  };
  initialLean: "acquit" | "convict" | "undecided";
  confidence: number;
  keyConcern: string;
  reactionToDefense: string;
  reactionToProsecution: string;
}

interface JurySimulationData {
  venue?: string;
  jurors?: JurorEntry[];
  deliberation?: {
    finalVerdict: "acquit" | "convict" | "hung";
    rationale: string;
    keyTurningPoints: string[];
    defenseStrengths: string[];
    defenseWeaknesses: string[];
  };
  verdictDistribution?: { acquit: number; convict: number; undecided: number };
  disclaimer?: string;
}

const LEAN_TONE: Record<JurorEntry["initialLean"], string> = {
  acquit: "border-emerald-500/40 bg-emerald-500/5",
  convict: "border-destructive/60 bg-destructive/5",
  undecided: "border-amber-500/40 bg-amber-500/5",
};

export default function JuryPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "JurySimulation"),
    [data],
  );
  const payload = (artifact?.data ?? {}) as JurySimulationData;
  const jurors = payload.jurors ?? [];
  const dist = payload.verdictDistribution ?? { acquit: 0, convict: 0, undecided: 0 };
  const total = Math.max(1, dist.acquit + dist.convict + dist.undecided);

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12"
      data-testid="jury-screen"
    >
      <GlassAppBar
        title="Mock Jury"
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
          No mock-jury simulation yet.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run it from the case dashboard
          </Link>
          .
        </p>
      )}

      {!isLoading && artifact && payload.deliberation && (
        <VerdictRibbon
          caseId={caseId}
          verdict={payload.deliberation.finalVerdict}
          distribution={dist}
        />
      )}

      {!isLoading && artifact && (
        <>
          {payload.disclaimer && (
            <Card
              className="mb-3 flex items-start gap-2 border-amber-500/40 bg-amber-500/5 p-3 text-xs"
              data-testid="jury-disclaimer"
            >
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <span>{payload.disclaimer}</span>
            </Card>
          )}

          <Card className="mb-3 flex flex-col gap-2 p-4" data-testid="verdict-distribution">
            <header className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
              <span>Initial verdict distribution</span>
              {payload.venue && <span>Venue: {payload.venue}</span>}
            </header>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="bg-emerald-500"
                style={{ width: `${(dist.acquit / total) * 100}%` }}
                data-testid="bar-acquit"
              />
              <div
                className="bg-amber-500"
                style={{ width: `${(dist.undecided / total) * 100}%` }}
                data-testid="bar-undecided"
              />
              <div
                className="bg-destructive"
                style={{ width: `${(dist.convict / total) * 100}%` }}
                data-testid="bar-convict"
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Acquit · {dist.acquit}</span>
              <span>Undecided · {dist.undecided}</span>
              <span>Convict · {dist.convict}</span>
            </div>
          </Card>

          {payload.deliberation && (
            <Card className="mb-4 flex flex-col gap-3 p-4" data-testid="deliberation">
              <header className="flex items-center gap-2">
                <Gavel className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  Deliberated verdict: {payload.deliberation.finalVerdict}
                </h2>
              </header>
              <p className="text-xs text-foreground/85">
                {payload.deliberation.rationale}
              </p>
              {payload.deliberation.keyTurningPoints.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Key turning points
                  </div>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {payload.deliberation.keyTurningPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    Defense strengths
                  </div>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {payload.deliberation.defenseStrengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-destructive">
                    Defense weaknesses
                  </div>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {payload.deliberation.defenseWeaknesses.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5" /> Jurors
          </h2>
          <section
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="juror-grid"
          >
            {jurors.map((j, i) => (
              <Card
                key={j.persona.id}
                className={`flex flex-col gap-2 p-3 ${LEAN_TONE[j.initialLean]}`}
                data-testid={`juror-${i}`}
                data-lean={j.initialLean}
              >
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{j.persona.displayName}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {j.persona.ageBand} · {j.persona.occupationFamily} · {j.persona.decisionStyle}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    {j.initialLean}
                    <div className="font-mono">{j.confidence.toFixed(2)}</div>
                  </div>
                </header>
                <p className="text-[11px] italic text-foreground/70">
                  {j.persona.livedExperienceAnchor}
                </p>
                <p className="text-xs">
                  <span className="font-medium">Concern:</span> {j.keyConcern}
                </p>
                <div className="text-[11px] text-muted-foreground">
                  Defense: {j.reactionToDefense}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Prosecution: {j.reactionToProsecution}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {j.persona.disclaimerLabel}
                </div>
              </Card>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
