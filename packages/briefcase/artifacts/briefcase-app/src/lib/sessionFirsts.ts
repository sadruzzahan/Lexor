/**
 * G20 — once-per-session "first occurrence" guards for signature moments
 * (Briefcase Open, Verdict Ribbon, Jurisdiction Bloom, …).
 *
 * The native plan stores these in MMKV with TTL; on web we use
 * `sessionStorage` so a moment fires once per browser tab session and
 * resets cleanly when the tab closes — closer to the spec's intent
 * ("once per session per case") than localStorage, which would never
 * re-fire the cinematic on a return visit weeks later.
 *
 * Returns `true` the first time `markIfFirst(key)` is called per session
 * for that key; `false` thereafter. SSR-safe (returns `false` server-side
 * so the moment never fires during render).
 */

const PREFIX = "briefcase.firstOf.";

export function isFirstOf(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PREFIX + key) !== "1";
  } catch {
    return false;
  }
}

export function markIfFirst(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(PREFIX + key) === "1") return false;
    window.sessionStorage.setItem(PREFIX + key, "1");
    return true;
  } catch {
    return false;
  }
}

/** Test-only / settings-only — clear the session-firsts namespace. */
export function clearSessionFirsts(): void {
  if (typeof window === "undefined") return;
  try {
    const ss = window.sessionStorage;
    const drop: string[] = [];
    for (let i = 0; i < ss.length; i++) {
      const k = ss.key(i);
      if (k && k.startsWith(PREFIX)) drop.push(k);
    }
    drop.forEach((k) => ss.removeItem(k));
  } catch {
    /* ignore */
  }
}
