import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../../lib/logger";

/**
 * Hearing Coach — Claude generates short (≤8 words) tactical
 * interjections from a live courtroom transcript. Grounded ONLY in the
 * case's already-resolved violations + parsed claims. No invented law.
 *
 * Drift from spec: live STT (Deepgram Flux) and Flash TTS (ElevenLabs)
 * are deferred until those keys land. Until then the client uses the
 * browser's SpeechRecognition + speechSynthesis APIs and this server
 * endpoint is the only AI hop. The latency budget (≤1.5s end-to-end)
 * still applies — we use claude-haiku-4-5 + max_tokens 60 to stay snappy.
 */

export interface CoachContext {
  vertical: string;
  jurisdiction: string | null;
  opposingPartyName: string;
  documentSummary: string;
  keyClaims: string[];
  violations: Array<{
    code: string;
    statute: string;
    description: string;
    severity: string;
  }>;
}

export interface CoachInterjection {
  /**
   * The whisper line. Null when the model decides nothing tactical
   * needs saying — the client treats null as "stay silent".
   */
  line: string | null;
  /**
   * Optional citation surfaced separately so the UI can highlight it.
   * Always pulled from the violations list — never invented.
   */
  citation: string | null;
  /** "high" plays immediately and interrupts any queued line. */
  urgency: "high" | "normal";
}

const MAX_WORDS = 8;

/**
 * Hard-cap interjections at MAX_WORDS regardless of what the model
 * says. Sentence-end punctuation is preserved.
 */
function clampWords(s: string): string {
  const trimmed = s.trim().replace(/^["'`]+|["'`]+$/g, "");
  const parts = trimmed.split(/\s+/).slice(0, MAX_WORDS);
  let out = parts.join(" ");
  // Preserve a closing punctuation if the original ended in one and we
  // happened to chop it off mid-clause. Avoid double-punctuating.
  const lastChar = out.slice(-1);
  if (!/[.!?]$/.test(lastChar)) out += ".";
  return out;
}

function buildSystemPrompt(ctx: CoachContext): string {
  const violLines = ctx.violations
    .slice(0, 8)
    .map(
      (v, i) =>
        `${i + 1}. [${v.code}] ${v.statute} — ${v.description.slice(0, 160)}`,
    )
    .join("\n");
  const claimLines = ctx.keyClaims.slice(0, 6).map((c) => `- ${c}`).join("\n");
  return `You are HEARING COACH, an AI whispering tactical guidance to a
self-represented litigant ("the user") through a single earbud during
a live court hearing. You hear the courtroom transcript in real time
and surface SHORT, ACTIONABLE interjections — never speeches.

Case context (the user is the DEFENDANT / RECIPIENT of the letter):
- Vertical: ${ctx.vertical}
- Jurisdiction: ${ctx.jurisdiction ?? "unknown"}
- Opposing party: ${ctx.opposingPartyName}
- Letter summary: ${ctx.documentSummary.slice(0, 600)}

Their key claims:
${claimLines || "- (none extracted)"}

Documented violations you may cite (and ONLY these — never invent law):
${violLines || "- (none documented)"}

STRICT RULES:
- Reply with ONE JSON object: { "line": string|null, "citation": string|null, "urgency": "high"|"normal" }.
- "line" is what the user should hear. MAX ${MAX_WORDS} WORDS. Plain spoken English. No emojis, no markdown, no code.
- Set "line" to null whenever nothing tactical is warranted — silence is the default.
- "citation" must be one of the statute strings above verbatim, or null.
- "urgency": "high" only when the user must act THIS MOMENT (an objection
  must be made before the next sentence). Otherwise "normal".
- Forbidden interjections: filler ("good job"), commentary, predictions
  about the verdict, anything not tied to a procedural move the user can
  make right now (object, cite, ask for X, request continuance, decline
  to answer, request to consult counsel).`;
}

function buildUserPrompt(transcript: string): string {
  // Anchor the model on the most recent ~1500 chars — courtroom context
  // shifts fast and old turns dilute the signal.
  const recent = transcript.slice(-1500);
  return `LIVE TRANSCRIPT (most recent first if truncated):
${recent}

Decide: is there a tactical move the user must make in the next breath?
If yes, produce the whisper. If not, return { "line": null, "citation": null, "urgency": "normal" }.`;
}

export async function generateInterjection(opts: {
  ctx: CoachContext;
  transcript: string;
}): Promise<CoachInterjection> {
  if (!opts.transcript.trim()) {
    return { line: null, citation: null, urgency: "normal" };
  }
  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: buildSystemPrompt(opts.ctx),
      messages: [{ role: "user", content: buildUserPrompt(opts.transcript) }],
    });
    const block = message.content[0];
    raw = block && block.type === "text" ? block.text : "";
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "coach interjection failed",
    );
    // Fail closed — silence is always safe in the courtroom.
    return { line: null, citation: null, urgency: "normal" };
  }

  // Pull the first balanced JSON object out of the response. Models
  // occasionally wrap output in code fences or prose.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { line: null, citation: null, urgency: "normal" };
  }
  type Parsed = {
    line?: unknown;
    citation?: unknown;
    urgency?: unknown;
  };
  let parsed: Parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Parsed;
  } catch {
    return { line: null, citation: null, urgency: "normal" };
  }

  const line =
    typeof parsed.line === "string" && parsed.line.trim().length > 0
      ? clampWords(parsed.line)
      : null;
  const urgency = parsed.urgency === "high" ? "high" : "normal";
  // Only accept a citation if it appears verbatim in the violations
  // list — defends against the model inventing a statute.
  const allowedCitations = new Set(opts.ctx.violations.map((v) => v.statute));
  const citation =
    typeof parsed.citation === "string" && allowedCitations.has(parsed.citation)
      ? parsed.citation
      : null;

  return { line, citation, urgency };
}
