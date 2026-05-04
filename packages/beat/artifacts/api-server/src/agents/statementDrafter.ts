import type {
  AgentContext,
  JurisdictionContext,
  SceneTagResult,
  WitnessMapResult,
  SuspectProfileResult,
} from "./types.js";
import type { IEventSink } from "../lib/eventSink.js";
import type { CostTracker } from "../lib/costTracker.js";
import { getAnthropicClient } from "../lib/aiClients.js";
import { toJsonb } from "../lib/toJsonb.js";
import { db } from "@workspace/db";
import { artifactsTable, draftsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const REPORT_SECTIONS = [
  "Case Summary",
  "Jurisdiction & Legal Framework",
  "Scene Analysis",
  "Witness Accounts",
  "Suspect Profile",
  "Evidence Summary",
  "Recommended Actions",
];

export async function runStatementDrafter(
  ctx: AgentContext,
  sink: IEventSink,
  inputs: {
    jurisdiction: JurisdictionContext;
    sceneResult: SceneTagResult;
    witnessResult: WitnessMapResult;
    suspectResult: SuspectProfileResult;
  },
  costTracker?: CostTracker,
): Promise<string> {
  const { jurisdiction, sceneResult, witnessResult, suspectResult } = inputs;

  const systemPrompt = `You are a professional incident report drafter for law enforcement.
Draft a structured markdown incident report.
Citation rules:
- Use [cite:photo-N] for scene photo evidence (SceneCaptureTagger source)
- Use [cite:witness-N] for witness statements (WitnessMapper source)
- Use [cite:suspect-N] for verified OSINT suspect data (SuspectBackground source)
- Use [cite:audio-N] for audio/transcript evidence if available
Write in formal law enforcement style. Include all required sections.`;

  const jurisdictionCtx = `${jurisdiction.country}/${jurisdiction.region} — ${jurisdiction.legalSystem} (${jurisdiction.language})`;
  const statutes =
    jurisdiction.statutes.length > 0
      ? `Applicable Statutes: ${jurisdiction.statutes.join(", ")}`
      : "Statutes: Under review";

  const photoCitations = ctx.caseFiles
    .filter((f) => f.mimeType.startsWith("image/") || f.sourceType === "photo")
    .map((f, i) => `[cite:photo-${i + 1}] ${f.caption ?? f.filename}`)
    .join("\n");

  const audioCitations = ctx.caseFiles
    .filter((f) => f.mimeType.startsWith("audio/") || f.sourceType === "audio")
    .map((f, i) => `[cite:audio-${i + 1}] ${f.caption ?? f.filename}`)
    .join("\n");

  const userContent = `**Incident Description:** ${ctx.goal}

**Jurisdiction:** ${jurisdictionCtx}
**${statutes}**

**Scene Analysis (SceneCaptureTagger) [Jurisdiction: ${jurisdictionCtx}]:**
Tags: ${sceneResult.tags.join(", ")}
${sceneResult.summary}
${photoCitations ? `Photo evidence:\n${photoCitations}` : ""}

**Witness Map (WitnessMapper) [Jurisdiction: ${jurisdictionCtx}]:**
${witnessResult.summary}
${witnessResult.witnesses
  .map(
    (w, i) =>
      `- [cite:witness-${i + 1}] ${w.name} (${w.role}, confidence=${w.confidence.toFixed(2)}): "${w.statementExcerpt}"`,
  )
  .join("\n")}
${audioCitations ? `Audio transcripts:\n${audioCitations}` : ""}

**Suspect Profile (SuspectBackground) [Verified OSINT Only]:**
${suspectResult.summary}
${suspectResult.suspects
  .map(
    (s, i) =>
      `- [cite:suspect-${i + 1}] ${s.description}` +
      (s.verifiedCitations.length > 0
        ? `\n  Verified sources: ${s.verifiedCitations.join(", ")}`
        : ""),
  )
  .join("\n")}

Draft a complete, professional incident report using the citation markers above.
Include sections: ${REPORT_SECTIONS.join(", ")}.`;

  try {
    const anthropic = getAnthropicClient();

    const stream = anthropic.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: ctx.signal },
    );

    let fullDraft = "";
    for await (const event of stream) {
      if (ctx.signal.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullDraft += text;
        sink.emit("partial_result", { subagent: "StatementDrafter", data: { text } });
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

    const wordCount = fullDraft.split(/\s+/).filter(Boolean).length;

    const artifactData = {
      title: "Incident Report",
      body: fullDraft,
      sections: REPORT_SECTIONS,
      wordCount,
      status: "complete" as const,
    };

    let artifactId: string | null = null;
    await db
      .insert(artifactsTable)
      .values({
        runId: ctx.runId,
        subagent: "StatementDrafter",
        kind: "incident_report",
        data: toJsonb(artifactData),
      })
      .returning()
      .then(([a]) => {
        artifactId = a?.id ?? null;
      })
      .catch((err) => console.error("[StatementDrafter] artifact persist:", err));

    await db
      .select()
      .from(draftsTable)
      .where(eq(draftsTable.caseId, ctx.caseId))
      .orderBy(desc(draftsTable.updatedAt))
      .limit(1)
      .then(async ([existing]) => {
        if (existing) {
          await db
            .update(draftsTable)
            .set({ body: fullDraft, artifactId, updatedAt: new Date() })
            .where(eq(draftsTable.id, existing.id));
        } else {
          await db.insert(draftsTable).values({ caseId: ctx.caseId, artifactId, body: fullDraft });
        }
      })
      .catch((err) => console.error("[StatementDrafter] draft persist:", err));

    // Protocol-aligned completion data: matches StatementDraftDataSchema
    const completionData = {
      title: "Incident Report",
      sections: REPORT_SECTIONS,
      wordCount,
      status: "complete" as const,
    };
    sink.emit("subagent_completed", { name: "StatementDrafter", data: toJsonb(completionData) });
    return fullDraft;
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!isAbort) {
      console.error("[StatementDrafter] error:", err);
      sink.emit("error", {
        subagent: "StatementDrafter",
        message: `StatementDrafter failed: ${String(err).slice(0, 200)}`,
      });
    }
    sink.emit("subagent_completed", {
      name: "StatementDrafter",
      data: { title: "Incident Report", sections: REPORT_SECTIONS, wordCount: 0, status: "error" },
    });
    return "";
  }
}
