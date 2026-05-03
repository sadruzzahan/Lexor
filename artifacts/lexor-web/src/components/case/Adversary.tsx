import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Scale,
  Gavel,
  AlertOctagon,
  Users2,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
  Plus,
  Check,
  ExternalLink,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { getAdversary, type AdversaryDossier, type CaseRow } from "@/lib/api";
import { useInjectedDefenses, selectInjectedFor } from "@/lib/defenseInjection";

const KIND_LABEL: Record<string, string> = {
  landlord: "Landlord",
  employer: "Employer",
  debt_collector: "Debt collector",
  unknown: "Opposing party",
};

export function Adversary({ row }: { row: CaseRow }) {
  const [dossier, setDossier] = useState<AdversaryDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row.adversaryEntityId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getAdversary(row.adversaryEntityId)
      .then((d) => alive && setDossier(d))
      .catch((e: unknown) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [row.adversaryEntityId]);

  if (!row.adversaryEntityId) {
    return (
      <EmptyState
        title="We couldn't identify the opposing party"
        body="The opposing party's name wasn't extractable from this letter. The Defense and Counter-attack tabs still work."
      />
    );
  }
  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-fg-muted">
        <Loader2 className="animate-spin size-5 mr-2" /> Pulling their record…
      </div>
    );
  }
  if (error || !dossier) {
    return (
      <EmptyState
        title="Couldn't load the dossier"
        body={error ?? "Try again in a moment."}
      />
    );
  }

  return <DossierView caseId={row.id} dossier={dossier} />;
}

