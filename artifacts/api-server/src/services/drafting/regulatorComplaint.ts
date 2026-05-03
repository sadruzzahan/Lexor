import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Extraction } from "../vision";
import type { Violation, AgencyKind } from "../rules";
import { AGENCY_LABEL, AGENCY_FILE_URL } from "../rules";
import { stripUnverifiedCites, findStatutes } from "../grounding";

export interface RegulatorComplaint {
  agency: AgencyKind;
  agencyLabel: string;
  filingUrl: string;
  draftHtml: string;
  draftPlainText: string;
  steps: string[];
  status: "draft";
  strippedCitations: string[];
}

const SYSTEM = `You draft a regulator-ready consumer complaint. CRITICAL RULES:
- Use ONLY citations from the verified statutes provided.
- Never predict an outcome.
- Quote deadlines verbatim from the original letter.
- Output JSON only: { "subject": string, "body": string, "steps": string[] }.
- Body is plain text. Steps is an array of 3-5 short instructions for filing.
- Include a placeholder "[Your name]" / "[Your address]" / "[Your phone]" — do
  not invent personal details.
- Tone: factual, chronological, respectful. Cite the statute(s) violated.`;

export async function draftRegulatorComplaint(opts: {
  extraction: Extraction;
  violations: Violation[];
  agency: AgencyKind;
}): Promise<RegulatorComplaint> {
  const violationsForAgency = opts.violations.filter((v) => v.agency === opts.agency);
  const verified = findStatutes(violationsForAgency.map((v) => v.statute));
  const verifiedBlock = verified
    .map((s) => `- ${s.code} (${s.title}) — ${s.url}`)
    .join("\n");

  const userPrompt = `Agency: ${AGENCY_LABEL[opts.agency]}
Filing portal: ${AGENCY_FILE_URL[opts.agency]}

Original letter (verbatim):
---
${opts.extraction.rawText}
---

Sender of the offending letter: ${opts.extraction.sender.name ?? "Unknown"}
Sender address: ${opts.extraction.sender.address ?? "Unknown"}

Verified statutes you may cite (use ONLY these):
${verifiedBlock || "(none — keep general)"}

Violations to report:
${violationsForAgency
  .map((v, i) => `${i + 1}. ${v.code} — ${v.description} (${v.statute})`)
  .join("\n")}

Draft the complaint now. JSON only.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("complaint draft returned no text");
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const json = JSON.parse(cleaned) as {
    subject: string;
    body: string;
    steps?: string[];
  };

  const { cleaned: safeBody, stripped } = stripUnverifiedCites(json.body, verified);

  return {
    agency: opts.agency,
    agencyLabel: AGENCY_LABEL[opts.agency],
    filingUrl: AGENCY_FILE_URL[opts.agency],
    draftPlainText: safeBody,
    draftHtml: bodyToHtml(json.subject, safeBody),
    steps:
      json.steps && json.steps.length > 0
        ? json.steps
        : [
            `Open ${AGENCY_FILE_URL[opts.agency]}`,
            "Paste the draft below into the complaint form.",
            "Attach a photo or scan of the original letter.",
            "Submit, then save the confirmation number.",
          ],
    status: "draft",
    strippedCitations: stripped,
  };
}

function bodyToHtml(subject: string, body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title>
<style>body{font-family:Georgia,serif;max-width:680px;margin:48px auto;padding:0 24px;color:#111;line-height:1.6}
h1{font-size:18px;font-weight:600;margin-bottom:24px}
p{margin:0 0 16px}</style></head>
<body><h1>${subject}</h1>${paragraphs}</body></html>`;
}
