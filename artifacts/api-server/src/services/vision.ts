import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";

/**
 * Structured extraction returned by the vision pass. Schema-locked so
 * downstream stages (classifier, rules) can rely on shape without
 * re-validating fields.
 */
export const ExtractionSchema = z.object({
  documentType: z.string().describe("e.g. 'eviction notice', 'debt collection letter'"),
  sender: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    role: z.string().nullable(),
  }),
  recipient: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
  }),
  date: z.string().nullable().describe("ISO date if present"),
  deadlines: z
    .array(
      z.object({
        whatBy: z.string(),
        date: z.string().nullable(),
        verbatim: z.string(),
      }),
    )
    .default([]),
  monetaryAmounts: z
    .array(z.object({ amountUsd: z.number(), label: z.string() }))
    .default([]),
  statutesCited: z.array(z.string()).default([]),
  keyClaims: z.array(z.string()).default([]),
  rawText: z.string().describe("Verbatim transcription of the letter."),
  language: z.string().default("en"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You are an OCR + structured extraction engine for legal letters.
Return ONLY valid JSON matching the user's schema. Do not invent facts that aren't in the document.
For "rawText", transcribe the document verbatim including section headings.
For "deadlines.verbatim", quote the exact sentence from the letter that established the deadline.
If a field cannot be determined from the document, return null (or [] for arrays).`;

const USER_INSTRUCTIONS = `Transcribe this legal letter and extract the structured fields.
Output JSON only, no preamble, matching this TypeScript shape:

{
  documentType: string,
  sender: { name: string|null, address: string|null, role: string|null },
  recipient: { name: string|null, address: string|null },
  date: string|null,
  deadlines: Array<{ whatBy: string, date: string|null, verbatim: string }>,
  monetaryAmounts: Array<{ amountUsd: number, label: string }>,
  statutesCited: string[],
  keyClaims: string[],
  rawText: string,
  language: string
}`;

/**
 * Vision-based extraction. Accepts either an image (base64 or URL) or
 * a plaintext fallback when the upload is text/PDF that we've already
 * extracted to text upstream.
 *
 * DRIFT: build plan called for a GPT-4o handwriting fallback. Anthropic
 * vision handles printed legal correspondence reliably; the fallback can
 * land with the OCR-quality polish task in the post-MVP pass.
 */
export async function extractFromImage(opts: {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<Extraction> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: opts.mediaType, data: opts.base64 },
          },
          { type: "text", text: USER_INSTRUCTIONS },
        ],
      },
    ],
  });
  return parseExtraction(message);
}

export async function extractFromText(text: string): Promise<Extraction> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${USER_INSTRUCTIONS}\n\nLetter content:\n---\n${text}\n---`,
          },
        ],
      },
    ],
  });
  return parseExtraction(message);
}

function parseExtraction(message: {
  content: Array<{ type: string; text?: string }>;
}): Extraction {
  const block = message.content.find((b) => b.type === "text");
  if (!block?.text) throw new Error("vision returned no text");
  // Strip ``` fences if present
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    logger.error({ err, raw: cleaned.slice(0, 500) }, "vision JSON parse failed");
    throw new Error("vision returned malformed JSON");
  }
  return ExtractionSchema.parse(json);
}
