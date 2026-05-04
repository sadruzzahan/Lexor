/**
 * G14 CourtroomCopilot — live objection copilot.
 *
 * Pipeline per audio chunk:
 *   1. transcribeStream(audio) → text
 *   2. lookupObjectionCandidates(text, jurisdiction) → ObjectionMatch[]
 *   3. If any candidates, ask Claude (small/fast) to confirm which (if
 *      any) is a real objection cue and to draft a <=140 char suggestion
 *   4. publishObjection() onto the per-session bus → SSE → glow + haptic
 *
 * The pipeline is fire-and-forget per chunk: the route returns 202 the
 * instant the audio is queued so MediaRecorder can keep streaming. We
 * cap concurrent in-flight chunks per session at 2 to bound model spend.
 *
 * Privacy: when `consentTranscript === false` we publish with the raw
 * snippet REDACTED to a placeholder so it never crosses the SSE wire to
 * any future shoulder-surfer; the suggestion still goes through.
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { transcribeStream } from "../../tools/transcribeStream";
import {
  lookupObjectionCandidates,
  listObjectionRules,
  type Jurisdiction,
  type ObjectionMatch,
} from "../../tools/objectionRulesLookup";
import { vadSegment } from "../../tools/vadSegment";
import { publishObjection } from "../../engine/courtroomBus";
import { logger } from "../../lib/logger";

/**
 * Courtroom-mode citation verifier. Live cues cite stable rules from
 * our jurisdiction catalog (FRE / CEA / IEA), not arbitrary URLs, so
 * the safest verification is "must exist in the loaded catalog for
 * this jurisdiction." Anything else is dropped before publish — same
 * honesty contract as PrecedentFinder + CrossExamGen (spec §10.4).
 */
function verifyRuleCitation(
  ruleKey: string,
  jurisdiction: Jurisdiction,
): { verified: boolean; reason?: string } {
  const allowed = listObjectionRules(jurisdiction).some((r) => r.ruleKey === ruleKey);
  return allowed
    ? { verified: true }
    : { verified: false, reason: `ruleKey "${ruleKey}" not in ${jurisdiction} catalog` };
}

const JudgeSchema = z.object({
  shouldFlag: z.boolean().describe("True only if this is a real, immediately-objectionable cue."),
  ruleKey: z.string().nullable().describe("The chosen ruleKey from candidates, or null if shouldFlag=false."),
  suggestion: z
    .string()
    .max(140)
    .describe("<=140 char plain-English action: e.g. 'Object: hearsay (FRE 802)'"),
});

interface ProcessArgs {
  sessionId: string;
  jurisdiction: Jurisdiction;
  consentTranscript: boolean;
  audio: Buffer;
  mime: string;
  language?: string;
}

const inFlightBySession = new Map<string, number>();

export async function processCourtroomChunk(args: ProcessArgs): Promise<void> {
  const inFlight = inFlightBySession.get(args.sessionId) ?? 0;
  if (inFlight >= 2) {
    logger.debug({ sessionId: args.sessionId }, "courtroomCopilot: dropping chunk (backpressure)");
    return;
  }
  inFlightBySession.set(args.sessionId, inFlight + 1);

  try {
    // Step 0 — coarse VAD: drop silent chunks before paying for a
    // transcription round-trip.
    const vad = vadSegment({ audio: args.audio, mime: args.mime });
    if (!vad.hasSpeech) {
      logger.debug({ sessionId: args.sessionId, reason: vad.reason }, "courtroomCopilot: VAD drop");
      return;
    }

    const t = await transcribeStream({
      audio: args.audio,
      mime: args.mime,
      language: args.language,
    });
    if (!t.text) return;

    const candidates = lookupObjectionCandidates(t.text, args.jurisdiction);
    if (candidates.length === 0) return;

    const judged = await judgeCandidates(t.text, candidates);
    if (!judged.shouldFlag || !judged.ruleKey) return;

    // Citation honesty: judge must pick a ruleKey from the catalog;
    // anything else is dropped silently (same contract as
    // verifyCitation guards in PrecedentFinder / CrossExamGen).
    const verified = verifyRuleCitation(judged.ruleKey, args.jurisdiction);
    if (!verified.verified) {
      logger.warn(
        { sessionId: args.sessionId, ruleKey: judged.ruleKey, reason: verified.reason },
        "courtroomCopilot: dropped unverifiable citation",
      );
      return;
    }

    const chosen = candidates.find((c) => c.rule.ruleKey === judged.ruleKey);
    if (!chosen) return;

    publishObjection(args.sessionId, {
      ruleKey: chosen.rule.ruleKey,
      ruleLabel: chosen.rule.label,
      citation: chosen.rule.citation,
      severity: chosen.rule.severity,
      transcriptSnippet: args.consentTranscript ? t.text : "[redacted — no transcript consent]",
      suggestion: judged.suggestion,
    });
  } catch (err) {
    // Honest-failure: surface dependency outages onto the SSE channel
    // as a strong-severity system event so the lawyer sees that the
    // copilot is silent for a real reason — not because nothing is
    // happening. Other unexpected errors are logged but not surfaced.
    const isDepError =
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "dependency_unavailable";
    if (isDepError) {
      const msg = (err as Error).message || "Required service unavailable";
      publishObjection(args.sessionId, {
        ruleKey: "system.dependency_unavailable",
        ruleLabel: "Copilot offline",
        citation: "system",
        severity: "strong",
        transcriptSnippet: "",
        suggestion: `Copilot offline: ${msg}`.slice(0, 140),
      });
    }
    logger.warn({ err, sessionId: args.sessionId }, "courtroomCopilot: chunk processing failed");
  } finally {
    const cur = inFlightBySession.get(args.sessionId) ?? 1;
    const next = Math.max(0, cur - 1);
    if (next === 0) inFlightBySession.delete(args.sessionId);
    else inFlightBySession.set(args.sessionId, next);
  }
}

async function judgeCandidates(
  snippet: string,
  candidates: ObjectionMatch[],
): Promise<z.infer<typeof JudgeSchema>> {
  const candidateBundle = candidates
    .map(
      (c) =>
        `- ruleKey="${c.rule.ruleKey}"  label="${c.rule.label}"  citation=${c.rule.citation}  triggered_on="${c.matchedTrigger}"`,
    )
    .join("\n");

  const prompt = `You are an evidence-rules referee in a live courtroom. A snippet of
witness testimony has just been transcribed. Below are pre-matched
candidate objection rules (matched by trigger phrase only — they may be
false positives in context).

Decide whether the lawyer should object RIGHT NOW. Be strict: only flag
when the cue is unambiguous in the snippet. If the trigger fires only
because of a stock phrase used innocently, do NOT flag.

If you flag, pick exactly one ruleKey from the candidates and write a
suggestion <=140 chars that the lawyer can act on instantly (e.g.
"Object: hearsay (FRE 802) — ask judge to strike").

SNIPPET:
"""
${snippet}
"""

CANDIDATES:
${candidateBundle}`;

  // Honest-failure: do NOT swallow LLM errors with a no-flag fallback.
  // If the judge is unavailable, the caller surfaces a system event on
  // the SSE channel so the lawyer knows the copilot is silent.
  const { object } = await callLLM({
    taskKind: "structured-classification",
    schema: JudgeSchema,
    prompt,
    subagent: "CourtroomCopilot",
    maxOutputTokens: 200,
  });
  return object;
}
