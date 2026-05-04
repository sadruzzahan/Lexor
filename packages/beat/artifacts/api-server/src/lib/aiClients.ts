import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

let _anthropic: Anthropic | null = null;
let _gemini: GoogleGenAI | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "placeholder",
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return _anthropic;
}

export function getGeminiClient(): GoogleGenAI {
  if (!_gemini) {
    const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    _gemini = new GoogleGenAI({
      apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "placeholder",
      ...(baseUrl ? { httpOptions: { apiVersion: "", baseUrl } } : {}),
    });
  }
  return _gemini;
}

export function getOpenAIConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/**
 * Transcribe an audio file using OpenAI Whisper via a direct HTTP fetch.
 * Returns transcript text or null on failure.
 */
async function transcribeAudioInline(
  fileBytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  const cfg = getOpenAIConfig();
  if (!cfg) return null;
  try {
    const form = new FormData();
    form.append("model", "whisper-1");
    const uint8 = new Uint8Array(fileBytes) as unknown as Uint8Array<ArrayBuffer>;
    form.append("file", new Blob([uint8], { type: mimeType }), filename);
    const res = await fetch(`${cfg.baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error("[transcribeAudio:inline] HTTP", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { text?: string };
    return json.text ?? null;
  } catch (err) {
    console.error("[transcribeAudio:inline] error:", err);
    return null;
  }
}

/**
 * Transcribe via E2B sandbox running Python + openai SDK.
 * Used as fallback when the inline HTTP path fails.
 * Requires E2B_API_KEY and the OpenAI integration env vars.
 */
async function transcribeAudioViaE2B(
  fileBytes: Buffer,
  originalFilename: string,
  mimeType: string,
): Promise<string | null> {
  const cfg = getOpenAIConfig();
  if (!cfg || !process.env.E2B_API_KEY) return null;
  try {
    const { Sandbox } = await import("@e2b/code-interpreter");
    const sbx = await Sandbox.create({ timeoutMs: 90_000 });
    try {
      // Use a safe, fixed sandbox path — never interpolate user-supplied filename into code.
      const SAFE_SANDBOX_PATH = "/tmp/beat_audio_input";
      const ab = fileBytes.buffer.slice(
        fileBytes.byteOffset,
        fileBytes.byteOffset + fileBytes.byteLength,
      ) as ArrayBuffer;
      await sbx.files.write(SAFE_SANDBOX_PATH, ab);

      // Sanitize the display filename for the Whisper API (alphanumeric + safe chars only).
      // This value goes into a JSON string literal — double-check it is safe.
      const safeDisplayName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "audio.webm";

      // Secrets are passed via environment variable injection, NOT string interpolation.
      await sbx.commands.run(
        `export BEAT_OPENAI_KEY=${JSON.stringify(cfg.apiKey)} && export BEAT_OPENAI_BASE=${JSON.stringify(cfg.baseUrl + "/v1")}`,
      );

      const code = `
import os, json
try:
    from openai import OpenAI
    client = OpenAI(
        api_key=os.environ["BEAT_OPENAI_KEY"],
        base_url=os.environ["BEAT_OPENAI_BASE"],
    )
    with open(${JSON.stringify(SAFE_SANDBOX_PATH)}, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=(${JSON.stringify(safeDisplayName)}, f, ${JSON.stringify(mimeType)}),
        )
    print(json.dumps({"text": result.text}))
except Exception as e:
    print(json.dumps({"error": str(e)[:200]}))
`;
      const exec = await sbx.runCode(code);
      const output = (exec.text ?? "{}").trim();
      const parsed = JSON.parse(output) as { text?: string; error?: string };
      if (parsed.error) {
        console.error("[transcribeAudio:e2b] python error:", parsed.error);
        return null;
      }
      return parsed.text ?? null;
    } finally {
      await sbx.kill().catch(() => undefined);
    }
  } catch (e2bErr) {
    console.warn(
      "[transcribeAudio:e2b] E2B unavailable:",
      String(e2bErr).slice(0, 120),
    );
    return null;
  }
}

/**
 * Transcribe an audio file via OpenAI Whisper.
 * Primary: direct HTTP fetch (inline).
 * Fallback: E2B sandbox running Python openai SDK (when E2B_API_KEY present and inline fails).
 */
export async function transcribeAudio(
  fileBytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  const result = await transcribeAudioInline(fileBytes, filename, mimeType);
  if (result !== null) return result;
  if (process.env.E2B_API_KEY) {
    console.info("[transcribeAudio] inline failed, retrying via E2B sandbox");
    return transcribeAudioViaE2B(fileBytes, filename, mimeType);
  }
  return null;
}

/**
 * Auto-tag a photo via Gemini Vision.
 * Returns a short tag string or null on failure.
 */
export async function autoTagPhoto(
  fileBytes: Buffer,
  mimeType: string,
  goalHint?: string,
): Promise<{ caption: string; tags: string[] } | null> {
  try {
    const ai = getGeminiClient();
    const prompt = goalHint
      ? `Scene context: ${goalHint}\n\nAnalyze this photo from a law enforcement perspective. Return JSON: {"caption": "one sentence description", "tags": ["tag1", "tag2"]}. 3-7 tags, specific, lowercase, hyphenated. JSON only.`
      : `Analyze this photo from a law enforcement perspective. Return JSON: {"caption": "one sentence description", "tags": ["tag1","tag2"]}. 3-7 tags, specific, lowercase, hyphenated. JSON only.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: fileBytes.toString("base64"), mimeType } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = (response.text ?? "{}").replace(/```(?:json)?\n?/g, "").trim();
    const parsed = JSON.parse(text) as { caption?: string; tags?: string[] };
    if (!parsed.caption) return null;
    return {
      caption: parsed.caption,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (err) {
    console.error("[autoTagPhoto] error:", err);
    return null;
  }
}
