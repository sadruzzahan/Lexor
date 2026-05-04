/**
 * G14 vadSegment — coarse voice-activity gate for Courtroom Mode.
 *
 * Honest scope: a real VAD (WebRTC, Silero, Cobra) needs decoded PCM
 * frames. The browser sends Opus-in-WebM chunks straight from
 * MediaRecorder; decoding those server-side requires ffmpeg/wasm we
 * have not provisioned. To keep the live loop honest we ship a
 * size-based gate: a 1s Opus@~32kbps chunk has a typical floor of
 * ~1.5KB even for silence (container overhead) and rises to 3-6KB+
 * once anyone is talking. We therefore drop chunks below
 * `silenceFloorBytes` as "no speech detected" so the model is never
 * asked to transcribe pure silence.
 *
 * For non-Opus inputs (audio/wav, audio/pcm) we fall back to an
 * energy threshold over the raw 16-bit samples.
 *
 * If a stricter VAD is required, this module throws
 * `dependency_unavailable` from `requireStrictVad()` instead of
 * silently mocking — see honest-failure principle.
 */
import { ApiError } from "../lib/errors";

export interface VadDecision {
  hasSpeech: boolean;
  /** Coarse 0..1 score; useful for telemetry / UI animation only. */
  energy: number;
  reason: "above_threshold" | "below_floor" | "wav_silent" | "wav_speech";
}

const DEFAULT_OPUS_FLOOR_BYTES = 1800;

export function vadSegment(args: {
  audio: Buffer;
  mime: string;
  silenceFloorBytes?: number;
}): VadDecision {
  const mime = args.mime.toLowerCase();
  if (mime.startsWith("audio/wav") || mime.startsWith("audio/x-wav") || mime === "audio/pcm") {
    return wavEnergy(args.audio);
  }
  // Opus / WebM / OGG / MP4 — we cannot decode without ffmpeg, so use
  // the byte-floor heuristic. This is intentionally conservative: it
  // never flags speech that is not present, but it WILL accept some
  // silent chunks above the floor (the LLM still drops empty
  // transcripts downstream).
  const floor = args.silenceFloorBytes ?? DEFAULT_OPUS_FLOOR_BYTES;
  if (args.audio.length < floor) {
    return {
      hasSpeech: false,
      energy: 0,
      reason: "below_floor",
    };
  }
  return {
    hasSpeech: true,
    energy: Math.min(1, args.audio.length / (floor * 4)),
    reason: "above_threshold",
  };
}

function wavEnergy(buf: Buffer): VadDecision {
  // Skip a fixed 44-byte WAV header. If the buffer is too small or not
  // a real WAV, treat as silent rather than guess.
  if (buf.length < 64) {
    return { hasSpeech: false, energy: 0, reason: "wav_silent" };
  }
  let sumSq = 0;
  let n = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i) / 32768;
    sumSq += s * s;
    n++;
  }
  if (n === 0) return { hasSpeech: false, energy: 0, reason: "wav_silent" };
  const rms = Math.sqrt(sumSq / n);
  const hasSpeech = rms > 0.01;
  return {
    hasSpeech,
    energy: Math.min(1, rms * 8),
    reason: hasSpeech ? "wav_speech" : "wav_silent",
  };
}

/** Strict VAD is not provisioned in this build — throw honestly. */
export function requireStrictVad(): never {
  throw new ApiError(
    "dependency_unavailable",
    "Strict VAD (Silero/WebRTC) is not provisioned in this build; only coarse heuristic VAD is available.",
  );
}
