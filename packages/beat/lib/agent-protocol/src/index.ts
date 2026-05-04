import { z } from "zod";

// ── Agent names ───────────────────────────────────────────────────────────────
export const AgentNameSchema = z.enum([
  "JurisdictionDetector",
  "SceneCaptureTagger",
  "WitnessMapper",
  "SuspectBackground",
  "StatementDrafter",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

// ── Jurisdiction ──────────────────────────────────────────────────────────────
export const JurisdictionDataSchema = z.object({
  country: z.string(),
  region: z.string(),
  legalSystem: z.string(),
  language: z.string(),
  confidence: z.number().min(0).max(1),
  statutes: z.array(z.string()),
});
export type JurisdictionData = z.infer<typeof JurisdictionDataSchema>;

// ── Scene Tags ────────────────────────────────────────────────────────────────
export const SceneTagDataSchema = z.object({
  tags: z.array(z.string()),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});
export type SceneTagData = z.infer<typeof SceneTagDataSchema>;

// ── Witness ───────────────────────────────────────────────────────────────────
export const WitnessEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["bystander", "resident", "employee", "first_responder", "victim", "suspect"]),
  statementExcerpt: z.string(),
  confidence: z.number().min(0).max(1),
});
export type WitnessEntry = z.infer<typeof WitnessEntrySchema>;

export const WitnessMapDataSchema = z.object({
  witnesses: z.array(WitnessEntrySchema),
  summary: z.string(),
});
export type WitnessMapData = z.infer<typeof WitnessMapDataSchema>;

// ── Suspect ───────────────────────────────────────────────────────────────────
export const SuspectEntrySchema = z.object({
  description: z.string(),
  sources: z.array(z.string()),
  verifiedCitations: z.array(z.string()),
  droppedCitations: z.array(z.string()).optional(),
});
export type SuspectEntry = z.infer<typeof SuspectEntrySchema>;

export const SuspectProfileDataSchema = z.object({
  suspects: z.array(SuspectEntrySchema),
  summary: z.string(),
  policyDrops: z.array(z.string()),
});
export type SuspectProfileData = z.infer<typeof SuspectProfileDataSchema>;

// ── Statement Draft ───────────────────────────────────────────────────────────
export const StatementDraftDataSchema = z.object({
  title: z.string(),
  sections: z.array(z.string()),
  wordCount: z.number().int().nonnegative(),
  status: z.enum(["complete", "error", "cancelled"]),
});
export type StatementDraftData = z.infer<typeof StatementDraftDataSchema>;

// ── Tool call/result events ───────────────────────────────────────────────────
export const ToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
});

export const ToolResultSchema = z.object({
  name: z.string(),
  result: z.unknown(),
});

// ── Base event ────────────────────────────────────────────────────────────────
const BaseEventSchema = z.object({
  idx: z.number().int().nonnegative(),
  eventType: z.string(),
});

// ── Individual event schemas ──────────────────────────────────────────────────
export const RunStartedEventSchema = BaseEventSchema.extend({
  eventType: z.literal("run_started"),
  runId: z.string(),
  caseId: z.string(),
});
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

export const SubagentStartedEventSchema = BaseEventSchema.extend({
  eventType: z.literal("subagent_started"),
  name: AgentNameSchema,
});
export type SubagentStartedEvent = z.infer<typeof SubagentStartedEventSchema>;

export const ToolCallEventSchema = BaseEventSchema.extend({
  eventType: z.literal("tool_call"),
  subagent: AgentNameSchema,
  tool: ToolCallSchema,
});
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

export const ToolResultEventSchema = BaseEventSchema.extend({
  eventType: z.literal("tool_result"),
  subagent: AgentNameSchema,
  tool: ToolResultSchema,
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const PartialResultEventSchema = BaseEventSchema.extend({
  eventType: z.literal("partial_result"),
  subagent: AgentNameSchema,
  data: z.record(z.unknown()),
});
export type PartialResultEvent = z.infer<typeof PartialResultEventSchema>;

export const SubagentCompletedEventSchema = BaseEventSchema.extend({
  eventType: z.literal("subagent_completed"),
  name: AgentNameSchema,
  data: z.record(z.unknown()),
});
export type SubagentCompletedEvent = z.infer<typeof SubagentCompletedEventSchema>;

export const FinalResultEventSchema = BaseEventSchema.extend({
  eventType: z.literal("final_result"),
  runId: z.string(),
  data: z.record(z.unknown()),
});
export type FinalResultEvent = z.infer<typeof FinalResultEventSchema>;

export const ErrorEventSchema = BaseEventSchema.extend({
  eventType: z.literal("error"),
  subagent: AgentNameSchema.optional(),
  message: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const DoneEventSchema = BaseEventSchema.extend({
  eventType: z.literal("done"),
  runId: z.string(),
  totalEvents: z.number().int().nonnegative(),
});
export type DoneEvent = z.infer<typeof DoneEventSchema>;

// ── Union of all events ───────────────────────────────────────────────────────
export const AnyRunEventSchema = z.discriminatedUnion("eventType", [
  RunStartedEventSchema,
  SubagentStartedEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  PartialResultEventSchema,
  SubagentCompletedEventSchema,
  FinalResultEventSchema,
  ErrorEventSchema,
  DoneEventSchema,
]);
export type AnyRunEvent = z.infer<typeof AnyRunEventSchema>;
