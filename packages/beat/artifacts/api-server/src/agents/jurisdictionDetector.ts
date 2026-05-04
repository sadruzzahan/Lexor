import type { AgentContext, JurisdictionContext } from "./types.js";
import type { IEventSink } from "../lib/eventSink.js";
import type { CostTracker } from "../lib/costTracker.js";
import { getGeminiClient } from "../lib/aiClients.js";
import { toJsonb } from "../lib/toJsonb.js";
import { db } from "@workspace/db";
import { casesTable, artifactsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const SYSTEM_PROMPT = `You are a legal jurisdiction detector for law enforcement investigation reports.
Given an incident description, identify the applicable jurisdiction.
You MUST respond with valid JSON only, no markdown, no explanation.
JSON schema:
{
  "country": "ISO 3166-1 alpha-2 code (e.g. US)",
  "region": "State/province abbreviation or name",
  "legalSystem": "common_law|civil_law|mixed",
  "language": "BCP-47 language tag (e.g. en, es)",
  "confidence": 0.0-1.0,
  "statutes": ["list of 1-3 most relevant statute codes for this type of incident"]
}`;

const FALLBACK: JurisdictionContext = {
  country: "US",
  region: "CA",
  language: "en",
  legalSystem: "common_law",
  confidence: 0.5,
  statutes: [],
};

export async function runJurisdictionDetector(
  ctx: AgentContext,
  sink: IEventSink,
  costTracker?: CostTracker,
): Promise<JurisdictionContext> {
  try {
    const ai = getGeminiClient();

    const responsePromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: `Incident description:\n\n${ctx.goal}` }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 512,
      },
    });

    const response = await Promise.race([
      responsePromise,
      new Promise<never>((_, reject) => {
        if (ctx.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        ctx.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    ]);

    if (response.usageMetadata && costTracker) {
      costTracker.record("gemini-2.5-flash", {
        inputTokens: response.usageMetadata.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
      });
    }

    const text = response.text ?? "{}";
    let result: JurisdictionContext;
    try {
      const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as JurisdictionContext;
      result = parsed.country ? parsed : FALLBACK;
    } catch {
      result = FALLBACK;
    }

    sink.emit("partial_result", { subagent: "JurisdictionDetector", data: toJsonb(result) });

    await Promise.all([
      db
        .update(casesTable)
        .set({ jurisdictionContext: toJsonb(result) })
        .where(eq(casesTable.id, ctx.caseId)),
      db.insert(artifactsTable).values({
        runId: ctx.runId,
        subagent: "JurisdictionDetector",
        kind: "jurisdiction",
        data: toJsonb(result),
      }),
    ]).catch((err) => console.error("[JurisdictionDetector] db:", err));

    sink.emit("subagent_completed", { name: "JurisdictionDetector", data: toJsonb(result) });
    return result;
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!isAbort) {
      console.error("[JurisdictionDetector] error:", err);
      sink.emit("error", {
        subagent: "JurisdictionDetector",
        message: `JurisdictionDetector failed: ${String(err).slice(0, 200)}`,
      });
    }
    sink.emit("subagent_completed", { name: "JurisdictionDetector", data: toJsonb(FALLBACK) });
    return FALLBACK;
  }
}
