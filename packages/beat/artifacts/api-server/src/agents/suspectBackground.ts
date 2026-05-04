import type { AgentContext, SuspectProfileResult } from "./types.js";
import type { IEventSink } from "../lib/eventSink.js";
import type { CostTracker } from "../lib/costTracker.js";
import { getAnthropicClient } from "../lib/aiClients.js";
import { verifyCitations } from "../lib/citationVerifier.js";
import { toJsonb } from "../lib/toJsonb.js";
import { db } from "@workspace/db";
import { artifactsTable, policyDropsTable } from "@workspace/db/schema";

const SYSTEM_PROMPT = `You are a suspect background analysis AI for law enforcement.
Build a suspect profile from the incident description and any OSINT results provided.

Return JSON only (no code fences, no markdown):
{
  "suspects": [
    {
      "description": "Behavioral/physical description inferred from incident patterns",
      "sources": ["Descriptive category names for data sources used"],
      "citationCandidates": [
        { "url": "https://...", "title": "Title from OSINT result", "snippet": "Key quote from result" }
      ]
    }
  ],
  "summary": "2-3 sentence suspect profile summary"
}
Only include URLs that were provided to you in the OSINT results. Do NOT invent URLs.`;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

async function tavilySearch(query: string, signal: AbortSignal): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const { tavily } = await import("@tavily/core");
    const client = tavily({ apiKey });

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });

    const searchPromise = client.search(query, { searchDepth: "basic", maxResults: 5 });
    const response = await Promise.race([searchPromise, abortPromise]);
    return (response.results ?? [])
      .filter((r: TavilyResult) => (r.score ?? 1) > 0.5)
      .slice(0, 4) as TavilyResult[];
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return [];
    console.warn("[SuspectBackground] Tavily search error:", String(err).slice(0, 100));
    return [];
  }
}

interface LLMSuspectEntry {
  description?: string;
  sources?: string[];
  citationCandidates?: Array<{ url: string; title: string; snippet: string }>;
}

interface LLMSuspectOutput {
  suspects?: LLMSuspectEntry[];
  summary?: string;
}

const FALLBACK: SuspectProfileResult = {
  suspects: [],
  summary: "Suspect background analysis unavailable.",
  policyDrops: [],
};

