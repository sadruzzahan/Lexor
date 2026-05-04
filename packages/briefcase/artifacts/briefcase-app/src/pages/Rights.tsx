import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { ExternalLink } from "lucide-react";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

interface RightsFinding {
  rightCategory: string;
  severity: "low" | "medium" | "high";
  factualBasis: string;
  source: { fileName: string; quote: string };
  authority: { label: string; url: string; verifiedQuote: string };
  suggestedRemedy: string;
}

interface RightsArtifactData {
  findings?: RightsFinding[];
}

const TONE: Record<RightsFinding["severity"], string> = {
  high: "border-destructive/60 bg-destructive/5",
  medium: "border-amber-500/40 bg-amber-500/5",
  low: "border-border bg-muted/40",
};

export default function RightsPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "RightsFindings"),
    [data],
  );
  const findings = useMemo<RightsFinding[]>(() => {
    const d = artifact?.data as RightsArtifactData | undefined;
    return d?.findings ?? [];
  }, [artifact]);

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12"
      data-testid="rights-screen"
    >
      <GlassAppBar
        title="Rights Audit"
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
          No rights artifact yet for this case.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run the agent
          </Link>{" "}
          first.
        </p>
      )}

      {!isLoading && artifact && findings.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground" data-testid="empty">
          RightsAuditor ran but no verifiable rights breaches surfaced for this case.
        </p>
      )}

      <section className="mt-2 flex flex-col gap-3" data-testid="rights-list">
        {findings.map((f, i) => (
          <Card
            key={i}
            className={cn("flex flex-col gap-2 p-4", TONE[f.severity])}
            data-testid={`rights-finding-${i}`}
            data-severity={f.severity}
          >
            <header className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{f.rightCategory}</h3>
              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {f.severity}
              </span>
            </header>
            <p className="text-xs text-foreground/80">{f.factualBasis}</p>
            <blockquote className="rounded border bg-background/40 px-2 py-1.5 text-xs">
              <div className="font-medium text-muted-foreground">{f.source.fileName}</div>
              <div className="mt-1 italic">“{f.source.quote}”</div>
            </blockquote>
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs">
              <div className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                Authority{" "}
                <a
                  href={f.authority.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  {f.authority.label}
                  <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="mt-1 italic text-foreground/80">“{f.authority.verifiedQuote}”</div>
            </div>
            <p className="text-xs">
              <span className="font-medium">Suggested remedy: </span>
              {f.suggestedRemedy}
            </p>
          </Card>
        ))}
      </section>
    </main>
  );
}
