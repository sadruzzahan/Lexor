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
  uploadURL: string;
  objectPath: string;
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
