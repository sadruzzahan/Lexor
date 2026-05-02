import { create } from "zustand";

const STORAGE_KEY = "lexor.disclaimer.ack";
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

function isStale(ack: Ack | null): boolean {
  if (!ack) return true;
  return Date.now() - ack.acknowledgedAt > SEVEN_DAYS_MS;
}

interface DisclaimerState {
  open: boolean;
  acknowledge: () => void;
  reopen: () => void;
}

export const useDisclaimer = create<DisclaimerState>((set) => ({
  open: isStale(readAck()),
  acknowledge: () => {
    const ack: Ack = { acknowledgedAt: Date.now(), version: VERSION };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ack));
    }
    // Backend logging hook (replaced in feature task #2).
    // eslint-disable-next-line no-console
    console.info("[lexor] disclaimer acknowledged", ack);
    set({ open: false });
  },
  reopen: () => set({ open: true }),
}));
