import { Router, type IRouter, type Request, type Response } from "express";
import QRCode from "qrcode";
import {
  parseInboundPayload,
  handleWhatsAppInbound,
} from "../../services/whatsapp/inbound";
import { sendCaseSummary } from "../../services/whatsapp/outbound";

const router: IRouter = Router();

/**
 * Twilio WhatsApp inbound webhook. We respond immediately with empty TwiML
 * (Twilio's required ack) and process the message asynchronously, sending
 * the structured reply via the REST API once the pipeline finishes.
 */
router.post("/inbound", async (req: Request, res: Response) => {
  // Ack first so Twilio doesn't retry while we work.
  res.set("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`);

  const payload = parseInboundPayload(
    req.body as Record<string, string | undefined>,
  );
  try {
    await handleWhatsAppInbound(payload, {
      onComplete: (caseId, fromPhone) => sendCaseSummary(caseId, fromPhone),
    });
  } catch (err) {
    req.log.warn({ err }, "whatsapp inbound handler failed");
  }
});

/**
 * Generate a PNG QR code that joins the Twilio WhatsApp Sandbox.
 *
 * Twilio sandbox uses the canonical "join <code>" SMS pattern; we build a
 * `https://wa.me/<number>?text=join+<code>` deep link so scanning opens
 * WhatsApp pre-populated with the join command.
 */
router.get("/qrcode", async (req: Request, res: Response) => {
  const phoneRaw = process.env.TWILIO_WHATSAPP_NUMBER ?? "";
  const code = process.env.TWILIO_WHATSAPP_SANDBOX_CODE ?? "lexor";
  const phone = phoneRaw.replace(/^whatsapp:/, "").replace(/\D/g, "");
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(`join ${code}`)}`
    : `https://wa.me/?text=${encodeURIComponent(`join ${code}`)}`;
  try {
    const png = await QRCode.toBuffer(url, {
      width: 320,
      margin: 1,
      color: { dark: "#ffffff", light: "#0b0d12" },
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=600");
    res.send(png);
  } catch (err) {
    req.log.warn({ err }, "qrcode generation failed");
    res.status(500).end();
  }
});

export default router;