export function DossierView({
  caseId,
  dossier,
  hideUseDefense = false,
}: {
  caseId?: string;
  dossier: AdversaryDossier;
  hideUseDefense?: boolean;
}) {
  const stats = dossier.litigationStats;
  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg2 border border-border-strong bg-bg-elevated p-6"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-accent/10 border border-accent/30 p-3 shrink-0">
            <Building2 className="size-6 text-accent" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-fg-subtle">
              {KIND_LABEL[dossier.kind] ?? "Opposing party"}
              {dossier.source === "curated" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                  <ShieldCheck className="size-3" /> Verified record
                </span>
              )}
              {dossier.source === "empty" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-border-strong bg-bg-raised px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                  <Info className="size-3" /> No public record
                </span>
              )}
            </div>
            <h2 className="font-display text-2xl md:text-3xl mt-1 tracking-tight text-fg">
              {dossier.displayName}
            </h2>
            {dossier.jurisdictions.length > 0 && (
              <div className="mt-1 text-xs text-fg-muted">
                Operates in: {dossier.jurisdictions.join(" · ")}
              </div>
            )}
            <p className="mt-3 text-sm text-fg-muted">{dossier.sourceNote}</p>
            {!hideUseDefense && (
              <Link
                href={`/entity/${dossier.entityId}`}
                className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline underline-offset-4"
              >
                Open full dossier
                <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        </div>
      </motion.header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1 rounded-lg2 border border-border-strong bg-bg-elevated p-5 flex items-center gap-4">
          <WinRateRing pct={stats.winRatePctAsDefendant} />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-fg-subtle">
              Their win rate (when sued)
            </div>
            <div className="text-[11px] text-fg-muted mt-1">
              Lower means more wins for plaintiffs like you. Out of{" "}
              {stats.asDefendant.toLocaleString()} suits where they were the
              defendant.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <Stat
            label="Total cases"
            value={stats.totalCases.toLocaleString()}
            icon={Scale}
          />
          <Stat
            label="As plaintiff"
            value={stats.asPlaintiff.toLocaleString()}
            sub={`${stats.asDefendant.toLocaleString()} as defendant`}
            icon={Gavel}
          />
          <Stat
            label="Sanctions on record"
            value={stats.sanctions.length.toString()}
            icon={AlertOctagon}
            tone={stats.sanctions.length > 0 ? "violation" : "neutral"}
          />
          <Stat
            label="Defenses that worked"
            value={dossier.defensesThatWorked.length.toString()}
            sub="proven against this opponent"
            icon={ShieldCheck}
            tone="accent"
          />
        </div>
      </section>

      {stats.sanctions.length > 0 && (
        <section className="rounded-lg2 border border-violation/30 bg-violation/5 p-5">
          <div className="text-xs uppercase tracking-wider text-violation flex items-center gap-2">
            <AlertOctagon className="size-3.5" /> Regulator actions
          </div>
          <ul className="mt-3 space-y-3">
            {stats.sanctions.map((s, i) => (
              <li
                key={i}
                className="rounded-base bg-bg-raised border border-border p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-medium text-fg">
                    {s.year} · {s.agency}
                  </div>
                  {typeof s.amountUsd === "number" && (
                    <div className="text-sm text-violation tabular-nums">
                      ${(s.amountUsd / 1_000_000).toFixed(1)}M
                    </div>
                  )}
                </div>
                <p className="mt-1 text-sm text-fg-muted">{s.summary}</p>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    Source <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.commonViolations.length > 0 && (
        <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">
            Their most common violations
          </div>
          <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {stats.commonViolations.map((v, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-fg-muted"
              >
                <span className="mt-1.5 size-1 rounded-full bg-violation shrink-0" />
                {v}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dossier.defensesThatWorked.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-display text-xl text-fg">
              Defenses that have beaten them
            </h3>
            <span className="text-xs text-fg-subtle">
              Tap to add to your response letter
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dossier.defensesThatWorked.map((d) => (
              <DefenseCard
                key={d.id}
                caseId={hideUseDefense ? undefined : caseId}
                entityId={dossier.entityId}
                entityName={dossier.displayName}
                defense={d}
              />
            ))}
          </div>
        </section>
      )}

      {dossier.timeline.length > 0 && (
        <HorizontalTimeline events={dossier.timeline} />
      )}

      {dossier.alternateNames.length > 0 && (
        <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">
            Linked names (shell-LLC overlap)
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {dossier.alternateNames.map((n) => (
              <span
                key={n}
                className="inline-flex items-center rounded-full border border-border bg-bg-raised px-2.5 py-1 text-xs text-fg-muted"
              >
                {n}
              </span>
            ))}
          </div>
        </section>
      )}

      {dossier.otherCases.length > 1 && (
        <section className="rounded-lg2 border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
            <Users2 className="size-3.5" /> Other people fighting them
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            {dossier.otherCases.length} other Lexor users have uploaded a
            letter from this entity. A coalition forms automatically once
            5+ cases hit the same adversary — you're stronger together.
          </p>
          <ul className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {dossier.otherCases.map((c, i) => (
              <li
                key={`${c.createdAt}-${i}`}
                className="rounded-base border border-border bg-bg-raised px-3 py-2 text-xs text-fg-muted"
              >
                <div className="capitalize text-fg">{c.vertical}</div>
                <div>
                  {c.jurisdiction ?? "—"}
                  {" · "}
                  {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/coalition/${dossier.entityId}`}
              className="inline-flex items-center gap-2 rounded-base bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 transition"
            >
              <Users2 className="size-4" />
              Form a coalition
              <ArrowUpRight className="size-3.5" />
            </Link>
            <span className="text-xs text-fg-subtle">
              {dossier.otherCases.length >= 5
                ? "Threshold reached — coordinate joint action."
                : `${5 - dossier.otherCases.length} more cases until automatic activation.`}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function WinRateRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const r = 32;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  // Lower win rate = better for plaintiff. Color shifts accent → violation.
  const tone = clamped <= 40 ? "stroke-accent" : clamped <= 70 ? "stroke-fg-muted" : "stroke-violation";
  return (
    <div className="relative shrink-0" aria-label={`Win rate ${clamped} percent`}>
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle
          cx="42"
          cy="42"
          r={r}
          strokeWidth="8"
          fill="none"
          className="stroke-border"
        />
        <motion.circle
          cx="42"
          cy="42"
          r={r}
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          className={tone}
          strokeDasharray={`${dash} ${c}`}
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${dash} ${c}` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-lg font-display tabular-nums text-fg">
          {clamped}%
        </div>
      </div>
    </div>
  );
}

function HorizontalTimeline({
  events,
}: {
  events: AdversaryDossier["timeline"];
}) {
  return (
    <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
      <div className="text-xs uppercase tracking-wider text-fg-subtle mb-4">
        Major filings against them
      </div>
      <div className="relative overflow-x-auto">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[34px] h-px bg-border"
        />
        <ol className="relative flex gap-6 pb-2 min-w-max">
          {events.map((t, i) => (
            <li key={i} className="relative w-44 shrink-0 pt-9">
              <span
                aria-hidden
                className={`absolute left-1/2 -translate-x-1/2 top-[28px] size-3 rounded-full border-2 border-bg-elevated ${
                  t.kind === "sanction" || t.kind === "consent_order"
                    ? "bg-violation"
                    : "bg-accent"
                }`}
              />
              <div className="text-xs text-fg-subtle tabular-nums text-center">
                {t.date}
              </div>
              <div className="mt-2 rounded-base border border-border bg-bg-raised p-3 text-xs">
                <div className="text-fg leading-snug">
                  {t.url ? (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline inline-flex items-start gap-1"
                    >
                      {t.label}
                      <ExternalLink className="size-3 mt-0.5 shrink-0" />
                    </a>
                  ) : (
                    t.label
                  )}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                  {t.kind.replace("_", " ")}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DefenseCard({
  caseId,
  entityId,
  entityName,
  defense,
}: {
  caseId?: string;
  entityId: string;
  entityName: string;
  defense: AdversaryDossier["defensesThatWorked"][number];
}) {
  const injected = useInjectedDefenses(selectInjectedFor(caseId));
  const add = useInjectedDefenses((s) => s.add);
  const isAdded = injected.some((d) => d.id === defense.id);

  function handleAdd() {
    if (!caseId) {
      void navigator.clipboard.writeText(defense.bodyParagraph);
      toast.success("Copied to clipboard");
      return;
    }
    add(caseId, {
      id: defense.id,
      title: defense.title,
      citation: defense.citation,
      citationUrl: defense.citationUrl,
      bodyParagraph: defense.bodyParagraph,
      fromEntityId: entityId,
      fromEntityName: entityName,
    });
    toast.success("Added to your response letter", {
      description: "Open the Defense tab to see it appended.",
    });
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg2 border border-border-strong bg-bg-elevated p-4 flex flex-col"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-medium text-fg">{defense.title}</h4>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{defense.summary}</p>
      <div className="mt-3 text-xs text-fg-subtle">
        <a
          href={defense.citationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline inline-flex items-center gap-1"
        >
          {defense.citation}
          <ExternalLink className="size-3" />
        </a>
      </div>
      {defense.successRate && (
        <div className="mt-1 text-[11px] text-fg-subtle italic">
          {defense.successRate}
        </div>
      )}
      <div className="mt-auto pt-3">
        <button
          type="button"
          onClick={handleAdd}
          disabled={isAdded}
          className={
            isAdded
              ? "ghost-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2 text-accent"
              : "shimmer-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
          }
        >
          {isAdded ? (
            <>
              <Check className="size-4" /> Added
            </>
          ) : (
            <>
              <Plus className="size-4" /> {caseId ? "Use this defense" : "Copy"}
            </>
          )}
        </button>
      </div>
    </motion.article>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "accent" | "violation";
}) {
  const ring =
    tone === "violation"
      ? "border-violation/30 bg-violation/5"
      : tone === "accent"
        ? "border-accent/30 bg-accent/5"
        : "border-border-strong bg-bg-elevated";
  const iconColor =
    tone === "violation"
      ? "text-violation"
      : tone === "accent"
        ? "text-accent"
        : "text-fg-muted";
  return (
    <div className={`rounded-lg2 border ${ring} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {label}
        </div>
        <Icon className={`size-3.5 ${iconColor}`} />
      </div>
      <div className="mt-2 font-display text-2xl text-fg tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-fg-subtle">{sub}</div>}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
      <div className="font-display text-xl text-fg">{title}</div>
      <p className="mt-2 text-fg-muted text-sm max-w-md mx-auto">{body}</p>
    </div>
  );
}
