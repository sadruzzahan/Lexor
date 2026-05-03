/**
 * Thin API helpers for the lexor-web client. We bypass the generated
 * client for the upload + finalize + SSE flow because:
 *  - presigned PUT is not part of the OpenAPI spec
 *  - SSE is browser-native via EventSource
 *
 * All calls go through the shared proxy at the artifact's base path.
 */
// The api-server is mounted at /api by the global proxy regardless of
// the web artifact's BASE_URL prefix — never include the artifact base
// here or you get 404s for /lexor/api/...
const API = "/api/counsel";

export interface CreateCaseResponse {
  caseId: string;
  uploadURL: string | null;
  objectPath: string | null;
}

export async function createCase(opts?: {
  language?: string;
  jurisdictionHint?: string | null;
}): Promise<CreateCaseResponse> {
  const r = await fetch(`${API}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!r.ok) throw new Error(`createCase failed: ${r.status}`);
  return r.json();
}

export async function uploadToPresignedUrl(
  url: string,
  file: Blob,
  contentType: string,
): Promise<void> {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
}

export async function finalizeCase(
  caseId: string,
  objectPath: string,
  rawDocumentHash: string,
): Promise<unknown> {
  const r = await fetch(`${API}/cases/${caseId}/finalize`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectPath, rawDocumentHash }),
  });
  if (!r.ok) throw new Error(`finalize failed: ${r.status}`);
  return r.json();
}

export interface CaseRow {
  id: string;
  status: string;
  vertical: string;
  jurisdiction: string | null;
  parsed: unknown;
  violations: Violation[] | null;
  responseLetter: ResponseLetter | null;
  regulatorComplaints: RegulatorComplaint[] | null;
  adversaryEntityId: string | null;
}

export type EntityKind = "landlord" | "employer" | "debt_collector" | "unknown";

export interface DossierDefense {
  id: string;
  title: string;
  summary: string;
  citation: string;
  citationUrl: string;
  successRate?: string | null;
  bodyParagraph: string;
}

export interface DossierTimelineEvent {
  date: string;
  label: string;
  kind: "lawsuit" | "settlement" | "consent_order" | "sanction" | "press";
  url?: string | null;
}

export interface DossierSanction {
  year: number;
  agency: string;
  amountUsd?: number | null;
  summary: string;
  url?: string | null;
}

export interface DossierLitigationStats {
  totalCases: number;
  asPlaintiff: number;
  asDefendant: number;
  winRatePctAsDefendant: number;
  sanctions: DossierSanction[];
  commonViolations: string[];
}

export interface DossierOtherCase {
  vertical: string;
  jurisdiction: string | null;
  createdAt: string;
}

export interface AdversaryDossier {
  entityId: string;
  displayName: string;
  normalizedName: string;
  kind: EntityKind;
  jurisdictions: string[];
  alternateNames: string[];
  registrationData: Record<string, unknown> | null;
  litigationStats: DossierLitigationStats;
  defensesThatWorked: DossierDefense[];
  timeline: DossierTimelineEvent[];
  otherCases: DossierOtherCase[];
  otherCasesTotal: number;
  source: "curated" | "ai_estimated" | "empty";
  sourceNote: string;
  lastRefreshedAt: string | null;
}

export async function getAdversary(
  entityId: string,
  opts: { excludeCaseId?: string } = {},
): Promise<AdversaryDossier> {
  const qs = opts.excludeCaseId ? `?excludeCaseId=${encodeURIComponent(opts.excludeCaseId)}` : "";
  const r = await fetch(`${API}/adversary/${entityId}${qs}`);
  if (!r.ok) throw new Error(`getAdversary failed: ${r.status}`);
  return r.json();
}

export interface EntitySearchResult {
  id: string | null;
  slug: string;
  displayName: string;
  kind: EntityKind;
  jurisdictions: string[];
  alternateNames: string[];
}

export async function searchAdversary(
  q: string,
): Promise<EntitySearchResult[]> {
  const r = await fetch(`${API}/adversary/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`searchAdversary failed: ${r.status}`);
  const j = (await r.json()) as { results: EntitySearchResult[] };
  return j.results;
}

export interface Violation {
  code: string;
  statute: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  citationUrl: string;
  agency: string | null;
}

export interface ResponseLetter {
  subject: string;
  plainText: string;
  html: string;
  deliveryHints: string[];
  strippedCitations?: string[];
}

export interface RegulatorComplaint {
  agency: string;
  agencyLabel: string;
  filingUrl: string;
  tier?: 1 | 2;
  filingMode?: "guided-portal" | "pdf-and-deeplink";
  draftHtml: string;
  draftPlainText: string;
  steps: string[];
  status: string;
  strippedCitations?: string[];
}

export async function getCase(caseId: string): Promise<CaseRow> {
  const r = await fetch(`${API}/cases/${caseId}`);
  if (!r.ok) throw new Error(`getCase failed: ${r.status}`);
  return r.json();
}

