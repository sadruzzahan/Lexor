/**
 * G23 WebRTCGateway — sub-200 ms media path for G14 Courtroom Mode.
 *
 * In production this would front a TURN server. Here we run an
 * in-process signaling channel: clients POST SDP offers/answers and
 * ICE candidates keyed by runId, the gateway relays them to the other
 * peer via a per-run pub/sub. No media touches the API process — that
 * stays peer-to-peer over the negotiated WebRTC connection — so the
 * sub-200 ms latency target is the WebRTC stack's, not ours.
 *
 * When no second peer ever connects, the existing chunked-HTTPS
 * fallback in `engine/streamingTools.ts` keeps Courtroom Mode usable;
 * G14 will switch to the WebRTC path the instant `peerConnected` fires.
 */
import { logger } from "../lib/logger";

export interface SignalEnvelope {
  runId: string;
  from: "presenter" | "audience";
  kind: "offer" | "answer" | "ice";
  payload: Record<string, unknown>;
  ts: number;
}

interface Session {
  presenter: SignalEnvelope[];
  audience: SignalEnvelope[];
  listeners: Set<(env: SignalEnvelope) => void>;
}

const sessions = new Map<string, Session>();

function getSession(runId: string): Session {
  let s = sessions.get(runId);
  if (!s) {
    s = { presenter: [], audience: [], listeners: new Set() };
    sessions.set(runId, s);
  }
  return s;
}

/** Push a signaling message and fan out to listeners. */
export function pushSignal(env: SignalEnvelope): void {
  const s = getSession(env.runId);
  if (env.from === "presenter") s.presenter.push(env);
  else s.audience.push(env);
  for (const l of s.listeners) {
    try {
      l(env);
    } catch (err) {
      logger.warn({ err }, "webrtcGateway listener threw");
    }
  }
}

/** Drain the queue of messages destined for `to` (the opposite peer). */
export function pullSignals(runId: string, to: "presenter" | "audience"): SignalEnvelope[] {
  const s = getSession(runId);
  // The presenter consumes audience messages and vice versa.
  const queue = to === "presenter" ? s.audience : s.presenter;
  const out = [...queue];
  queue.length = 0;
  return out;
}

export function subscribe(
  runId: string,
  listener: (env: SignalEnvelope) => void,
): () => void {
  const s = getSession(runId);
  s.listeners.add(listener);
  return () => {
    s.listeners.delete(listener);
    if (s.listeners.size === 0 && s.presenter.length === 0 && s.audience.length === 0) {
      sessions.delete(runId);
    }
  };
}

export function dropSession(runId: string): void {
  sessions.delete(runId);
}

export function activeSessionCount(): number {
  return sessions.size;
}
