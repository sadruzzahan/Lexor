/**
 * Embeddings via the Replit AI Integrations OpenAI proxy. Uses the AI SDK's
 * `embed` helper against `text-embedding-3-large` with `dimensions: 1536`
 * so the result matches the `case_files.embedding` (vector(1536)) column.
 *
 * Spec §9.4.3 calls for `text-embedding-3-large`; we honor that model name
 * and just constrain its output dimensionality to fit the existing schema.
 */
import { embed } from "ai";
import { openaiProvider } from "./providers";

const EMBED_DIMS = 1536;

const embeddingModel = openaiProvider.textEmbedding("text-embedding-3-large");

/**
 * Returns a 1536-d embedding for the supplied text. Truncates oversize
 * inputs to ~30k chars (~7.5k tokens) — well under the 8192-token limit and
 * cheap enough for ingest. Empty input returns `null` so callers can skip
 * insert into the embedding column.
 */
export async function embedFileText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = trimmed.length > 30000 ? trimmed.slice(0, 30000) : trimmed;
  const { embedding } = await embed({
    model: embeddingModel,
    value,
    // Constrain output dim to fit `case_files.embedding` vector(1536).
    providerOptions: { openai: { dimensions: EMBED_DIMS } },
  });
  if (embedding.length !== EMBED_DIMS) {
    throw new Error(
      `Embedding dimension mismatch: got ${embedding.length}, expected ${EMBED_DIMS}`,
    );
  }
  return embedding;
}
