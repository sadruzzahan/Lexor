import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Extraction } from "../vision";
import type { Vertical } from "../classify";
import type { Violation } from "../rules";
import { stripUnverifiedCites, findStatutes } from "../grounding";

export interface ResponseLetter {
  subject: string;
  plainText: string;
  html: string;
  deliveryHints: string[];
  strippedCitations: string[];
}

const SYSTEM = `You are drafting a professional, polite-but-firm response letter
on behalf of a non-lawyer who received a legal letter. CRITICAL RULES:

1. Use ONLY citations from the "verified statutes" list provided. Do not invent
   case names, statute numbers, or regulatory citations.
2. Never predict outcomes ("you will win", "the court will rule"). Use measured
   language: "this notice appears to be defective", "you may have a defense".
3. Re-quote any deadlines verbatim from the original letter — do not compute
   new dates.
4. End with the sender's typed name placeholder: "[Your name]" / "[Date]" /
   "[Your address]". Do not invent personal details.
5. Output a single JSON object: { "subject": string, "body": string,
   "deliveryHints": string[] }. The "body" is plain text suitable for both
   email and printed letter (no markdown).
6. Tone: respectful, factual, citing each violation by statute. Demand
   correction within a reasonable timeframe.

Banned phrases anywhere: "AI lawyer", "legally binding", "guaranteed",
"win your case", "predict".`;

export async function draftResponseLetter(opts: {
  extraction: Extraction;
  vertical: Vertical;
  jurisdiction: string | null;
  violations: Violation[];
}): Promise<ResponseLetter> {
  const verified = findStatutes(opts.violations.map((v) => v.statute));
  const verifiedBlock = verified
    .map((s) => `- ${s.code} — ${s.title}\n  URL: ${s.url}\n  Summary: ${s.summary}`)
    .join("\n");

  const violationsBlock = opts.violations
    .map(
      (v, i) =>
        `${i + 1}. [${v.severity.toUpperCase()}] ${v.code} — ${v.description} (${v.statute})`,
    )
    .join("\n");

  const userPrompt = `Original letter (verbatim):
---
${opts.extraction.rawText}
---

Sender (other side): ${opts.extraction.sender.name ?? "Unknown"}
Recipient (you): ${opts.extraction.recipient.name ?? "[Your name]"}
Detected vertical: ${opts.vertical}
Jurisdiction: ${opts.jurisdiction ?? "unknown — keep response federal-law only"}

Verified statutes you may cite (use ONLY these, by exact code string):
${verifiedBlock || "(none — keep the response general; do not cite specific statutes)"}

Violations the rules engine flagged:
${violationsBlock || "(none flagged — write a polite acknowledgment that requests written verification of the claim)"}

Deadlines from the letter (re-quote verbatim, do not invent dates):
${opts.extraction.deadlines.map((d: { verbatim: string }) => `- ${d.verbatim}`).join("\n") || "(none stated)"}

Draft the response letter now. JSON only.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("draft returned no text");
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const json = JSON.parse(cleaned) as {
    subject: string;
    body: string;
    deliveryHints?: string[];
  };

  const { cleaned: safeBody, stripped } = stripUnverifiedCites(json.body, verified);

  return {
    subject: json.subject,
    plainText: safeBody,
    html: bodyToHtml(json.subject, safeBody),
    deliveryHints:
      json.deliveryHints && json.deliveryHints.length > 0
        ? json.deliveryHints
        : [
            "Send via certified mail with return receipt for proof of delivery.",
            "Keep a copy for your records.",
          ],
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
