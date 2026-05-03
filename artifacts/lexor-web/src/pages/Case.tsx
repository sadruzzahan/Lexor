import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import {
  Shield,
  Swords,
  Building2,
  Users2,
  MapPin,
  Gavel,
  Headphones,
  ArrowLeft,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/hooks";
import { getCase, type CaseRow } from "@/lib/api";
import { Defense } from "@/components/case/Defense";
import { CounterAttack } from "@/components/case/CounterAttack";
import { Adversary } from "@/components/case/Adversary";
import { CaseMap } from "@/components/case/CaseMap";
import { CoalitionTab } from "@/components/case/CoalitionTab";
import { MirrorTrial } from "@/components/case/MirrorTrial";
import { HearingCoach } from "@/components/case/HearingCoach";
import { useEventStream } from "@/lib/sse";
import { eventStreamUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const VERTICAL_LABELS = {
  debt: "Debt Collection",
  eviction: "Eviction Notice",
  wage: "Wage Dispute",
  contract: "Contract Dispute",
  other: "Legal letter",
} as const;

const TABS = [
  { id: "defense", label: "Defense", Icon: Shield },
  { id: "counter", label: "Counter-attack", Icon: Swords },
  { id: "adversary", label: "Adversary", Icon: Building2 },
  { id: "coalition", label: "Coalition", Icon: Users2 },
  { id: "trial", label: "Mirror Trial", Icon: Gavel },
  { id: "coach", label: "Coach", Icon: Headphones },
  { id: "map", label: "Map", Icon: MapPin },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function CasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  useDocumentTitle("Case — Lexor");

  const [row, setRow] = useState<CaseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("defense");
  const { isComplete } = useEventStream(caseId ? eventStreamUrl(caseId) : null);

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const r = await getCase(caseId!);
        if (!alive) return;
        setRow(r);
        setLoading(false);
        if (r.status !== "complete" && r.status !== "failed") {
          timer = setTimeout(load, 1500);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [caseId, isComplete]);

  if (!caseId) return null;
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-fg-muted">
        <Loader2 className="animate-spin size-5 mr-2" /> Loading case…
      </div>
    );
  }
  if (!row) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-fg-muted gap-3">
        <div>We couldn't find this case.</div>
        <Link href="/upload" className="text-accent underline-offset-4 hover:underline">
          Start a new one
        </Link>
      </div>
    );
  }

  const isPending = row.status !== "complete" && row.status !== "failed";
  const isFailed = row.status === "failed";

  if (isFailed) {
    return (
      <section className="mx-auto max-w-2xl px-4 md:px-6 py-12">
        <Link
          href="/upload"
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-6"
        >
          <ArrowLeft className="size-3.5" /> New case
        </Link>
        <div className="rounded-xl2 border border-violation/40 bg-violation/5 p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-violation/10 border border-violation/30 p-3 shrink-0">
              <AlertTriangle className="size-6 text-violation" aria-hidden />
            </div>
            <div className="flex-1">
              <h1 className="font-display text-2xl text-fg">
                We couldn't finish reading this letter.
              </h1>
              <p className="mt-2 text-fg-muted text-sm">
                Something went wrong while processing your document. Common
                causes: the image was too blurry to read, the file wasn't a
                supported format, or one of our backing services hiccupped.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/upload"
                  className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium"
                >
                  Try again with a clearer copy
                </Link>
                <a
                  href="mailto:help@lexor.app"
                  className="rounded-base border border-border-strong px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  Email us your letter
                </a>
              </div>
              <div className="mt-5 text-xs text-fg-subtle">
                Case ref: {caseId.slice(0, 8)} · Status: {row.status}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-4 md:px-6 py-8 md:py-12">
      <Link
        href="/upload"
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-6"
      >
        <ArrowLeft className="size-3.5" /> New case
      </Link>

      <header className="mb-8">
        <div className="text-xs uppercase tracking-wider text-fg-subtle">
          Case · {caseId.slice(0, 8)}
        </div>
        <h1 className="font-display text-3xl md:text-4xl tracking-tight mt-1 capitalize">
          {VERTICAL_LABELS[row.vertical as keyof typeof VERTICAL_LABELS] ?? "Legal letter"}
          {row.jurisdiction ? ` · ${row.jurisdiction}` : ""}
        </h1>
        {isPending && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm text-accent">
            <Loader2 className="animate-spin size-4" />
            Pipeline running… ({row.status})
          </div>
        )}
      </header>

      <div
        role="tablist"
        aria-label="Case sections"
        className="flex flex-wrap gap-1 border-b border-border mb-6"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "relative inline-flex items-center gap-2 px-4 py-2.5 text-sm transition-colors rounded-t-base",
              tab === id
                ? "text-fg"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" />
            {label}
            {tab === id && (
              <motion.div
                layoutId="case-tab-indicator"
                className="absolute -bottom-px left-2 right-2 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      <div>
        {tab === "defense" && <Defense row={row} />}
        {tab === "counter" && <CounterAttack row={row} />}
        {tab === "adversary" && <Adversary row={row} />}
        {tab === "coalition" && <CoalitionTab row={row} />}
        {tab === "trial" && <MirrorTrial row={row} />}
        {tab === "coach" && <HearingCoach row={row} />}
        {tab === "map" && <CaseMap entityId={row.adversaryEntityId} />}
      </div>
    </section>
  );
}

function Deferred({ title }: { title: string }) {
  return (
    <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
      <div className="font-display text-xl text-fg">{title}</div>
      <p className="mt-2 text-fg-muted text-sm max-w-md mx-auto">
        Lights up in a later build pass. The Defense and Counter-attack tabs
        are live now.
      </p>
    </div>
  );
}
