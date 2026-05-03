import { db, casesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../../lib/logger";
import type { Violation } from "../rules";

const SYSTEM = `You are drafting a CLASS-ACTION COMPLAINT outline on behalf of a
coalition of consumers who each received a similar legal letter from the same
opposing party. CRITICAL RULES:

1. This is a draft outline for an attorney's review — NOT a filed pleading.
2. Use measured language: "appears to", "may have violated". Never predict
   outcomes.
3. Cite ONLY statutes that appear in the violations summary you are given.
   Do not invent statute numbers, case names, or regulatory citations.
4. Output a single JSON object: { "title": string, "intro": string,
   "factualAllegations": string[], "claims": [{ "heading": string,
   "body": string, "statute": string }], "reliefSought": string[],
   "noticeToMembers": string }.
5. Tone: formal but accessible to non-lawyers. The "noticeToMembers" field
   is a plain-English paragraph addressed to the coalition members
   explaining what the complaint says and what joining means.

Banned phrases anywhere: "guaranteed", "you will win", "predict the outcome".`;

interface DraftOpts {
  coalitionId: string;
  memberCaseIds: string[];
  entityName: string;
  vertical: string;
  jurisdiction: string | null;
}

/**
 * Draft the coalition's class complaint via Claude. Returns an HTML string
 * suitable for direct rendering in the coalition page. Falls back to a
 * deterministic template when the model call fails so the coalition still
 * has SOMETHING for members to read.
 */
export async function draftClassComplaint(opts: DraftOpts): Promise<string> {
  const cases = await db
    .select({
      id: casesTable.id,
      vertical: casesTable.vertical,
      jurisdiction: casesTable.jurisdiction,
      violations: casesTable.violations,
    })
    .from(casesTable)
    .where(inArray(casesTable.id, opts.memberCaseIds));

  // Aggregate violation codes + statutes across the coalition.
  const counts = new Map<
    string,
    { code: string; statute: string; description: string; count: number }
  >();
  for (const c of cases) {
    const vs = (c.violations ?? []) as Violation[];
    if (!Array.isArray(vs)) continue;
    for (const v of vs) {
      const key = v.code;
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else
        counts.set(key, {
          code: v.code,
          statute: v.statute,
          description: v.description,
          count: 1,
        });
    }
  }
  const aggregated = Array.from(counts.values()).sort(
    (a, b) => b.count - a.count,
  );

  const violationsBlock = aggregated
    .map(
      (v) =>
        `- [${v.count} member${v.count === 1 ? "" : "s"}] ${v.code} (${v.statute}) — ${v.description}`,
    )
    .join("\n");

  const userPrompt = `Coalition members: ${cases.length}
Opposing party: ${opts.entityName}
Vertical: ${opts.vertical}
Jurisdiction: ${opts.jurisdiction ?? "mixed"}

Aggregated violations across the coalition (most common first):
${violationsBlock || "(no specific violations aggregated — keep allegations general)"}

Draft the class complaint outline now. JSON only.`;

  let parsed: {
    title: string;
    intro: string;
    factualAllegations: string[];
    claims: Array<{ heading: string; body: string; statute: string }>;
    reliefSought: string[];
    noticeToMembers: string;
  } | null = null;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn({ err, coalitionId: opts.coalitionId }, "Claude draft failed");
  }

  if (!parsed) {
    parsed = {
      title: `Proposed Class Complaint Against ${opts.entityName}`,
      intro: `${cases.length} consumers received substantially similar letters from ${opts.entityName} that appear to share common defects under ${opts.vertical} law.`,
      factualAllegations: [
        `Each member received a written notice from ${opts.entityName} within the last 90 days.`,
        `Members report common patterns in the notice content and procedure.`,
      ],
      claims: aggregated.slice(0, 5).map((v) => ({
        heading: v.code,
        body: v.description,
        statute: v.statute,
      })),
      reliefSought: [
        "Declaratory relief that the notices are defective.",
        "Statutory damages where available.",
        "Injunctive relief barring further use of the defective notice.",
        "Attorneys' fees and costs.",
      ],
      noticeToMembers: `You may have received a similar letter from ${opts.entityName}. Joining this coalition does not commit you to a lawsuit; it lets a vetted attorney evaluate your claim alongside ${cases.length - 1} others. Lexor takes 0% of any recovery.`,
    };
  }

  // Render as HTML.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const html = `<article class="class-complaint">
<h1>${esc(parsed.title)}</h1>
<p class="intro">${esc(parsed.intro)}</p>
<section><h2>Factual Allegations</h2><ol>${parsed.factualAllegations
    .map((f) => `<li>${esc(f)}</li>`)
    .join("")}</ol></section>
<section><h2>Claims</h2>${parsed.claims
    .map(
      (c) =>
        `<div class="claim"><h3>${esc(c.heading)}</h3><p>${esc(c.body)}</p><p class="statute"><em>${esc(c.statute)}</em></p></div>`,
    )
    .join("")}</section>
<section><h2>Relief Sought</h2><ul>${parsed.reliefSought
    .map((r) => `<li>${esc(r)}</li>`)
    .join("")}</ul></section>
<section class="notice"><h2>Notice to Coalition Members</h2><p>${esc(parsed.noticeToMembers)}</p></section>
<p class="disclaimer"><em>This is a draft outline prepared by AI for attorney review. It is not a filed pleading and does not constitute legal advice.</em></p>
</article>`;
  return html;
}
