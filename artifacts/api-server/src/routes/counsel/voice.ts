import { Router, type IRouter, type Request, type Response } from "express";
import { SUPPORTED_LANGUAGES, SPOKEN_DISCLAIMER } from "../../services/voice/prompts";
import {
  getPendingUpload,
  completeSmsUpload,
} from "../../services/voice/sms";
import { HttpError } from "../../middlewares/errorEnvelope";

const router: IRouter = Router();

/**
 * Twilio voice webhook. Returns TwiML that opens a Media Stream WebSocket
 * back to our /api/counsel/voice/stream endpoint. The `<Parameter>` tags
 * forward the caller's E.164 number into the stream so the WS handler can
 * (a) hash it for session storage and (b) use it as the SMS recipient
 * when the agent invokes take_letter_photo.
 */
router.post("/incoming", (req: Request, res: Response) => {
  const host = req.get("host") ?? "";
  const from = typeof req.body?.From === "string" ? req.body.From : "";
  const wsUrl = `wss://${host}/api/counsel/voice/stream`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${escapeXml(from)}"/>
      <Parameter name="lang" value="en"/>
    </Stream>
  </Connect>
</Response>`;
  res.set("Content-Type", "application/xml");
  res.send(xml);
});

/**
 * Descriptor endpoint — the actual WS upgrade is handled at the HTTP server
 * level (see src/index.ts). This GET satisfies the OpenAPI contract for
 * tooling/docs.
 */
router.get("/stream", (_req, res) => {
  res.json({
    protocol: "websocket-twilio-media-streams",
    path: "/api/counsel/voice/stream",
  });
});

/**
 * Public listing for the /voice page.
 */
router.get("/info", (_req, res) => {
  res.json({
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? null,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? null,
    languages: SUPPORTED_LANGUAGES,
    spokenDisclaimer: SPOKEN_DISCLAIMER,
    configured: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.OPENAI_API_KEY,
    ),
  });
});

/**
 * Resolve an SMS-bridge upload token issued mid-call by the take_letter_photo
 * tool. Used by the upload page when it sees `#voice=<token>` in the URL.
 */
router.get("/upload-token/:token", (req, res) => {
  const token = req.params.token ?? "";
  const p = getPendingUpload(token);
  if (!p) throw new HttpError(404, "not_found", "Upload token not found.");
  res.json({ caseId: p.caseId, uploadURL: p.uploadURL, objectPath: p.objectPath });
});

/**
 * Finalize a voice-bridge upload. The upload page calls this after the user
 * snaps and PUTs the photo. This kicks off the pipeline and resolves the
 * pending promise inside the active call so the agent can read the letter.
 */
router.post("/upload-token/:token/complete", async (req, res) => {
  const token = req.params.token ?? "";
  const objectPath =
    typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
  if (!objectPath.startsWith("/objects/")) {
    throw new HttpError(400, "invalid_input", "Invalid objectPath.");
  }
  const rawDocumentHash =
    typeof req.body?.rawDocumentHash === "string"
      ? req.body.rawDocumentHash
      : undefined;
  // Fire and forget — the pipeline awaits inside the call thread; here we
  // just confirm the upload was registered so the upload page can show "we
  // got it, return to your call" UX without blocking.
  completeSmsUpload(token, { rawDocumentUrl: objectPath, rawDocumentHash }).catch(
    (err) => req.log.warn({ err }, "voice upload completion failed"),
  );
  res.json({ ok: true });
});

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default router;
