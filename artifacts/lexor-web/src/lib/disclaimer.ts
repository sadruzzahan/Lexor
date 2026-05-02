import { create } from "zustand";

const STORAGE_KEY = "lexor.disclaimer.ack";
const ACTIVITY_KEY = "lexor.lastActiveAt";
const VERSION = 1;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface Ack {
  acknowledgedAt: number;
  version: number;
}

function readAck(): Ack | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Ack;
    if (parsed?.version !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readLastActive(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ACTIVITY_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeLastActive(ts: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVITY_KEY, String(ts));
}

function shouldPrompt(ack: Ack | null, lastActive: number | null): boolean {
  if (!ack) return true;
  if (lastActive == null) return false;
  return Date.now() - lastActive > SEVEN_DAYS_MS;
}

interface DisclaimerState {
  open: boolean;
  acknowledge: () => void;
  reopen: () => void;
  heartbeat: () => void;
}

export const useDisclaimer = create<DisclaimerState>((set) => ({
  open: shouldPrompt(readAck(), readLastActive()),
  acknowledge: () => {
    const now = Date.now();
    const ack: Ack = { acknowledgedAt: now, version: VERSION };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ack));
    }
    writeLastActive(now);
    // eslint-disable-next-line no-console
    console.info("[lexor] disclaimer acknowledged", ack);
    set({ open: false });
  },
  reopen: () => set({ open: true }),
  heartbeat: () => {
    writeLastActive(Date.now());
  },
}));