export function eventStreamUrl(caseId: string): string {
  return `${API}/cases/${caseId}/events`;
}

/**
 * Smoke-test path: instead of uploading a real image, post the raw
 * letter text. The api-server understands a "/text/<base64>" sentinel on
 * the case row and skips object storage. Used by the synthetic fixture
 * runner and by the "Try a sample" button on the upload page.
 */
export interface MapMarkerCell {
  id: string;
  entityId: string;
  caseVertical: string;
  coarseLat: number;
  coarseLng: number;
  count: number;
}

export interface MapStats {
  totalMarkers: number;
  weekMarkers: number;
  topEntities: Array<{
    entityId: string;
    displayName: string;
    pinCount: number;
    kind: EntityKind;
  }>;
  byVertical: Array<{ vertical: string; count: number }>;
}

export interface MapEntityRollup {
  id: string;
  displayName: string;
  kind: EntityKind;
  jurisdictions: string[];
  pinCount: number;
  caseCount: number;
  topVertical: string | null;
}

export async function getMapMarkers(opts: {
  vertical?: string | null;
  sinceDays?: number | null;
  violation?: string | null;
  bbox?: [number, number, number, number] | null;
  entityId?: string | null;
} = {}): Promise<MapMarkerCell[]> {
  const qs = new URLSearchParams();
  if (opts.vertical) qs.set("vertical", opts.vertical);
  if (opts.sinceDays) qs.set("sinceDays", String(opts.sinceDays));
  if (opts.violation) qs.set("violation", opts.violation);
  if (opts.bbox) qs.set("bbox", opts.bbox.join(","));
  if (opts.entityId) qs.set("entityId", opts.entityId);
  const r = await fetch(`${API}/map/markers?${qs}`);
  if (!r.ok) throw new Error(`getMapMarkers failed: ${r.status}`);
  const j = (await r.json()) as { markers: MapMarkerCell[] };
  return j.markers;
}

export async function getMapStats(): Promise<MapStats> {
  const r = await fetch(`${API}/map/stats`);
  if (!r.ok) throw new Error(`getMapStats failed: ${r.status}`);
  return r.json();
}

export async function getMapEntityRollup(
  id: string,
): Promise<MapEntityRollup> {
  const r = await fetch(`${API}/map/entity/${id}`);
  if (!r.ok) throw new Error(`getMapEntityRollup failed: ${r.status}`);
  return r.json();
}

export interface VoiceInfo {
  phoneNumber: string | null;
  whatsappNumber: string | null;
  languages: Array<{ code: string; label: string }>;
  spokenDisclaimer: Record<string, string>;
  configured: boolean;
}

export async function getVoiceInfo(): Promise<VoiceInfo> {
  const r = await fetch(`${API}/voice/info`);
  if (!r.ok) throw new Error(`getVoiceInfo failed: ${r.status}`);
  return r.json();
}

export interface VoiceUploadToken {
  caseId: string;
  uploadURL: string;
  objectPath: string;
}

export async function getVoiceUploadToken(
  token: string,
): Promise<VoiceUploadToken> {
  const r = await fetch(`${API}/voice/upload-token/${token}`);
  if (!r.ok) throw new Error(`getVoiceUploadToken failed: ${r.status}`);
  return r.json();
}

export async function completeVoiceUpload(
  token: string,
  objectPath: string,
  rawDocumentHash: string,
): Promise<void> {
  const r = await fetch(`${API}/voice/upload-token/${token}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectPath, rawDocumentHash }),
  });
  if (!r.ok) throw new Error(`completeVoiceUpload failed: ${r.status}`);
}

export async function createTextCase(letterText: string): Promise<string> {
  const r = await fetch(`${API}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inlineText: letterText }),
  });
  if (!r.ok) throw new Error(`text case failed: ${r.status}`);
  const j = (await r.json()) as { caseId: string };
  return j.caseId;
}

// ────────────────────────────────────────────────────────────────────
// Coalitions (Feature 5)
// ────────────────────────────────────────────────────────────────────

export type CoalitionStatus = "forming" | "open" | "matched" | "closed";

export interface CoalitionListItem {
  id: string;
  entityId: string;
  entityName: string | null;
  vertical: string;
  jurisdiction: string | null;
  caseCount: number;
  status: CoalitionStatus;
  createdAt: string;
}

export interface CoalitionMemberAnon {
  label: string;
  jurisdiction: string;
  vertical: string;
  hasOptedIn: boolean;
  joinedAt: string;
}

export interface CoalitionBid {
  id: string;
  coalitionId: string;
  lawyerName: string;
  lawyerBarNumber: string;
  lawyerEmail: string;
  lawyerFirm: string | null;
  contingencyPercent: string;
  notes: string | null;
  createdAt: string;
  voteCount: number;
}

