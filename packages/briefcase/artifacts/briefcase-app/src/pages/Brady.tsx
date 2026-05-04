import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { CheckCircle2, AlertCircle, HelpCircle, ExternalLink } from "lucide-react";
import { useGetCase, type Artifact } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

interface BradyGap {
  itemId: string;
  label: string;
  status: "missing" | "unknown";
  rationale: string;
  authority: { label: string; url: string; verifiedQuote: string };
}

interface DisclosureArtifactData {
  disclosureIndexDetected?: boolean;
  detectedFromFile?: string | null;
  gaps?: BradyGap[];
  presentItems?: string[];
  checklist?: Array<{ id: string; label: string; authority: string }>;
}

const STATUS_TONE: Record<BradyGap["status"], string> = {
  missing: "border-destructive/60 bg-destructive/5",
  unknown: "border-amber-500/40 bg-amber-500/5",
};

export default function BradyPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { request } = useApi();
  const { data, isLoading } = useGetCase(caseId, { request });

  const artifact = useMemo<Artifact | undefined>(
    () => data?.artifacts.find((a) => a.kind === "DisclosureGaps"),
    [data],
  );
  const payload = (artifact?.data ?? {}) as DisclosureArtifactData;
  const gaps = payload.gaps ?? [];
  const checklist = payload.checklist ?? [];
  const presentIds = new Set(payload.presentItems ?? []);

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12"
      data-testid="brady-screen"
    >
      <GlassAppBar
        title="Brady / Disclosure"
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
          No Brady artifact yet for this case.{" "}
          <Link href={`/case/${caseId}`} className="underline">
            Run the agent
          </Link>{" "}
          first.
        </p>
      )}

      {!isLoading && artifact && (
        <>
          <Card
            className="mb-3 flex items-center justify-between gap-3 p-3 text-xs"
            data-testid="disclosure-status"
          >
            <div>
              <div className="font-semibold">
                {payload.disclosureIndexDetected
                  ? "Disclosure index detected"
                  : "No disclosure index detected"}
              </div>
              <div className="text-muted-foreground">
                {payload.disclosureIndexDetected && payload.detectedFromFile
                  ? `Source: ${payload.detectedFromFile}`
                  : "Every baseline item is flagged unknown until production lands."}
              </div>
            </div>
            <div className="text-right text-muted-foreground">
              {gaps.length} gap{gaps.length === 1 ? "" : "s"} ·{" "}
              {presentIds.size} confirmed
            </div>
          </Card>

          <section className="flex flex-col gap-3" data-testid="brady-gaps">
            {gaps.map((g, i) => (
              <Card
                key={i}
                className={cn("flex flex-col gap-2 p-4", STATUS_TONE[g.status])}
                data-testid={`brady-gap-${i}`}
                data-status={g.status}
              >
                <header className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{g.label}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {g.status === "missing" ? (
                      <AlertCircle className="size-3" />
                    ) : (
                      <HelpCircle className="size-3" />
                    )}
                    {g.status}
                  </span>
                </header>
                <p className="text-xs text-foreground/80">{g.rationale}</p>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    Authority{" "}
                    <a
                      href={g.authority.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 underline"
                    >
                      {g.authority.label}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="mt-1 italic text-foreground/80">“{g.authority.verifiedQuote}”</div>
                </div>
              </Card>
            ))}
          </section>

          {checklist.length > 0 && (
            <section className="mt-6" data-testid="brady-checklist">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Full baseline checklist
              </h2>
              <ul className="flex flex-col gap-1 text-xs">
                {checklist.map((it) => {
                  const present = presentIds.has(it.id);
                  return (
                    <li
                      key={it.id}
                      className="flex items-start gap-2 rounded border bg-background/40 px-2 py-1.5"
                      data-testid={`checklist-item-${it.id}`}
                      data-present={present ? "true" : "false"}
                    >
                      {present ? (
                        <CheckCircle2 className="mt-0.5 size-3 text-emerald-500" />
                      ) : (
                        <HelpCircle className="mt-0.5 size-3 text-muted-foreground" />
                      )}
                      <div>
                        <div className="font-medium">{it.label}</div>
                        <div className="text-muted-foreground">{it.authority}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
