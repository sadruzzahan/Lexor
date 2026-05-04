/**
 * Tiny demo-lawyer auth gate.
 *
 * The web build does not (yet) use real auth — Briefcase boots into a
 * "Demo Lawyer" persona seeded by the API server. We persist a single
 * boolean in `localStorage` so the welcome screen only appears the first
 * time. Real auth lands in a later gate.
 */
const STORAGE_KEY = "briefcase.demoLawyer";

export function isDemoLawyer(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setDemoLawyer(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be disabled (private mode); fall through silently.
  }
}
