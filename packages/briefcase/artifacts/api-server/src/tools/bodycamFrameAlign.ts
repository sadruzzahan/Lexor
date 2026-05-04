import { runWithProgress } from "../engine/streamingTools";
import type { SubagentEmit } from "../agents/shared";

/**
 * bodycamFrameAlign — extract HH:MM:SS-style timestamps from a parsed
 * document and align them against a reference document so contradictions
 * surrounding bodycam activation gaps, lab intake times, and witness
 * timing claims become explicit anchors a downstream LLM can reason
 * over.
 *
 * Spec §9.5 calls for this to run inside an E2B Python sandbox using
 * pandas + numpy. We do the same arithmetic in pure TypeScript so the
 * G12 ContradictionEngine has a deterministic, network-free anchor set
 * without spinning up a sandbox per pair. Swapping to E2B later is a
 * mechanical replacement of `extractAnchors` — the input/output shape
 * is the same.
 */
export interface TimeAnchor {
  /** Raw token as it appeared in the document (e.g. "22:07:55"). */
  raw: string;
  /** Seconds since midnight on a notional 24h clock. */
  secondsOfDay: number;
  /** ±60 char neighborhood for grounding the LLM rationale. */
  context: string;
}

export interface AlignedAnchor {
  fileA: string;
  fileB: string;
  anchorA: TimeAnchor;
  anchorB: TimeAnchor;
  /** Signed delta in seconds — `anchorB - anchorA`. */
  deltaSeconds: number;
}

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/g;

export function extractAnchors(args: {
  fileName: string;
  text: string;
  /** Cap to keep prompts bounded. */
  maxAnchors?: number;
}): TimeAnchor[] {
  const out: TimeAnchor[] = [];
  const cap = args.maxAnchors ?? 24;
  const text = args.text;
  // Reset state on the shared regex literal between invocations.
  TIME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_RE.exec(text)) !== null) {
    const hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    const ss = m[3] != null ? parseInt(m[3], 10) : 0;
    const sec = hh * 3600 + mm * 60 + ss;
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, m.index + m[0].length + 60);
    out.push({
      raw: m[0],
      secondsOfDay: sec,
      context: text
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim(),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Pairwise time alignment: every anchor in `a` against every anchor in
 * `b`, sorted by absolute time delta ascending so the LLM sees the
 * tightest pairs first. Hard-capped to keep prompts compact.
 */
export function alignAnchors(args: {
  fileA: string;
  anchorsA: TimeAnchor[];
  fileB: string;
  anchorsB: TimeAnchor[];
  /** Pairs to keep, smallest-delta first. */
  topN?: number;
}): AlignedAnchor[] {
  const top = args.topN ?? 12;
  const pairs: AlignedAnchor[] = [];
  for (const a of args.anchorsA) {
    for (const b of args.anchorsB) {
      pairs.push({
        fileA: args.fileA,
        fileB: args.fileB,
        anchorA: a,
        anchorB: b,
        deltaSeconds: b.secondsOfDay - a.secondsOfDay,
      });
    }
  }
  pairs.sort((x, y) => Math.abs(x.deltaSeconds) - Math.abs(y.deltaSeconds));
  return pairs.slice(0, top);
}

/**
 * Streaming wrapper used by ContradictionEngine: extract anchors from
 * both files and align them, all under runWithProgress so any future
 * E2B-backed implementation that exceeds the 4s tool_progress threshold
 * automatically streams progress + records cost into the CostMeter
 * without further wiring.
 *
 * The pure-TS path is sub-millisecond so the wrapper is effectively a
 * no-op today, but the registration keeps tool catalog coverage at 100%
 * per the G21 spec.
 */
export async function alignBodycamFrames(args: {
  fileA: string;
  textA: string;
  fileB: string;
  textB: string;
  topN?: number;
  maxAnchors?: number;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<AlignedAnchor[]> {
  return runWithProgress({
    tool: "bodycamFrameAlign",
    emit: args.emit,
    subagent: args.subagent,
    runId: args.runId,
    meta: { fileA: args.fileA, fileB: args.fileB },
    fn: async () => {
      const anchorsA = extractAnchors({
        fileName: args.fileA,
        text: args.textA,
        ...(args.maxAnchors !== undefined ? { maxAnchors: args.maxAnchors } : {}),
      });
      const anchorsB = extractAnchors({
        fileName: args.fileB,
        text: args.textB,
        ...(args.maxAnchors !== undefined ? { maxAnchors: args.maxAnchors } : {}),
      });
      return alignAnchors({
        fileA: args.fileA,
        anchorsA,
        fileB: args.fileB,
        anchorsB,
        ...(args.topN !== undefined ? { topN: args.topN } : {}),
      });
    },
  });
}
