/**
 * Re-export typed SSE event protocol from the shared agent-protocol package.
 * The canonical Zod schemas live in @workspace/agent-protocol.
 * This file provides plain TypeScript aliases for use inside api-server.
 */
export type {
  AgentName,
  JurisdictionData,
  SceneTagData,
  WitnessEntry,
  WitnessMapData,
  SuspectEntry,
  SuspectProfileData,
  StatementDraftData,
  RunStartedEvent,
  SubagentStartedEvent,
  ToolCallEvent,
  ToolResultEvent,
  PartialResultEvent,
  SubagentCompletedEvent,
  FinalResultEvent,
  ErrorEvent,
  DoneEvent,
  AnyRunEvent,
} from "@workspace/agent-protocol";
