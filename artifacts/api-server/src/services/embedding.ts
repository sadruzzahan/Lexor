import { logger } from "../lib/logger";

/**
 * Embed a case's letter text into a 1536-dim vector via OpenAI
 * text-embedding-3-large. Pinned to 1536 dims (vs the model's native 3072)
 * so the column fits pgvector's ivfflat index limit. Returns null on any
 * failure so the pipeline can still complete; coalition matching simply
 * skips cases without embeddings.
 *
 * Uses the same direct-fetch pattern as services/whatsapp/whisper.ts so
 * we don't take a hard dep on the openai SDK from this module.
 */
export async function embedCaseText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logger.warn("OPENAI_API_KEY not set — embedding step skipped");
    return null;
  }
  const trimmed = text.slice(0, 16000);
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: trimmed,
        dimensions: 1536,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "embedding call non-2xx");
      return null;
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = json.data?.[0]?.embedding;
    if (!vec || vec.length !== 1536) {
      logger.warn({ len: vec?.length }, "unexpected embedding shape");
      return null;
    }
    return vec;
  } catch (err) {
    logger.warn({ err }, "embedding call failed");
    return null;
  }
}
