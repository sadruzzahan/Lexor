import { WebSocket, type RawData } from "ws";
import { logger } from "../../lib/logger";
import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { VOICE_SYSTEM_PROMPT, SPOKEN_DISCLAIMER } from "./prompts";
import {
  openSession,
  appendTranscript,
  attachCaseToSession,
  closeSession,
} from "./session";
import { startSmsUpload, awaitUpload } from "./sms";

const REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-realtime";

/**
 * Bridge a single Twilio Media Streams connection to one OpenAI Realtime
 * session. Audio is g711 μ-law in both directions, base64-encoded, in 20ms
 * frames — exactly what Twilio sends, exactly what gpt-realtime accepts
 * when configured with `audio.input.format = pcmu` / `audio.output.format = pcmu`.
 *
 * Barge-in: when the Realtime API emits `input_audio_buffer.speech_started`
 * we (1) cancel the in-flight model response and (2) tell Twilio to clear
 * its outbound buffer so the user immediately stops hearing the AI. Latency
 * goal is <200ms cut.
 */
export function bridgeTwilioToRealtime(twilioWs: WebSocket): void {
  if (!process.env.OPENAI_API_KEY) {
    logger.error(
      "OPENAI_API_KEY not configured — Realtime voice bridge cannot start. Closing Twilio WS.",
    );
    try {
      twilioWs.close(1011, "voice not configured");
    } catch {
      // best-effort close
    }
    return;
  }

  let streamSid: string | null = null;
  let sessionRowId: string | null = null;
  let callerPhone: string | null = null;
  let callerLang = "en";
  let realtimeReady = false;
  /** Tracks the active assistant audio response so we can cancel for barge-in. */
  let activeResponseId: string | null = null;

  const realtimeWs = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // Outbound buffer for Twilio frames that arrive before the upstream
  // socket is open. Without this we'd lose the first ~100ms of caller
  // audio every time.
  const pendingFromTwilio: string[] = [];

  function sendUpstream(payload: object): void {
    if (realtimeWs.readyState === WebSocket.OPEN) {
      realtimeWs.send(JSON.stringify(payload));
    }
  }

  function sendDownstream(payload: object): void {
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(JSON.stringify(payload));
    }
  }

  // -------- OpenAI Realtime side --------
  realtimeWs.on("open", () => {
    realtimeReady = true;
    // Bake the full disclaimer table into the system prompt so the model
    // can pick the verbatim text in whatever language the caller turned
    // out to be speaking — without us hardcoding English-first.
    const disclaimerTable = Object.entries(SPOKEN_DISCLAIMER)
      .map(([code, txt]) => `[${code}] ${txt}`)
      .join("\n\n");
    const initialLang = callerLang in SPOKEN_DISCLAIMER ? callerLang : "en";
    const fullInstructions =
      `${VOICE_SYSTEM_PROMPT}\n\nVERBATIM DISCLAIMER TABLE — ` +
      `read the entry that matches the caller's language. Do not paraphrase; ` +
      `the wording is legally significant.\n\n${disclaimerTable}`;
    sendUpstream({
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: fullInstructions,
        voice: "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 200,
          silence_duration_ms: 400,
        },
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.7,
      },
    });
    // Open the call with the disclaimer in the language we *deterministically*
    // know (derived from the caller's E.164 country code in TwiML, defaulting
    // to English). If the caller responds in a different language, the system
    // prompt instructs the model to switch and re-read the disclaimer.
    sendUpstream({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions:
          `This is the FIRST turn of the call. Read this verbatim, with warmth, then pause for the caller: ` +
          SPOKEN_DISCLAIMER[initialLang],
      },
    });
    // Flush anything that was buffered while we were connecting.
    while (pendingFromTwilio.length) {
      const payload = pendingFromTwilio.shift();
      if (payload) {
        sendUpstream({ type: "input_audio_buffer.append", audio: payload });
      }
    }
  });

  realtimeWs.on("message", async (raw: RawData) => {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const type = msg.type;
    switch (type) {
      case "response.created": {
        const r = msg.response as { id?: string } | undefined;
        activeResponseId = r?.id ?? null;
        break;
      }
      case "response.done": {
        activeResponseId = null;
        break;
      }
      case "input_audio_buffer.speech_started": {
        // Barge-in. Kill the current response and clear Twilio's buffer.
        if (activeResponseId) {
          sendUpstream({ type: "response.cancel" });
        }
        if (streamSid) {
          sendDownstream({ event: "clear", streamSid });
        }
        break;
      }
      case "response.audio.delta":
      case "response.output_audio.delta": {
        const delta = msg.delta as string | undefined;
        if (streamSid && typeof delta === "string") {
          sendDownstream({
            event: "media",
            streamSid,
            media: { payload: delta },
          });
        }
        break;
      }
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const transcript = msg.transcript as string | undefined;
        if (transcript && sessionRowId) {
          await appendTranscript(sessionRowId, {
            role: "agent",
            text: transcript,
          });
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = msg.transcript as string | undefined;
        if (transcript && sessionRowId) {
          await appendTranscript(sessionRowId, {
            role: "caller",
            text: transcript,
          });
          // Quick language detection on the first transcribed turn.
          callerLang = detectLanguage(transcript) ?? callerLang;
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const callId = msg.call_id as string | undefined;
        const name = msg.name as string | undefined;
        const args = msg.arguments as string | undefined;
        if (callId && name) {
          handleToolCall(callId, name, args ?? "{}").catch((err) =>
            logger.error({ err, name }, "tool call failed"),
          );
        }
        break;
      }
      case "error": {
        logger.warn({ err: msg }, "realtime error");
        break;
      }
      default:
        break;
    }
  });

  realtimeWs.on("close", () => {
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  });
  realtimeWs.on("error", (err) => {
    logger.warn({ err: err.message }, "realtime ws error");
  });

  // -------- Tool execution --------
  async function handleToolCall(
    callId: string,
    name: string,
    rawArgs: string,
  ): Promise<void> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = {};
    }
    let output: unknown;
    try {
      switch (name) {
        case "lookup_jurisdiction": {
          const zip = String(args.zip ?? "");
          output = { state: zipToState(zip) ?? "unknown" };
          break;
        }
        case "take_letter_photo": {
          if (!callerPhone) {
            output = { sent: false, reason: "no caller phone available" };
            break;
          }
          const { token, smsSent } = await startSmsUpload({
            toPhone: callerPhone,
            language: callerLang,
          });
          output = {
            sent: smsSent,
            token,
            instruction:
              "Tell the caller to tap the link you just texted. Then wait for them by calling submit_case with this token.",
          };
          break;
        }
        case "submit_case": {
          const token = String(args.token ?? "");
          if (!token) {
            output = { error: "token required" };
            break;
          }
          const caseId = await awaitUpload(token);
          if (sessionRowId) await attachCaseToSession(sessionRowId, caseId);
          output = { caseId, status: "ready" };
          break;
        }
        case "read_response_letter": {
          const caseId = String(args.caseId ?? "");
          const letter = await loadResponseLetter(caseId);
          output = letter
            ? { ok: true, plainText: letter.plainText }
            : { ok: false, error: "letter not ready" };
          break;
        }
        case "send_email_reply": {
          const alertId = String(args.alertId ?? "");
          const confirmed = args.confirmedBySpeech === true;
          if (!alertId) {
            output = { error: "alertId required" };
            break;
          }
          if (!confirmed) {
            // Hard refusal — the assistant is required to get explicit
            // verbal confirmation before sending. We never ship without
            // a true flag, even if the LLM tries to bypass.
            output = {
              ok: false,
              error: "verbal_confirmation_required",
              saySorry:
                "Tell the caller you need them to clearly say 'yes, send it' before you can send the reply.",
            };
            break;
          }
          try {
            const { sendInboxAlertReply } = await import("../inbox/sendReply");
            const r = await sendInboxAlertReply(alertId);
            output = r;
          } catch (err) {
            output = { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
          break;
        }
        case "open_case_on_device": {
          const alertId = String(args.alertId ?? "");
          if (!alertId || !callerPhone) {
            output = { ok: false, error: "alertId and caller phone required" };
            break;
          }
          try {
            const { textAlertDeeplink } = await import("../inbox/sendReply");
            const r = await textAlertDeeplink({ alertId, toPhone: callerPhone });
            output = r;
          } catch (err) {
            output = { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
          break;
        }
        case "transfer_to_human": {
          output = {
            ok: false,
            saySorry:
              "Tell the caller, in their language: 'I'm sorry — Lexor doesn't yet route to a live person. I can text you a list of free local legal aid clinics if that helps.'",
          };
          break;
        }
        default:
          output = { error: `unknown tool: ${name}` };
      }
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
    }
    sendUpstream({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    sendUpstream({ type: "response.create" });
  }

  // -------- Twilio side --------
  twilioWs.on("message", async (raw: RawData) => {
    let msg: { event?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start": {
        const start = msg.start as
          | {
              streamSid?: string;
              callSid?: string;
              customParameters?: { from?: string; lang?: string };
            }
          | undefined;
        streamSid = start?.streamSid ?? null;
        callerPhone = start?.customParameters?.from ?? null;
        callerLang = start?.customParameters?.lang ?? "en";
        const externalId = start?.callSid ?? streamSid ?? `unknown-${Date.now()}`;
        if (callerPhone) {
          try {
            const row = await openSession({
              channel: "voice",
              externalId,
              phoneNumber: callerPhone,
              language: callerLang,
            });
            sessionRowId = row.id;
          } catch (err) {
            logger.warn({ err }, "openSession failed");
          }
        }
        break;
      }
      case "media": {
        const media = msg.media as { payload?: string } | undefined;
        const payload = media?.payload;
        if (typeof payload !== "string") break;
        if (realtimeReady) {
          sendUpstream({ type: "input_audio_buffer.append", audio: payload });
        } else {
          pendingFromTwilio.push(payload);
        }
        break;
      }
      case "stop": {
        if (sessionRowId) await closeSession(sessionRowId);
        try {
          realtimeWs.close();
        } catch {
          // best-effort close
        }
        break;
      }
      default:
        break;
    }
  });

  twilioWs.on("close", () => {
    try {
      realtimeWs.close();
    } catch {
      // already closed
    }
  });
  twilioWs.on("error", (err) => {
    logger.warn({ err: err.message }, "twilio ws error");
  });
}

// ---- Realtime tool schemas ----
const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "lookup_jurisdiction",
    description:
      "Resolve a US ZIP code to a US state code (e.g. CA, TX, NY). Use when the caller mentions where they live but you don't know the state.",
    parameters: {
      type: "object",
      properties: { zip: { type: "string", description: "5-digit US ZIP" } },
      required: ["zip"],
    },
  },
  {
    type: "function",
    name: "take_letter_photo",
    description:
      "Send the caller an SMS with a one-time link to upload a photo of the letter. Returns a token that you must pass to submit_case to wait for the upload.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    type: "function",
    name: "submit_case",
    description:
      "Wait for the caller's photo upload to land and the analysis pipeline to finish. Pass the token returned by take_letter_photo. Returns a caseId you must pass to read_response_letter.",
    parameters: {
      type: "object",
      properties: { token: { type: "string" } },
      required: ["token"],
    },
  },
  {
    type: "function",
    name: "read_response_letter",
    description:
      "Fetch the drafted response letter for a finished case so you can read it aloud to the caller.",
    parameters: {
      type: "object",
      properties: { caseId: { type: "string" } },
      required: ["caseId"],
    },
  },
  {
    type: "function",
    name: "send_email_reply",
    description:
      "INBOX SENTINEL ONLY. Send the pre-drafted reply for a fired inbox alert via Gmail. REQUIRES the caller to have just verbally confirmed (e.g. they said 'send it'). Pass alertId from the preloaded alert context. Refuses if the alert is not in 'fired' or 'dispatched' state. Returns {ok, status} or {error}.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string", description: "Inbox alert id from session context." },
        confirmedBySpeech: {
          type: "boolean",
          description: "Set true ONLY if the caller verbally confirmed; otherwise refuse.",
        },
      },
      required: ["alertId", "confirmedBySpeech"],
    },
  },
  {
    type: "function",
    name: "open_case_on_device",
    description:
      "INBOX SENTINEL ONLY. Text the caller a deeplink to open the alert (and any associated case) on their phone so they can review the drafted reply on screen. Use when the caller says 'review' instead of 'send'.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string", description: "Inbox alert id from session context." },
      },
      required: ["alertId"],
    },
  },
  {
    type: "function",
    name: "transfer_to_human",
    description:
      "The caller asked for a live human lawyer. Lexor doesn't yet route to people; this tool returns the apology copy you should say.",
    parameters: { type: "object", properties: {} },
  },
];

