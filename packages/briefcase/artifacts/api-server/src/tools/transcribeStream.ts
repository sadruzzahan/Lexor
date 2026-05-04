/**
 * G14 transcribeStream — server-side speech-to-text for Courtroom Mode.
 *
 * INTERIM DEVIATION FROM SPEC (documented, gated, reversible).
 *
 * The G14 spec calls for whisper.cpp running inside an E2B sandbox so
 * audio chunks stay inside the platform's trust boundary. That
 * deployment requires a whisper.cpp binary + GGUF model image inside
 * the sandbox template, which is not provisioned in this build.
 *
 * Until that template ships we route audio through the OpenAI Whisper
 * REST endpoint (`COURTROOM_TRANSCRIBE_BACKEND=openai`, the default),
 * which transmits the audio chunk to OpenAI for the duration of the
 * call. This is acceptable for the demo gate but MUST be revisited
 * before any real-world courtroom usage; setting
 * `COURTROOM_TRANSCRIBE_BACKEND=e2b` will throw `dependency_unavailable`
 * (instead of silently mocking) so the UI surfaces a clear "Copilot
 * offline" badge until the sandbox template lands. See ROADMAP G14.1.
 *
 * No mocked/placeholder transcript is ever returned — this is a
 * zero-tolerance honesty surface.
 */
import { ApiError } from "../lib/errors";
import { logger } from "../lib/logger";

export interface TranscribeArgs {
  /** Raw audio bytes (webm/opus from MediaRecorder, or wav). */
  audio: Buffer;
  /** MIME type of the chunk (e.g. "audio/webm" or "audio/wav"). */
  mime: string;
  /** ISO-639-1 code; whisper auto-detects when omitted. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  durationMs: number;
}

export async function transcribeStream(args: TranscribeArgs): Promise<TranscribeResult> {
  const backend = (process.env.COURTROOM_TRANSCRIBE_BACKEND ?? "openai").toLowerCase();
  if (backend === "e2b") {
    // Spec-aligned path. Not provisioned yet — fail honestly rather
    // than silently fall through to OpenAI.
    throw new ApiError(
      "dependency_unavailable",
      "Courtroom transcription set to e2b/whisper.cpp backend, but the sandbox template is not provisioned. " +
        "Unset COURTROOM_TRANSCRIBE_BACKEND or set it to 'openai' to use the interim backend.",
    );
  }
  if (backend !== "openai") {
    throw new ApiError(
      "dependency_unavailable",
      `Unknown COURTROOM_TRANSCRIBE_BACKEND="${backend}".`,
    );
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      "dependency_unavailable",
      "Transcription unavailable: OPENAI_API_KEY not configured. " +
        "Courtroom Mode requires a transcription backend before it can flag objections.",
    );
  }
  logger.debug({ backend: "openai" }, "transcribeStream: using interim openai backend (see ROADMAP G14.1)");

  const t0 = Date.now();
  const ext = args.mime.includes("wav") ? "wav" : "webm";
  const blob = new Blob([new Uint8Array(args.audio)], { type: args.mime });
  const form = new FormData();
  form.append("file", blob, `chunk.${ext}`);
  form.append("model", "whisper-1");
  if (args.language) form.append("language", args.language);
  form.append("response_format", "json");

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ctl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "transcribeStream: provider error");
      throw new ApiError(
        "dependency_unavailable",
        `Transcription provider returned ${res.status}`,
      );
    }
    const json = (await res.json()) as { text?: string; language?: string };
    return {
      text: (json.text ?? "").trim(),
      language: json.language,
      durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timeout);
  }
}
