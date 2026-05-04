/**
 * MockJurySimulator (G13) — twelve synthetic jurors reason in parallel over
 * the defense theory + case context using GPT-5 mini, then a deliberation
 * aggregator merges their positions into a verdict distribution. Personas
 * come from `juryPersonaBank` and are LABELED SYNTHETIC; this is a
 * rehearsal tool, never a model of real jurors.
 *
 * Output shape:
 *   JurySimulation = { jurors[], deliberation, verdictDistribution }
 *
 * Runs only on user request (the planner does NOT include this in the
 * baseline pack — see routes/runs.ts on-demand subagent endpoint).
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { logger } from "../../lib/logger";
import {
  juryPersonaBank,
  type JuryPersona,
} from "../../tools/juryPersonaBank";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";

const JurorSchema = z.object({
  initialLean: z.enum(["acquit", "convict", "undecided"]),
  confidence: z.number().min(0).max(1),
  keyConcern: z
    .string()
    .describe("One sentence on what most influenced this juror."),
  reactionToDefense: z.string(),
  reactionToProsecution: z.string(),
});

const DeliberationSchema = z.object({
  finalVerdict: z.enum(["acquit", "convict", "hung"]),
  rationale: z.string(),
  keyTurningPoints: z.array(z.string()),
  defenseStrengths: z.array(z.string()),
  defenseWeaknesses: z.array(z.string()),
});

export interface JurySimulationArtifact {
  kind: "JurySimulation";
  venue: string;
  jurors: Array<{
    persona: JuryPersona;
    initialLean: "acquit" | "convict" | "undecided";
    confidence: number;
    keyConcern: string;
    reactionToDefense: string;
    reactionToProsecution: string;
  }>;
  deliberation: {
    finalVerdict: "acquit" | "convict" | "hung";
    rationale: string;
    keyTurningPoints: string[];
    defenseStrengths: string[];
    defenseWeaknesses: string[];
  };
  verdictDistribution: {
    acquit: number;
    convict: number;
    undecided: number;
  };
  /** Surfaced verbatim in the UI so the synthetic nature is never hidden. */
  disclaimer: string;
  priority: number;
  language: string;
}

const DISCLAIMER =
  "Synthetic jurors generated for rehearsal only. Not a prediction of any real jury's behavior.";

function summarizeFiles(parsedFiles: ParsedPdf[], maxChars = 6000): string {
  const bundle = parsedFiles
    .map((f) => `### ${f.fileName}\n${f.markdown.slice(0, 2400)}`)
    .join("\n\n");
  return bundle.slice(0, maxChars);
}

async function simulateOneJuror(
  persona: JuryPersona,
  caseSummary: string,
  goal: string,
  language: string,
  runId: string | undefined,
  emit: SubagentEmit,
): Promise<z.infer<typeof JurorSchema>> {
  const prompt = `You are roleplaying a synthetic juror for a criminal-defense rehearsal.
PERSONA (synthetic — not a real person):
- Age band: ${persona.ageBand}
- Occupation family: ${persona.occupationFamily}
- Lived experience anchor: ${persona.livedExperienceAnchor}
- Prior trust in system: ${persona.priorTrustInSystem}
- Decision style: ${persona.decisionStyle}

DEFENSE GOAL: ${goal}

CASE EXCERPTS:
${caseSummary}

Output language: ${language}.

After reading the case excerpts, return your initial lean (before
deliberation), your confidence in that lean (0-1), the single concern
that most shaped your view, and one-sentence reactions to the defense
and prosecution narratives. Stay in character; avoid stereotypes;
focus on what THIS persona would notice given their decision style.`;
  try {
    const { object } = await callLLM({
      taskKind: "personas",
      schema: JurorSchema,
      prompt,
      temperature: 0.7,
      runId,
      subagent: "MockJurySimulator",
      emit,
    });
    return object;
  } catch (err) {
    logger.warn({ err, persona: persona.id }, "Juror simulation failed");
    return {
      initialLean: "undecided",
      confidence: 0,
      keyConcern: "Model error — juror could not deliberate.",
      reactionToDefense: "(unavailable)",
      reactionToProsecution: "(unavailable)",
    };
  }
}