// ---- Helpers ----
async function loadResponseLetter(
  caseId: string,
): Promise<{ plainText: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return null;
  const [row] = await db
    .select({ responseLetter: casesTable.responseLetter })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  if (!row?.responseLetter) return null;
  const letter = row.responseLetter as { plainText?: string };
  return letter.plainText ? { plainText: letter.plainText } : null;
}

const ZIP_PREFIX_TO_STATE: Record<string, string> = {
  "0": "MA", "1": "NY", "2": "VA", "3": "FL",
  "4": "MI", "5": "MN", "6": "IL", "7": "TX",
  "8": "CO", "9": "CA",
};
function zipToState(zip: string): string | null {
  const m = /^(\d)/.exec(zip.trim());
  return m ? ZIP_PREFIX_TO_STATE[m[1] ?? ""] ?? null : null;
}

const LANG_HINTS: Array<[RegExp, string]> = [
  [/\b(hola|gracias|por favor|sí|señor|señora)\b/i, "es"],
  [/\b(bonjour|merci|s'il vous plaît|oui|madame|monsieur)\b/i, "fr"],
  [/[\u0600-\u06FF]/, "ar"],
  [/[\u0900-\u097F]/, "hi"],
  [/[\u0980-\u09FF]/, "bn"],
];
function detectLanguage(text: string): string | null {
  for (const [re, lang] of LANG_HINTS) {
    if (re.test(text)) return lang;
  }
  return "en";
}
