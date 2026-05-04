/**
 * Vercel AI SDK 5 provider factories wired through the Replit AI Integrations
 * proxy. Each provider's BASE_URL + API_KEY are injected at process start by
 * `setupReplitAIIntegrations` (see ai-integrations-{anthropic,openai,gemini}
 * skills). We construct one provider instance per process; per-call usage
 * accounting will be layered on top by CostMeter (G21).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

function need(envVar: string): string {
  const v = process.env[envVar];
  if (!v) {
    throw new Error(
      `Missing ${envVar}. Re-run setupReplitAIIntegrations for the missing provider.`,
    );
  }
  return v;
}

export const anthropicProvider = createAnthropic({
  baseURL: need("AI_INTEGRATIONS_ANTHROPIC_BASE_URL"),
  apiKey: need("AI_INTEGRATIONS_ANTHROPIC_API_KEY"),
});

export const openaiProvider = createOpenAI({
  baseURL: need("AI_INTEGRATIONS_OPENAI_BASE_URL"),
  apiKey: need("AI_INTEGRATIONS_OPENAI_API_KEY"),
});

export const geminiProvider = createGoogleGenerativeAI({
  baseURL: need("AI_INTEGRATIONS_GEMINI_BASE_URL"),
  apiKey: need("AI_INTEGRATIONS_GEMINI_API_KEY"),
});

/**
 * Per-task model routing per spec §9.7.A. Centralized so swapping a model
 * (e.g. provider outage) only touches this file.
 */
export const MODELS = {
  planner: () => anthropicProvider("claude-sonnet-4-6"),
  jurisdictionDetector: () => openaiProvider("gpt-5-mini"),
  timelineBuilder: () => anthropicProvider("claude-sonnet-4-6"),
  evidenceGapAuditor: () => anthropicProvider("claude-sonnet-4-6"),
  crossExaminationGenerator: () => anthropicProvider("claude-sonnet-4-6"),
  precedentFinder: () => anthropicProvider("claude-sonnet-4-6"),
  contradictionEngine: () => anthropicProvider("claude-sonnet-4-6"),
  rightsAuditor: () => anthropicProvider("claude-sonnet-4-6"),
  bradyDetector: () => anthropicProvider("claude-sonnet-4-6"),
  mockJurySimulator: () => openaiProvider("gpt-5-mini"),
  pleaOutcomeSimulator: () => openaiProvider("gpt-5-mini"),
  prosecutionSimulator: () => anthropicProvider("claude-sonnet-4-6"),
  extractEntities: () => geminiProvider("gemini-3-flash-preview"),
} as const;