export interface CoalitionDetail extends CoalitionListItem {
  classComplaintDraftHtml: string | null;
  members: CoalitionMemberAnon[];
  optedInCount: number;
  bids: CoalitionBid[];
  disclaimerVersion: string;
}

export interface CaseCoalition {
  id: string;
  hasOptedIn: boolean;
  status: CoalitionStatus;
  entityName: string | null;
  caseCount: number;
}

export async function listCoalitions(): Promise<CoalitionListItem[]> {
  const r = await fetch(`${API}/coalitions`);
  if (!r.ok) throw new Error(`listCoalitions failed: ${r.status}`);
  const j = (await r.json()) as { coalitions: CoalitionListItem[] };
  return j.coalitions;
}

export async function getCoalition(id: string): Promise<CoalitionDetail> {
  const r = await fetch(`${API}/coalitions/${id}`);
  if (!r.ok) throw new Error(`getCoalition failed: ${r.status}`);
  return r.json();
}

export async function getCoalitionForCase(
  caseId: string,
): Promise<CaseCoalition | null> {
  const r = await fetch(`${API}/coalitions/by-case/${caseId}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { coalition: CaseCoalition | null };
  return j.coalition;
}

export async function joinCoalition(
  coalitionId: string,
  caseId: string,
  disclosureVersion: string,
): Promise<void> {
  const r = await fetch(`${API}/coalitions/${coalitionId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, hasOptedIn: true, disclosureVersion }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`joinCoalition failed: ${r.status} ${text}`);
  }
}

export async function submitCoalitionBid(
  coalitionId: string,
  body: {
    lawyerName: string;
    lawyerBarNumber: string;
    lawyerEmail: string;
    lawyerFirm?: string | null;
    contingencyPercent: number;
    notes?: string | null;
  },
): Promise<CoalitionBid> {
  const r = await fetch(`${API}/coalitions/${coalitionId}/bid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`submitCoalitionBid failed: ${r.status} ${text}`);
  }
  return r.json();
}

export async function voteCoalitionBid(
  coalitionId: string,
  caseId: string,
  bidId: string,
): Promise<void> {
  const r = await fetch(`${API}/coalitions/${coalitionId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, bidId }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`voteCoalitionBid failed: ${r.status} ${text}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Mirror Trial (Feature 6 — stretch)
// ────────────────────────────────────────────────────────────────────

export type TrialCharacter = "opposing" | "judge" | "your_counsel";
export type TrialOutcome = "plaintiff" | "defendant" | "mixed" | "undetermined";

export interface TrialTurnView {
  ord: number;
  character: TrialCharacter;
  line: string;
  citation: string | null;
}

export interface TrialView {
  id: string;
  caseId: string;
  status: "queued" | "running" | "complete" | "failed";
  predictedOutcome: TrialOutcome | null;
  predictedRationale: string | null;
  swingArguments: string[];
  startedAt: string;
  completedAt: string | null;
  turns: TrialTurnView[];
}

export async function getTrial(caseId: string): Promise<TrialView | null> {
  const r = await fetch(`${API}/cases/${caseId}/trial`);
  if (!r.ok) throw new Error(`getTrial failed: ${r.status}`);
  const j = (await r.json()) as { trial: TrialView | null };
  return j.trial;
}

// ────────────────────────────────────────────────────────────────────
// Hearing Coach (Feature 7 — stretch)
// ────────────────────────────────────────────────────────────────────

export interface CoachBrief {
  brief: string;
  providers: { stt: "deepgram" | "browser"; tts: "elevenlabs" | "browser" };
  violations: Array<{ statute: string; description: string }>;
}

export interface CoachInterjection {
  line: string | null;
  citation: string | null;
  urgency: "high" | "normal";
}

export async function getCoachBrief(caseId: string): Promise<CoachBrief> {
  const r = await fetch(`${API}/cases/${caseId}/coach/brief`);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`getCoachBrief failed: ${r.status} ${text}`);
  }
  return r.json();
}

export async function postCoachInterject(
  caseId: string,
  transcript: string,
  signal?: AbortSignal,
): Promise<CoachInterjection> {
  const r = await fetch(`${API}/cases/${caseId}/coach/interject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
    signal,
  });
  if (!r.ok) throw new Error(`coach/interject ${r.status}`);
  return r.json();
}

export async function ackDisclosure(
  version: string,
  sessionId: string,
): Promise<void> {
  await fetch(`${API}/disclosures/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, sessionId }),
  });
}

export async function runTrial(
  caseId: string,
  opts: { force?: boolean } = {},
): Promise<TrialView> {
  const r = await fetch(`${API}/cases/${caseId}/trial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`runTrial failed: ${r.status} ${text}`);
  }
  const j = (await r.json()) as { trial: TrialView };
  return j.trial;
}