export async function runMockJurySimulator(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<JurySimulationArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const venue = ctx.jurisdictionContext.country;
  const personas = juryPersonaBank({ venue, count: 12 });
  const caseSummary = summarizeFiles(ctx.parsedFiles);

  await emit({
    type: "tool_call",
    tool: "juryPersonaBank",
    args: { venue, count: 12 },
    status: "running",
  });
  await emit({
    type: "tool_result",
    tool: "juryPersonaBank",
    resultPreview: `12 synthetic personas seeded for ${venue}`,
  });

  await emit({
    type: "partial_result",
    data: {
      stage: "individual-deliberation",
      personas: personas.length,
      disclaimer: DISCLAIMER,
      priority: 0.55,
    },
  });

  const jurorVerdicts = await Promise.all(
    personas.map(async (p) => {
      await emit({
        type: "tool_call",
        tool: "simulateJuror",
        args: { personaId: p.id },
        status: "running",
      });
      const v = await simulateOneJuror(
        p,
        caseSummary,
        ctx.goal,
        language,
        ctx.runId,
        emit,
      );
      await emit({
        type: "tool_result",
        tool: "simulateJuror",
        resultPreview: `${p.displayName}: ${v.initialLean} (${v.confidence.toFixed(2)})`,
      });
      return { persona: p, ...v };
    }),
  );

  const distribution = jurorVerdicts.reduce(
    (acc, j) => {
      if (j.initialLean === "acquit") acc.acquit += 1;
      else if (j.initialLean === "convict") acc.convict += 1;
      else acc.undecided += 1;
      return acc;
    },
    { acquit: 0, convict: 0, undecided: 0 },
  );

  await emit({
    type: "partial_result",
    data: {
      stage: "deliberation-aggregator",
      distribution,
      disclaimer: DISCLAIMER,
      priority: 0.65,
    },
  });

  // Deliberation aggregator — synthesizes the 12 individual stances into a
  // single rationale + verdict + strengths/weaknesses.
  const stancesBundle = jurorVerdicts
    .map(
      (j) =>
        `- ${j.persona.displayName} (${j.persona.decisionStyle}, ${j.persona.priorTrustInSystem} trust): ${j.initialLean} @ ${j.confidence.toFixed(2)}\n  concern: ${j.keyConcern}`,
    )
    .join("\n");
  const aggregatorPrompt = `You are the deliberation aggregator for a synthetic-jury rehearsal.
12 synthetic jurors have shared their initial stance. Decide the most
likely deliberated verdict (acquit | convict | hung), explain the
rationale in 2-4 sentences, and surface the key turning points the
defense should rehearse against. Then list defense strengths and
weaknesses each in 1-3 short bullets.

INITIAL STANCES:
${stancesBundle}

DISTRIBUTION: acquit=${distribution.acquit}, convict=${distribution.convict}, undecided=${distribution.undecided}

CASE SUMMARY:
${caseSummary.slice(0, 4000)}

Output language: ${language}.`;

  let deliberation: z.infer<typeof DeliberationSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "personas",
      schema: DeliberationSchema,
      prompt: aggregatorPrompt,
      temperature: 0.4,
      runId: ctx.runId,
      subagent: "MockJurySimulator",
      emit,
    });
    deliberation = object;
  } catch (err) {
    logger.warn({ err }, "Deliberation aggregator failed");
    // Fallback: derive a verdict from the raw distribution so the UI is
    // never empty even when the aggregator LLM is down.
    const verdict =
      distribution.acquit > distribution.convict + 1
        ? "acquit"
        : distribution.convict > distribution.acquit + 1
          ? "convict"
          : "hung";
    deliberation = {
      finalVerdict: verdict,
      rationale:
        "Aggregator unavailable; verdict inferred from initial distribution.",
      keyTurningPoints: [],
      defenseStrengths: [],
      defenseWeaknesses: [],
    };
  }

  return {
    artifact: {
      kind: "JurySimulation",
      venue,
      jurors: jurorVerdicts,
      deliberation,
      verdictDistribution: distribution,
      disclaimer: DISCLAIMER,
      priority: 0.7,
      language,
    },
  };
}
