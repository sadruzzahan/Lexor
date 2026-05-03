import { createServer } from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { bridgeTwilioToRealtime } from "./services/voice/realtimeBridge";
import { startInboxScheduler } from "./services/inbox/scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

/**
 * Twilio Media Streams WebSocket endpoint. Twilio upgrades to ws:// at
 * `/api/counsel/voice/stream`; we hand the socket off to the realtime
 * bridge, which opens a parallel ws:// to OpenAI Realtime and pumps μ-law
 * frames between them in both directions.
 *
 * `noServer: true` lets us route the upgrade ourselves so any other path
 * (e.g. Vite HMR proxied through, future channels) is left alone.
 */
const voiceWss = new WebSocketServer({ noServer: true });
const VOICE_WS_PATH = "/api/counsel/voice/stream";

server.on("upgrade", (req, socket, head) => {
  const { url } = req;
  if (!url) {
    socket.destroy();
    return;
  }
  // Strip querystring before matching.
  const path = url.split("?")[0];
  if (path === VOICE_WS_PATH) {
    voiceWss.handleUpgrade(req, socket, head, (ws) => {
      voiceWss.emit("connection", ws, req);
    });
  } else {
    // Not a path we own — let the socket close so other handlers (e.g.
    // a future WS endpoint) can decide for themselves.
    socket.destroy();
  }
});

voiceWss.on("connection", (ws) => {
  logger.info("twilio media stream connected");
  bridgeTwilioToRealtime(ws);
});

server.listen(port, () => {
  logger.info({ port, voiceWsPath: VOICE_WS_PATH }, "Server listening");
  // Inbox Sentinel polling loop. No-op when Gmail scope insufficient.
  startInboxScheduler();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
