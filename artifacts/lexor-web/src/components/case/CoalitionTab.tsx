import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Users2, ArrowRight, Loader2 } from "lucide-react";
import {
  getCoalitionForCase,
  type CaseCoalition,
  type CaseRow,
} from "@/lib/api";

export function CoalitionTab({ row }: { row: CaseRow }) {
  const [data, setData] = useState<CaseCoalition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCoalitionForCase(row.id)
      .then((c) => {
        if (alive) setData(c);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [row.id]);

  if (loading) {
    return (
      <div className="rounded-lg2 border border-border-strong bg-bg-elevated p-8 text-center text-fg-muted">
        <Loader2 className="animate-spin size-5 inline mr-2" /> Looking for your
        coalition…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
        <Users2 className="size-8 text-fg-muted mx-auto" />
        <div className="font-display text-xl text-fg mt-3">
          No coalition yet
        </div>
        <p className="mt-2 text-fg-muted text-sm max-w-md mx-auto">
          A coalition forms automatically once 5+ cases targeting the same
          opposing party share substantially-similar letters. We'll surface
          one here the moment yours qualifies.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg2 border border-accent/40 bg-accent/5 p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
        <Users2 className="size-4" />
        {data.hasOptedIn ? "You're in this coalition" : "You qualify for a coalition"}
      </div>
      <h3 className="font-display text-2xl mt-2">
        vs. {data.entityName ?? "the opposing party"}
      </h3>
      <p className="mt-2 text-fg-muted text-sm">
        {data.caseCount} cases received substantially similar letters from
        this party. Status: {data.status}.
        {data.hasOptedIn ? (
          <> You've opted in — review the class complaint draft and lawyer bids.</>
        ) : (
          <> Review the class complaint draft, then explicitly opt in if you'd
            like to be part of any future class action.</>
        )}
      </p>
      <Link
        href={`/coalition/${data.id}`}
        className="mt-4 inline-flex items-center gap-2 shimmer-btn rounded-base px-4 py-2 text-sm font-medium"
      >
        {data.hasOptedIn ? "Open coalition" : "Review & decide"}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
