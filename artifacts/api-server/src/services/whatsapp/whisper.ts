import { logger } from "../../lib/logger";

/**
 * Direct OpenAI Whisper transcription. Used for WhatsApp voice notes.
 * Returns null if no key is configured or the request fails — the inbound
 * handler degrades to "we couldn't hear that, try again".
 */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logger.warn("OPENAI_API_KEY not set — skipping Whisper transcription");
    return null;
  }
  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audio)]);
    form.append("file", blob, filename);
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "whisper transcription failed");
      return null;
    }
    const json = (await res.json()) as { text?: string };
    return json.text ?? null;
  } catch (err) {
    logger.warn({ err }, "whisper transcription threw");
    return null;
  }
}
