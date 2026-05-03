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
