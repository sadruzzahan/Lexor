import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import {
  Users2,
  Building2,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  Gavel,
  Vote,
  Trophy,
  Check,
} from "lucide-react";

import { toast } from "sonner";
import {
  getCoalition,
  joinCoalition,
  submitCoalitionBid,
  voteCoalitionBid,
  type CoalitionDetail,
  type CoalitionBid,
} from "@/lib/api";
import { useDocumentTitle } from "@/lib/hooks";

const VERTICAL_LABELS: Record<string, string> = {
  debt: "Debt Collection",
  eviction: "Eviction Notice",
  wage: "Wage Dispute",
  contract: "Contract Dispute",
  other: "Legal letter",
};

const COALITION_DISCLAIMER = `Joining a coalition does not commit you to a lawsuit. A vetted plaintiff's lawyer may contact you. Lexor is not your lawyer and takes 0% of any recovery. You can leave at any time.`;

export default function CoalitionPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  useDocumentTitle("Coalition — Lexor");

  const [data, setData] = useState<CoalitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [showBid, setShowBid] = useState(false);
  const [voteBidId, setVoteBidId] = useState<string | null>(null);

  async function reload() {
    if (!id) return;
    try {
      const d = await getCoalition(id);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return null;
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-fg-muted">
        <Loader2 className="animate-spin size-5 mr-2" /> Loading coalition…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-fg-muted gap-3">
        <ShieldAlert className="size-6" />
        <div>We couldn't load this coalition.</div>
        <Link
          href="/upload"
          className="text-accent underline-offset-4 hover:underline"
        >
          Start a new case
        </Link>
      </div>
    );
  }

  const winningBid = pickWinner(data.bids);

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
          Coalition · {id.slice(0, 8)}
        </div>
        <h1 className="font-display text-3xl md:text-4xl tracking-tight mt-1 capitalize">
          vs. {data.entityName ?? "the opposing party"}
        </h1>
        <div className="mt-2 text-sm text-fg-muted flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Users2 className="size-3.5" /> {data.caseCount} cases ·{" "}
            {data.optedInCount} opted-in
          </span>
          <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] uppercase tracking-wider">
            {data.status}
          </span>
          <span>{VERTICAL_LABELS[data.vertical] ?? data.vertical}</span>
          {data.jurisdiction && <span>· {data.jurisdiction}</span>}
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
            <div className="flex items-center gap-2 mb-3">
              <Gavel className="size-4 text-accent" />
              <h2 className="font-display text-lg">Class complaint draft</h2>
            </div>
            {data.classComplaintDraftHtml ? (
              <div
                className="prose prose-invert prose-sm max-w-none text-fg-muted"
                // The HTML is server-generated from a Claude JSON response
                // and HTML-escaped before assembly in services/coalition/draft.ts.
                dangerouslySetInnerHTML={{
                  __html: data.classComplaintDraftHtml,
                }}
              />
            ) : (
              <p className="text-sm text-fg-subtle italic">
                The class complaint outline is being drafted.
              </p>
            )}
          </section>

          <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-accent" />
                <h2 className="font-display text-lg">Lawyer bids</h2>
              </div>
              <button
                onClick={() => setShowBid(true)}
                className="shimmer-btn rounded-base px-3 py-1.5 text-xs font-medium"
              >
                Submit a bid
              </button>
            </div>
            {data.bids.length === 0 ? (
              <p className="text-sm text-fg-subtle italic">
                No bids yet. Lawyers — submit your contingency offer above.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.bids.map((b) => (
                  <BidRow
                    key={b.id}
                    bid={b}
                    isWinner={winningBid?.id === b.id}
                    onVote={() => setVoteBidId(b.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg2 border border-accent/40 bg-accent/5 p-5">
            <h3 className="font-display text-lg">Join this coalition</h3>
            <p className="mt-2 text-xs text-fg-muted">
              {COALITION_DISCLAIMER}
            </p>
            <button
              onClick={() => setShowJoin(true)}
              className="mt-4 shimmer-btn rounded-base px-3 py-2 text-sm w-full"
            >
              Review &amp; opt in
            </button>
          </section>

          <section className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
            <h3 className="font-display text-lg flex items-center gap-2">
              <Users2 className="size-4 text-accent" /> Members
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {data.members.map((m) => (
                <li
                  key={m.label}
                  className="flex items-center justify-between text-fg-muted"
                >
                  <span className="text-fg">{m.label}</span>
                  <span className="text-xs">{m.jurisdiction}</span>
                  {m.hasOptedIn && (
                    <Check className="size-3.5 text-accent" aria-label="opted in" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {showJoin && (
        <JoinDialog
          coalitionId={id}
          disclaimerVersion={data.disclaimerVersion}
          onClose={() => setShowJoin(false)}
          onJoined={async () => {
            setShowJoin(false);
            await reload();
          }}
        />
      )}
      {showBid && (
        <BidDialog
          coalitionId={id}
          onClose={() => setShowBid(false)}
          onSubmitted={async () => {
            setShowBid(false);
            await reload();
          }}
        />
      )}
      {voteBidId && (
        <VoteDialog
          coalitionId={id}
          bidId={voteBidId}
          onClose={() => setVoteBidId(null)}
          onVoted={async () => {
            setVoteBidId(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function pickWinner(bids: CoalitionBid[]): CoalitionBid | null {
  if (bids.length === 0) return null;
  const max = Math.max(...bids.map((b) => b.voteCount));
  if (max === 0) return null;
  return bids.find((b) => b.voteCount === max) ?? null;
}

function BidRow({
  bid,
  isWinner,
  onVote,
}: {
  bid: CoalitionBid;
  isWinner: boolean;
  onVote: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="py-3 flex flex-wrap items-center gap-3"
    >
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{bid.lawyerName}</span>
          {isWinner && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent">
              <Trophy className="size-3" /> leading
            </span>
          )}
        </div>
        <div className="text-xs text-fg-muted">
          {bid.lawyerFirm ?? "Solo"} · Bar #{bid.lawyerBarNumber}
        </div>
        {bid.notes && (
          <div className="text-xs text-fg-subtle mt-1 italic">{bid.notes}</div>
        )}
      </div>
      <div className="text-right">
        <div className="font-display text-2xl tabular-nums text-fg">
          {Number(bid.contingencyPercent).toFixed(1)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          contingency
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Vote className="size-3.5" /> {bid.voteCount}
      </div>
      <button
        onClick={onVote}
        className="rounded-base border border-border-strong px-3 py-1.5 text-xs hover:bg-bg-elevated"
      >
        Vote
      </button>
    </motion.li>
  );
}

function JoinDialog({
  coalitionId,
  disclaimerVersion,
  onClose,
  onJoined,
}: {
  coalitionId: string;
  disclaimerVersion: string;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,92vw)] rounded-lg2 border border-border-strong bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl">Join the coalition</h3>
        <div className="mt-4 rounded-base border border-warning/40 bg-warning/5 p-4 text-sm text-fg">
          <strong>Required disclosure ({disclaimerVersion}).</strong>
          <p className="mt-2 text-fg-muted">{COALITION_DISCLAIMER}</p>
        </div>
        <label className="mt-4 block text-sm">
          Your case ID
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="paste the UUID from your case URL"
            className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2 text-sm font-mono"
          />
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>
            I have read the disclosure and consent to be added as a coalition
            member.
          </span>
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-base border border-border-strong px-3 py-2 text-sm text-fg-muted"
          >
            Cancel
          </button>
          <button
            disabled={!confirmed || caseId.trim().length < 10 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await joinCoalition(
                  coalitionId,
                  caseId.trim(),
                  disclaimerVersion,
                );
                toast.success("You're in. The class complaint draft is at the top of this page.");
                onJoined();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Join failed",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Joining…" : "Confirm opt-in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoteDialog({
  coalitionId,
  bidId,
  onClose,
  onVoted,
}: {
  coalitionId: string;
  bidId: string;
  onClose: () => void;
  onVoted: () => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-[min(480px,92vw)] rounded-lg2 border border-border-strong bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl">Cast your vote</h3>
        <p className="mt-2 text-xs text-fg-muted">
          Enter your case ID to confirm you are an opted-in coalition member.
          Your case ID appears in the URL when viewing your case
          (e.g. <code className="font-mono">/c/&lt;uuid&gt;</code>).
        </p>
        <label className="mt-4 block text-sm">
          Your case ID
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="paste the UUID from your case URL"
            className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2 text-sm font-mono"
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-base border border-border-strong px-3 py-2 text-sm text-fg-muted"
          >
            Cancel
          </button>
          <button
            disabled={caseId.trim().length < 10 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await voteCoalitionBid(coalitionId, caseId.trim(), bidId);
                toast.success("Vote recorded");
                onVoted();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Vote failed");
              } finally {
                setBusy(false);
              }
            }}
            className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Voting…" : "Confirm vote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BidDialog({
  coalitionId,
  onClose,
  onSubmitted,
}: {
  coalitionId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [form, setForm] = useState({
    lawyerName: "",
    lawyerBarNumber: "",
    lawyerEmail: "",
    lawyerFirm: "",
    contingencyPercent: "33",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const valid =
    form.lawyerName.trim() &&
    form.lawyerBarNumber.trim() &&
    /\S+@\S+\.\S+/.test(form.lawyerEmail) &&
    Number(form.contingencyPercent) >= 0 &&
    Number(form.contingencyPercent) <= 100;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,92vw)] rounded-lg2 border border-border-strong bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl">Submit a bid</h3>
        <p className="mt-2 text-xs text-fg-muted">
          Open marketplace. Identity is self-asserted; bar numbers are
          verified manually before any introduction.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2">
            Name
            <input
              value={form.lawyerName}
              onChange={(e) =>
                setForm((f) => ({ ...f, lawyerName: e.target.value }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
          <label>
            Bar #
            <input
              value={form.lawyerBarNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, lawyerBarNumber: e.target.value }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
          <label>
            Firm (optional)
            <input
              value={form.lawyerFirm}
              onChange={(e) =>
                setForm((f) => ({ ...f, lawyerFirm: e.target.value }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
          <label className="col-span-2">
            Email
            <input
              type="email"
              value={form.lawyerEmail}
              onChange={(e) =>
                setForm((f) => ({ ...f, lawyerEmail: e.target.value }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
          <label>
            Contingency %
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.contingencyPercent}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contingencyPercent: e.target.value,
                }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
          <label className="col-span-2">
            Brief credentials / notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              className="mt-1 w-full rounded-base border border-border-strong bg-bg p-2"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-base border border-border-strong px-3 py-2 text-sm text-fg-muted"
          >
            Cancel
          </button>
          <button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await submitCoalitionBid(coalitionId, {
                  lawyerName: form.lawyerName.trim(),
                  lawyerBarNumber: form.lawyerBarNumber.trim(),
                  lawyerEmail: form.lawyerEmail.trim(),
                  lawyerFirm: form.lawyerFirm.trim() || null,
                  contingencyPercent: Number(form.contingencyPercent),
                  notes: form.notes.trim() || null,
                });
                toast.success("Bid submitted");
                onSubmitted();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Bid failed",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit bid"}
          </button>
        </div>
      </div>
    </div>
  );
}
