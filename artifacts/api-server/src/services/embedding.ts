import { logger } from "../lib/logger";

/**
 * Embed a case's letter text into a 1024-dim vector via Cohere
 * embed-english-v3.0. Returns null on any failure so the pipeline can still
 * complete; coalition matching simply skips cases without embeddings.
 *
 * Falls back to OpenAI text-embedding-3-large (pinned to 1024 dims) if
 * COHERE_API_KEY is absent but OPENAI_API_KEY is present, so either key
 * independently activates coalition matching.
 */
export async function embedCaseText(text: string): Promise<number[] | null> {
  const cohereKey = process.env.COHERE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!cohereKey && !openaiKey) {
    logger.warn("Neither COHERE_API_KEY nor OPENAI_API_KEY set — embedding step skipped");
    return null;
  }

  const trimmed = text.slice(0, 16000);

  // Prefer Cohere — no extra cost, 1024-dim output matches the DB column.
  if (cohereKey) {
    try {
      const res = await fetch("https://api.cohere.com/v2/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cohereKey}`,
        },
        body: JSON.stringify({
          model: "embed-english-v3.0",
          texts: [trimmed],
          input_type: "search_document",
          embedding_types: ["float"],
        }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "cohere embedding call non-2xx");
      } else {
        const json = (await res.json()) as {
          embeddings?: { float?: number[][] };
        };
        const vec = json.embeddings?.float?.[0];
        if (vec && vec.length === 1024) {
          return vec;
        }
        logger.warn({ len: vec?.length }, "cohere unexpected embedding shape");
      }
    } catch (err) {
      logger.warn({ err }, "cohere embedding call failed");
    }
  }

  // Fallback: OpenAI pinned to 1024 dims.
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-large",
          input: trimmed,
          dimensions: 1024,
        }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "openai embedding call non-2xx");
        return null;
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vec = json.data?.[0]?.embedding;
      if (!vec || vec.length !== 1024) {
        logger.warn({ len: vec?.length }, "openai unexpected embedding shape");
        return null;
      }
      return vec;
    } catch (err) {
      logger.warn({ err }, "openai embedding fallback failed");
    }
  }

  return null;
}
