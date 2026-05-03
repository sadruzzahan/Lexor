import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { sendWhatsApp } from "../voice/twilioClient";

interface CaseSummary {
  caseId: string;
  vertical: string;
  jurisdiction: string | null;
  violationCount: number;
}

function publicBase(): string {
  const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  return host ? `https://${host}` : process.env.PUBLIC_BASE_URL ?? "";
}
function publicCaseUrl(caseId: string): string {
  return `${publicBase()}/c/${caseId}`;
}
function publicLetterPdfUrl(caseId: string): string {
  return `${publicBase()}/api/counsel/whatsapp/cases/${caseId}/letter.pdf`;
}

/**
 * Send the structured WA reply once a case pipeline finishes:
 *   1. Plain-language one-line explainer.
 *   2. Number of violations detected.
 *   3. Deep-link to the full case page.
 * The PDF media URL is included if attachable; we currently link the case
 * page (which has the in-browser PDF) rather than uploading a file because
 * media uploads need a public URL with content-type set.
 */
export async function sendCaseSummary(
  caseId: string,
  toPhone: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        vertical: casesTable.vertical,
        jurisdiction: casesTable.jurisdiction,
        violations: casesTable.violations,
      })
      .from(casesTable)
      .where(eq(casesTable.id, caseId))
      .limit(1);
    if (!row) return;
    const summary: CaseSummary = {
      caseId,
      vertical: row.vertical ?? "other",
      jurisdiction: row.jurisdiction ?? null,
      violationCount: Array.isArray(row.violations)
        ? (row.violations as unknown[]).length
        : 0,
    };
    const url = publicCaseUrl(caseId);
    const pdfUrl = publicLetterPdfUrl(caseId);
    const lines = [
      `Lexor — your case is ready.`,
      `Type: ${summary.vertical}${summary.jurisdiction ? ` (${summary.jurisdiction})` : ""}`,
      `${summary.violationCount} legal issue${summary.violationCount === 1 ? "" : "s"} found in their letter.`,
      `Your response letter is attached as a PDF.`,
      `Open your full case (complaints, predator map, edits): ${url}`,
      `Reminder: I'm an AI, not a lawyer. This is information, not legal advice.`,
    ];
    // Attach the response-letter PDF directly — Twilio fetches our public
    // /letter.pdf endpoint and delivers it inline in the WhatsApp message.
    await sendWhatsApp({
      to: toPhone,
      body: lines.join("\n"),
      mediaUrl: [pdfUrl],
    });
  } catch (err) {
    logger.warn({ err, caseId }, "sendCaseSummary failed");
  }
}
