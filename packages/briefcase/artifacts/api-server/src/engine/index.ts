/**
 * Engine Tier S barrel — every subagent imports from here so the
 * call-site is one line: `import { callLLM, runWithProgress } from "../engine"`.
 */
export { callLLM, finalizeRunDecisions, type CallLLMArgs, type CallLLMResult } from "./llm";
export { runWithProgress, type RunWithProgressArgs } from "./streamingTools";
export type { TaskKind } from "./modelRouter";
export {
  start as startCostMeter,
  stop as stopCostMeter,
  record as recordCost,
  snapshot as snapshotCost,
  type CostSnapshot,
} from "./costMeter";
export { snapshotStats as snapshotCacheStats, type CacheStatsSnapshot } from "./semanticCache";
export { applyGate, evaluateDefenderArtifact, type GateContext, type GateResult } from "./constitutionalGate";
export { judgeArtifact, markRetried, DEFAULT_THRESHOLD, type JudgeOutcome } from "./qualityJudge";
export {
  withRetry,
  getReformulation,
  setReformulation,
  clearReformulation,
  RetryExhaustedError,
  type RetryArgs,
  type RetryOutcome,
  type RetryResult,
  type RetryAttemptRecord,
} from "./retryPolicy";
export { initOtelExporter } from "./otelInit";
export {
  startGuardrail,
  stopGuardrail,
  checkGuardrail,
  shouldDegrade,
  type GuardrailDecision,
  type GuardrailState,
} from "./costGuardrail";
export { withSpan, snapshotTrace, dropTrace, scheduleDrop, type RecordedSpan } from "./tracing";
export { buildAuditBundle, verifyManifest } from "./auditBundle";
// G23 Engine Extensions
export {
  loadPrompt,
  recordPromptOutcome,
  listVersions as listPromptVersions,
  activateVersion as activatePromptVersion,
  type LoadedPrompt,
  type PromptVersionRow,
  type PromptMetrics,
} from "./promptRegistry";
export {
  recordSubagentOutcome,
  proposeSkips,
  clearCaseHistory,
} from "./adaptivePlanner";
export {
  postMessage as postAgentMessage,
  subscribe as subscribeAgentBus,
  listMessages as listAgentMessages,
  type AgentBusMessage,
} from "./agentMessageBus";
export {
  verifyWithBank,
  verifyUrlCitation,
  type SourceType,
  type VerifyArgs,
  type BankVerifyResult,
} from "./verifierBank";
export {
  maybeSaveDemoRun,
  listReplayCases,
  runReplay,
  type ReplayCaseSummary,
  type ReplayRunResult,
} from "./replayHarness";
export {
  publishObjection,
  subscribeObjections,
  snapshotObjections,
  dropCourtroomSession,
  activeCourtroomCount,
  type ObjectionEventPayload,
} from "./courtroomBus";
export {
  pushSignal as webrtcPushSignal,
  pullSignals as webrtcPullSignals,
  subscribe as webrtcSubscribe,
  dropSession as webrtcDropSession,
  activeSessionCount as webrtcActiveSessionCount,
  type SignalEnvelope as WebRtcSignalEnvelope,
} from "./webrtcGateway";
