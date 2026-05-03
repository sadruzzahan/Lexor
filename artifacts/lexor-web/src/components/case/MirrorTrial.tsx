import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import {
  Gavel,
  Loader2,
  Play,
  RefreshCw,
  Download,
  Scale,
  UserCircle2,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import {
  getTrial,
  runTrial,
  type CaseRow,
  type TrialView,
  type TrialTurnView,
  type TrialCharacter,
  type TrialOutcome,
} from "@/lib/api";

const CHARACTER_META: Record<
  TrialCharacter,
  { label: string; Icon: typeof Scale; tone: string }
> = {
  judge: {
    label: "Judge",
    Icon: Scale,
    tone: "border-accent/40 bg-accent/5 text-fg",
  },
  your_counsel: {
    label: "Your Counsel",
    Icon: Briefcase,
    tone: "border-emerald-400/40 bg-emerald-400/5 text-fg",
  },
  opposing: {
    label: "Opposing Counsel",
    Icon: UserCircle2,
    tone: "border-violation/40 bg-violation/5 text-fg",
  },
};

// Outcome labels are written from the user's perspective — they are
// always the recipient of the letter, i.e. typically the defendant in
// the simulated caption.
const OUTCOME_LABEL: Record<TrialOutcome, string> = {
  defendant: "you would likely win",
  plaintiff: "the opposing party would likely win",
  mixed: "split decision — partial wins on both sides",
  undetermined: "undetermined on this record",
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One short percussive "thunk" synthesized via the Web Audio API. We
 * synthesize so we don't have to ship an audio asset and so the sound
 * is deterministic across browsers. Honors reduced-motion preference.
 */
function playGavel(): void {
  if (prefersReducedMotion()) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Silent — audio is purely decorative.
  }
}

function Typewriter({
  text,
  speed = 18,
  onDone,
}: {
  text: string;
  speed?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setShown(0);
    let cancelled = false;
    const start = performance.now();
    const total = text.length;
    function tick(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const next = Math.min(total, Math.floor((elapsed / 1000) * speed * 4));
      setShown(next);
      if (next < total) requestAnimationFrame(tick);
      else onDoneRef.current?.();
    }
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [text, speed]);

  return (
    <span>
      {text.slice(0, shown)}
      {shown < text.length && (
        <span
          aria-hidden
          className="inline-block w-[0.35ch] h-[1em] -mb-[0.15em] bg-accent ml-[1px] align-middle"
          style={{ animation: "lexor-pulse 1s step-end infinite" }}
        />
      )}
    </span>
  );
}

interface RevealState {
  revealed: number;
  pending: TrialTurnView[];
}

type RevealAction =
  | { type: "reset"; turns: TrialTurnView[]; revealAll?: boolean }
  | { type: "advance" };

function reducer(state: RevealState, action: RevealAction): RevealState {
  if (action.type === "reset") {
    return {
      revealed: action.revealAll
        ? action.turns.length
        : action.turns.length > 0
          ? 1
          : 0,
      pending: action.turns,
    };
  }
  if (state.revealed >= state.pending.length) return state;
  return { ...state, revealed: state.revealed + 1 };
}

/**
 * True PDF generation via jsPDF. Wraps lines so a single long turn
 * doesn't overflow the page. Returns the saved filename so callers can
 * surface it in a toast.
 */
function downloadPdf(trial: TrialView, caseId: string): string {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  function newPageIfNeeded(needed = 16) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }
  function writeBlock(
    text: string,
    opts: { size?: number; bold?: boolean; gap?: number } = {},
  ) {
    const size = opts.size ?? 11;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      newPageIfNeeded(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
    y += opts.gap ?? 6;
  }

  writeBlock("Mirror Trial — Simulated Hearing", { size: 18, bold: true, gap: 12 });
  writeBlock(`Case ref: ${caseId}`, { size: 10 });
  writeBlock(`Generated: ${new Date(trial.startedAt).toLocaleString()}`, {
    size: 10,
    gap: 12,
  });
  const outcomeLine = trial.predictedOutcome
    ? `Predicted outcome: ${OUTCOME_LABEL[trial.predictedOutcome]}.`
    : "Outcome undetermined.";
  writeBlock(outcomeLine, { size: 12, bold: true });
  if (trial.predictedRationale) {
    writeBlock(trial.predictedRationale, { size: 11, gap: 12 });
  }

  writeBlock("Transcript", { size: 14, bold: true, gap: 8 });
  for (const t of trial.turns) {
    const meta = CHARACTER_META[t.character];
    writeBlock(`${meta.label}:`, { size: 11, bold: true, gap: 2 });
    writeBlock(t.line, { size: 11 });
    if (t.citation) writeBlock(`(${t.citation})`, { size: 10, gap: 8 });
  }

  if (trial.swingArguments.length > 0) {
    writeBlock("Arguments that swung it", { size: 14, bold: true, gap: 8 });
    trial.swingArguments.forEach((s, i) =>
      writeBlock(`${i + 1}. ${s}`, { size: 11 }),
    );
  }

  y += 8;
  newPageIfNeeded(60);
  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;
  writeBlock(
    "This transcript was generated by Lexor's Mirror Trial, a simulated " +
      "hearing produced by AI agents from the case record. It is NOT a " +
      "court proceeding, NOT legal advice, and MUST NOT be filed or relied " +
      "upon as a prediction of any actual outcome. Consult a licensed " +
      "attorney before taking action.",
    { size: 9 },
  );

  const filename = `mirror-trial-${caseId.slice(0, 8)}.pdf`;
  doc.save(filename);
  return filename;
}

export function MirrorTrial({ row }: { row: CaseRow }) {
  const caseId = row.id;
  const reduced = prefersReducedMotion();
  const [trial, setTrial] = useState<TrialView | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [state, dispatch] = useReducer(reducer, { revealed: 0, pending: [] });
  const [verdictArmed, setVerdictArmed] = useState(false);

  // Initial fetch — replay if persisted. Reduced-motion users skip the
  // animated reveal and see the entire transcript at once.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getTrial(caseId)
      .then((t) => {
        if (!alive) return;
        setTrial(t);
        if (t && t.status === "complete") {
          dispatch({ type: "reset", turns: t.turns, revealAll: reduced });
        }
      })
      .catch(() => {
        /* surfaces below as a "no trial" empty state */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [caseId, reduced]);

  // Fire the gavel sound + flash exactly once when a verdict turn
  // (judge's last line) becomes visible. Skipped in reduced-motion.
  useEffect(() => {
    if (reduced) return;
    if (!trial || trial.status !== "complete") return;
    const judgeFinalIdx = (() => {
      for (let i = trial.turns.length - 1; i >= 0; i--) {
        if (trial.turns[i]?.character === "judge") return i;
      }
      return -1;
    })();
    if (judgeFinalIdx >= 0 && state.revealed - 1 === judgeFinalIdx) {
      setVerdictArmed(true);
      playGavel();
      setTimeout(() => setVerdictArmed(false), 900);
    }
  }, [state.revealed, trial, reduced]);

  async function startTrial(force: boolean) {
    setRunning(true);
    const t0 = performance.now();
    try {
      const t = await runTrial(caseId, { force });
      setTrial(t);
      // Reveal the first turn immediately so its Typewriter can drive
      // subsequent advances; in reduced-motion mode show every turn
      // up-front with no progressive reveal.
      dispatch({ type: "reset", turns: t.turns, revealAll: reduced });
      const tookMs = Math.round(performance.now() - t0);
      toast.success(`Hearing complete in ${(tookMs / 1000).toFixed(1)}s`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't run trial — ${message}`);
    } finally {
      setRunning(false);
    }
  }

  const visibleTurns = useMemo(
    () => state.pending.slice(0, state.revealed),
    [state],
  );

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-fg-muted">
        <Loader2 className="animate-spin size-5 mr-2" /> Loading hearing…
      </div>
    );
  }

  // No trial yet — call to action.
  if (!trial) {
    return (
      <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
        <Gavel className="size-9 text-fg-muted mx-auto" aria-hidden />
        <h3 className="font-display text-2xl mt-3">Watch your case</h3>
        <p className="text-fg-muted mt-2 max-w-md mx-auto text-sm">
          Three AI agents — your counsel, opposing counsel, and a judge — will
          play out a simulated hearing grounded in this case's record. This is
          a demonstration, not a prediction.
        </p>
        <button
          type="button"
          onClick={() => void startTrial(false)}
          disabled={running}
          className="shimmer-btn rounded-base px-5 py-2.5 mt-5 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Hearing in session…
            </>
          ) : (
            <>
              <Play className="size-4" /> Begin the hearing
            </>
          )}
        </button>
        <p className="text-[10px] text-fg-subtle mt-4 max-w-md mx-auto">
          Typically completes in under 45 seconds.
        </p>
      </div>
    );
  }

  const allRevealed = state.revealed >= state.pending.length;

  return (
    <div className="space-y-6">
      {/* Courtroom layout — three avatars over a bench. Rendered without
          framer-motion in reduced-motion mode. */}
      <div className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
        <div className="grid grid-cols-3 gap-3 items-end">
          <Avatar
            character="your_counsel"
            active={!reduced && lastSpeaker(visibleTurns) === "your_counsel"}
            reduced={reduced}
          />
          <Avatar
            character="judge"
            active={!reduced && lastSpeaker(visibleTurns) === "judge"}
            elevated
            reduced={reduced}
          />
          <Avatar
            character="opposing"
            active={!reduced && lastSpeaker(visibleTurns) === "opposing"}
            reduced={reduced}
          />
        </div>
        <div className="mt-3 h-1 rounded-full bg-gradient-to-r from-transparent via-border-strong to-transparent" />
        <div className="mt-1 text-center text-[10px] uppercase tracking-[0.2em] text-fg-subtle">
          The bench
        </div>
      </div>

      {/* Verdict flash overlay — visual gavel strike. Skipped if reduced. */}
      {!reduced && (
        <AnimatePresence>
          {verdictArmed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-none fixed inset-0 z-20 bg-accent/30"
              aria-hidden
            />
          )}
        </AnimatePresence>
      )}

      {/* Transcript. In reduced-motion mode we render a flat static
          transcript with no AnimatePresence and no typewriter. */}
      {reduced ? (
        <div
          className="rounded-lg2 border border-border-strong bg-bg-elevated p-5 space-y-3"
          aria-label="Hearing transcript"
        >
          {trial.turns.map((t) => {
            const meta = CHARACTER_META[t.character];
            return (
              <div key={t.ord} className={`rounded-lg2 border p-4 ${meta.tone}`}>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-fg-muted mb-1.5">
                  <meta.Icon className="size-3.5" aria-hidden />
                  {meta.label}
                </div>
                <div className="text-sm leading-relaxed text-fg">{t.line}</div>
                {t.citation && (
                  <div className="mt-1.5 text-[11px] text-fg-subtle italic">
                    {t.citation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="rounded-lg2 border border-border-strong bg-bg-elevated p-5 space-y-3"
          aria-live="polite"
          aria-label="Hearing transcript"
        >
          <AnimatePresence initial={false}>
            {visibleTurns.map((t, i) => {
              const isLast = i === visibleTurns.length - 1;
              const meta = CHARACTER_META[t.character];
              return (
                <motion.div
                  key={t.ord}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`rounded-lg2 border p-4 ${meta.tone}`}
                >
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-fg-muted mb-1.5">
                    <meta.Icon className="size-3.5" aria-hidden />
                    {meta.label}
                  </div>
                  <div className="text-sm leading-relaxed text-fg">
                    {isLast ? (
                      <Typewriter
                        text={t.line}
                        onDone={() => dispatch({ type: "advance" })}
                      />
                    ) : (
                      t.line
                    )}
                  </div>
                  {t.citation && (
                    <div className="mt-1.5 text-[11px] text-fg-subtle italic">
                      {t.citation}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!allRevealed && (
            <div className="text-xs text-fg-subtle inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" /> Next line incoming…
            </div>
          )}
        </div>
      )}

      {/* Verdict + actions. */}
      {trial.status === "complete" && allRevealed && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg2 border border-accent/40 bg-accent/5 p-5"
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
            <Gavel className="size-4" aria-hidden /> Predicted outcome
          </div>
          <div className="mt-1 font-display text-2xl text-fg first-letter:uppercase">
            {trial.predictedOutcome
              ? OUTCOME_LABEL[trial.predictedOutcome]
              : "Undetermined"}
          </div>
          {trial.predictedRationale && (
            <p className="mt-2 text-sm text-fg-muted leading-relaxed">
              {trial.predictedRationale}
            </p>
          )}
          {trial.swingArguments.length > 0 && (
            <>
              <div className="mt-4 text-xs uppercase tracking-wider text-fg-subtle">
                Arguments that swung it
              </div>
              <ol className="mt-2 space-y-1.5 text-sm text-fg list-decimal pl-5">
                {trial.swingArguments.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                try {
                  const filename = downloadPdf(trial, caseId);
                  toast.success(`Saved ${filename}`);
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  toast.error(`PDF export failed — ${message}`);
                }
              }}
              className="shimmer-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
            >
              <Download className="size-4" /> Download transcript PDF
            </button>
            <button
              type="button"
              onClick={() => void startTrial(true)}
              disabled={running}
              className="ghost-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Run again
            </button>
          </div>
          <p className="mt-4 text-[10px] text-fg-subtle">
            Mirror Trial is a simulated hearing produced by AI agents from
            the case record. It is not a court proceeding, not legal advice,
            and not a prediction of any actual outcome.
          </p>
        </motion.div>
      )}
    </div>
  );
}

function lastSpeaker(turns: TrialTurnView[]): TrialCharacter | null {
  return turns.length > 0 ? turns[turns.length - 1]!.character : null;
}

function Avatar({
  character,
  active,
  elevated = false,
  reduced = false,
}: {
  character: TrialCharacter;
  active: boolean;
  elevated?: boolean;
  reduced?: boolean;
}) {
  const meta = CHARACTER_META[character];
  const ring = active ? "border-accent" : "border-border-strong";
  return (
    <div className={`flex flex-col items-center ${elevated ? "-mt-3" : ""}`}>
      {reduced ? (
        <div
          className={`size-14 rounded-full grid place-items-center border ${ring} bg-bg-raised`}
          aria-hidden
        >
          <meta.Icon className="size-6 text-fg-muted" />
        </div>
      ) : (
        <motion.div
          animate={
            active
              ? {
                  scale: [1, 1.06, 1],
                  boxShadow: "0 0 0 4px rgba(255,255,255,0.06)",
                }
              : { scale: 1 }
          }
          transition={{ duration: 0.6 }}
          className={`size-14 rounded-full grid place-items-center border ${ring} bg-bg-raised`}
          aria-hidden
        >
          <meta.Icon className="size-6 text-fg-muted" />
        </motion.div>
      )}
      <div className="mt-2 text-[11px] uppercase tracking-wider text-fg-muted text-center">
        {meta.label}
      </div>
    </div>
  );
}
