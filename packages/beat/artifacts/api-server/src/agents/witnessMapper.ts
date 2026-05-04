import type { AgentContext, WitnessMapResult } from "./types.js";
import type { IEventSink } from "../lib/eventSink.js";
import type { CostTracker } from "../lib/costTracker.js";
import { getAnthropicClient } from "../lib/aiClients.js";
import { toJsonb } from "../lib/toJsonb.js";
import { db } from "@workspace/db";
import { artifactsTable } from "@workspace/db/schema";

const SYSTEM_PROMPT = `You are a witness analysis AI for law enforcement investigations.
Based on the incident description, identify potential witnesses and their likely roles.

Return a JSON object (no code fences):
{
  "witnesses": [
    {
      "id": "W-001",
      "name": "Witness name or 'Anonymous' if unknown",
      "role": "bystander|resident|employee|first_responder|victim|suspect",
      "statementExcerpt": "1-2 sentence statement excerpt or inferred account",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "2-3 sentence summary of the witness landscape"
}
Include 2-4 witnesses. Use 'Anonymous' for name when identity is unknown.
Respond with JSON only.`;

const FALLBACK: WitnessMapResult = {
  witnesses: [],
  summary: "Witness mapping unavailable.",
};

export async function runWitnessMapper(
  ctx: AgentContext,
  sink: IEventSink,
  costTracker?: CostTracker,
): Promise<WitnessMapResult> {
  try {
    const anthropic = getAnthropicClient();

    const noteFiles = ctx.caseFiles.filter(
      (f) => f.sourceType === "note" || f.sourceType === "audio",
    );
    const notesCtx =
      noteFiles.length > 0
        ? `\n\nCase notes/transcripts: ${noteFiles.map((f) => f.caption ?? f.filename).join("; ")}`
        : "";

    const jurisdictionCtx = ctx.jurisdiction
      ? `\n\nJurisdiction: ${ctx.jurisdiction.country}/${ctx.jurisdiction.region} (${ctx.jurisdiction.legalSystem}, language: ${ctx.jurisdiction.language})`
      : "";

    const userMsg = `Incident description: ${ctx.goal}${notesCtx}${jurisdictionCtx}`;

    const stream = anthropic.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      },
      { signal: ctx.signal },
    );

    let fullText = "";
    for await (const event of stream) {
      if (ctx.signal.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
      }
    }

    // Record token usage for cost tracking
    const finalMsg = await stream.finalMessage().catch(() => null);
    if (finalMsg?.usage && costTracker) {
      costTracker.record("claude-sonnet-4-6", {
        inputTokens: finalMsg.usage.input_tokens,
        outputTokens: finalMsg.usage.output_tokens,
      });
    }

    let result: WitnessMapResult;
    try {
      const cleaned = fullText.replace(/```(?:json)?\n?/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? cleaned) as WitnessMapResult;
      if (!Array.isArray(parsed.witnesses)) {
        result = FALLBACK;
      } else {
        result = {
          ...parsed,
          witnesses: parsed.witnesses.map((w, i) => ({
            id: w.id ?? `W-${String(i + 1).padStart(3, "0")}`,
            name: w.name ?? "Anonymous",
            role: w.role ?? "bystander",
            statementExcerpt: w.statementExcerpt ?? "",
            confidence: w.confidence ?? 0.5,
          })),
        };
      }
    } catch {
      result = FALLBACK;
    }

    // Emit one structured partial_result per witness (not raw JSON chunks)
    for (const witness of result.witnesses) {
      sink.emit("partial_result", {
        subagent: "WitnessMapper",
        data: {
          text: `${witness.name} (${witness.role}): ${witness.statementExcerpt}`,
          witness: toJsonb(witness),
        },
      });
    }
    if (result.summary) {
      sink.emit("partial_result", {
        subagent: "WitnessMapper",
        data: { text: result.summary },
      });
    }

    await db
      .insert(artifactsTable)
      .values({
        runId: ctx.runId,
        subagent: "WitnessMapper",
        kind: "witness_map",
        data: toJsonb(result),
      })
      .catch((err) => console.error("[WitnessMapper] db:", err));

    sink.emit("subagent_completed", { name: "WitnessMapper", data: toJsonb(result) });
    return result;
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!isAbort) {
      console.error("[WitnessMapper] error:", err);
      // Emit per-agent error event so UI can render pane-level error/retry
      sink.emit("error", {
        subagent: "WitnessMapper",
        message: `WitnessMapper failed: ${String(err).slice(0, 200)}`,
      });
    }
    sink.emit("subagent_completed", { name: "WitnessMapper", data: toJsonb(FALLBACK) });
    return FALLBACK;
  }
}
