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
 * Two-pass design: first call uses the standard prompt (works well on
 * printed letters). If the result has too little raw text — typically
 * handwritten or low-contrast scans — we fall back to a more aggressive
 * second-pass prompt that asks the model to do best-effort handwriting
 * OCR before re-extracting the structured fields. Build plan §3.2 calls
 * for a GPT-4o second pass; we use Anthropic for both passes today
 * because OpenAI isn't wired into the workspace integrations. Swap is
 * isolated to the second `runVisionPass(...)` call below — replace its
 * model with GPT-4o when the OpenAI integration lands.
 */
const HANDWRITING_PROMPT = `${USER_INSTRUCTIONS}

This image may be handwritten, faxed, or low-contrast. Take extra care:
- Spell out each line you can see, even partial words. Use [illegible]
  only for runs you truly cannot read.
- If multiple pages are visible, transcribe each in order with a blank
  line between them.
- Preserve numbers, dollar amounts, and dates exactly as written.
- If you can read fewer than 40 characters, return rawText="" and we
  will surface a friendly upload-quality error to the user.`;

const MIN_OCR_CHARS = 80;

export async function extractFromImage(opts: {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<Extraction> {
  const first = await runVisionPass({
    base64: opts.base64,
    mediaType: opts.mediaType,
    instructions: USER_INSTRUCTIONS,
  });
  if (first.rawText.trim().length >= MIN_OCR_CHARS) return first;
  logger.info(
    { firstLen: first.rawText.length },
    "vision first pass low-confidence — running handwriting fallback",
  );
  const second = await runVisionPass({
    base64: opts.base64,
    mediaType: opts.mediaType,
    instructions: HANDWRITING_PROMPT,
  });
  if (second.rawText.trim().length < 40) {
    throw new Error(
      "We couldn't read this image clearly — try a sharper photo with the whole page in frame.",
    );
  }
  return second;
}

async function runVisionPass(opts: {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  instructions: string;
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
          { type: "text", text: opts.instructions },
        ],
      },
    ],
  });
  return parseExtraction(message);
}

/**
 * Extract structured fields from a PDF buffer. Uses pdf-parse to pull
 * the underlying text first (real PDF text extraction — no UTF-8 hack)
 * and then runs the same prompt as the text path. If the PDF is
 * scan-only with no embedded text, we throw a clear error so the UI can
 * tell the user to upload a photo of the page instead.
 */
export async function extractFromPdf(buf: Buffer): Promise<Extraction> {
  const { PDFParse } = await import("pdf-parse");
  const data = new Uint8Array(buf);
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  const text = (result.text ?? "").trim();
  if (text.length < 40) {
    throw new Error(
      "This PDF has no extractable text — please upload a photo of the page instead.",
    );
  }
  return extractFromText(text);
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
