export interface JurisdictionContext {
  country: string;
  region: string;
  language: string;
  legalSystem: string;
  confidence: number;
  statutes: string[];
}

export interface CaseFileInfo {
  id: string;
  filename: string;
  mimeType: string;
  sourceType: string | null;
  storageUrl: string;
  caption: string | null;
}

export interface AgentContext {
  caseId: string;
  runId: string;
  goal: string;
  caseFiles: CaseFileInfo[];
  jurisdiction?: JurisdictionContext;
  signal: AbortSignal;
}

export interface SceneTagResult {
  tags: string[];
  summary: string;
  confidence: number;
}

export interface WitnessEntry {
  id: string;
  name: string;
  role: "bystander" | "resident" | "employee" | "first_responder" | "victim" | "suspect";
  statementExcerpt: string;
  confidence: number;
}

export interface WitnessMapResult {
  witnesses: WitnessEntry[];
  summary: string;
}

export interface SuspectEntry {
  description: string;
  sources: string[];
  verifiedCitations: string[];
  droppedCitations?: string[];
}

export interface SuspectProfileResult {
  suspects: SuspectEntry[];
  summary: string;
  policyDrops: string[];
}