export async function runSuspectBackground(
  ctx: AgentContext,
  sink: IEventSink,
  costTracker?: CostTracker,
): Promise<SuspectProfileResult> {
  try {
    const anthropic = getAnthropicClient();

    sink.emit("tool_call", {
      subagent: "SuspectBackground",
      tool: { name: "tavilySearch", args: { query: ctx.goal.slice(0, 80) } },
    });

    const osintResults = await tavilySearch(
      `${ctx.goal} suspect incident prior record public`,
      ctx.signal,
    );

    sink.emit("tool_result", {
      subagent: "SuspectBackground",
      tool: { name: "tavilySearch", result: { count: osintResults.length } },
    });

    const osintContext =
      osintResults.length > 0
        ? `\n\nOSINT search results:\n${osintResults
            .map(
              (r, i) =>
                `[${i + 1}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.content.slice(0, 300)}`,
            )
            .join("\n\n")}`
        : "";

    const jurisdictionCtx = ctx.jurisdiction
      ? `\n\nJurisdiction: ${ctx.jurisdiction.country}/${ctx.jurisdiction.region} (${ctx.jurisdiction.legalSystem}, language: ${ctx.jurisdiction.language})${
          ctx.jurisdiction.statutes.length > 0
            ? `\nApplicable statutes: ${ctx.jurisdiction.statutes.join(", ")}`
            : ""
        }`
      : "";

    const stream = anthropic.messages.stream(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `Incident: ${ctx.goal}${jurisdictionCtx}${osintContext}` },
        ],
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

    if (ctx.signal.aborted) {
      sink.emit("subagent_completed", {
        name: "SuspectBackground",
        data: toJsonb({ suspects: [], summary: FALLBACK.summary, policyDrops: [] }),
      });
      return FALLBACK;
    }

    let llmOutput: LLMSuspectOutput;
    try {
      const cleaned = fullText.replace(/```(?:json)?\n?/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      llmOutput = JSON.parse(jsonMatch?.[0] ?? cleaned) as LLMSuspectOutput;
    } catch {
      llmOutput = { suspects: [], summary: "Could not parse suspect analysis." };
    }

    const allPolicyDrops: string[] = [];
    const policyDropRows: Array<{
      runId: string;
      subagent: string;
      url: string;
      title: string;
      reason: string;
    }> = [];

    const verifiedSuspects: SuspectProfileResult["suspects"] = await Promise.all(
      (llmOutput.suspects ?? []).map(async (suspect) => {
        const candidates = (suspect.citationCandidates ?? []).filter(
          (c) => c.url && c.url.startsWith("http"),
        );

        if (candidates.length > 0) {
          sink.emit("tool_call", {
            subagent: "SuspectBackground",
            tool: { name: "verifyCitation", args: { count: candidates.length } },
          });

          const { verified, dropped } = await verifyCitations(candidates, ctx.signal);

          sink.emit("tool_result", {
            subagent: "SuspectBackground",
            tool: {
              name: "verifyCitation",
              result: { verified: verified.length, dropped: dropped.length },
            },
          });

          // Persist dropped citations to server-side audit table only
          for (const d of dropped) {
            allPolicyDrops.push(`${d.title}: ${d.reason}`);
            policyDropRows.push({
              runId: ctx.runId,
              subagent: "SuspectBackground",
              url: d.url,
              title: d.title,
              reason: d.reason,
            });
          }

          return {
            description: suspect.description ?? "",
            sources: suspect.sources ?? [],
            verifiedCitations: verified.map((v) => `[cite:${v.title}] ${v.url}`),
          };
        }

        return {
          description: suspect.description ?? "",
          sources: suspect.sources ?? [],
          verifiedCitations: [],
        };
      }),
    );

    const result: SuspectProfileResult = {
      suspects: verifiedSuspects,
      summary: llmOutput.summary ?? FALLBACK.summary,
      policyDrops: allPolicyDrops,
    };

    sink.emit("partial_result", {
      subagent: "SuspectBackground",
      data: { text: result.summary },
    });

    await Promise.all([
      db
        .insert(artifactsTable)
        .values({
          runId: ctx.runId,
          subagent: "SuspectBackground",
          kind: "suspect_profile",
          data: toJsonb(result),
        })
        .catch((err) => console.error("[SuspectBackground] artifact persist:", err)),
      policyDropRows.length > 0
        ? db
            .insert(policyDropsTable)
            .values(policyDropRows)
            .catch((err) => console.error("[SuspectBackground] policy_drops persist:", err))
        : Promise.resolve(),
    ]);

    // Client-safe payload: verified citations only, policyDrops as empty array
    // (actual drops are in the server-side policy_drops table, not client events)
    const clientPayload = {
      suspects: result.suspects.map((s) => ({
        description: s.description,
        sources: s.sources,
        verifiedCitations: s.verifiedCitations,
      })),
      summary: result.summary,
      policyDrops: [] as string[],
    };

    sink.emit("subagent_completed", {
      name: "SuspectBackground",
      data: toJsonb(clientPayload),
    });
    return result;
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!isAbort) {
      console.error("[SuspectBackground] error:", err);
      sink.emit("error", {
        subagent: "SuspectBackground",
        message: `SuspectBackground failed: ${String(err).slice(0, 200)}`,
      });
    }
    sink.emit("subagent_completed", {
      name: "SuspectBackground",
      data: toJsonb({ suspects: [], summary: FALLBACK.summary, policyDrops: [] }),
    });
    return FALLBACK;
  }
}
