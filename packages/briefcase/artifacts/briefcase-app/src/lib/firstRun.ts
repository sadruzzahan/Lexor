/**
 * G19 / B1 — First-launch persistence.
 *
 * The native plan stores `appState.firstRunCompleted` in MMKV; on web we
 * use localStorage with the same semantics so the boot sequence + spotlight
 * tour run exactly once per install (or until the user replays them from
 * Settings).
 */

const KEY_BOOT = "briefcase.firstRunCompleted";
const KEY_TOUR = "briefcase.tourCompleted";
const KEY_PLAIN = "briefcase.plainEnglish";

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, "true");
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const firstRunCompleted = () => readBool(KEY_BOOT);
export const setFirstRunCompleted = (v: boolean) => writeBool(KEY_BOOT, v);

export const tourCompleted = () => readBool(KEY_TOUR);
export const setTourCompleted = (v: boolean) => writeBool(KEY_TOUR, v);

export const plainEnglishEnabled = () => readBool(KEY_PLAIN);
export const setPlainEnglishEnabled = (v: boolean) => writeBool(KEY_PLAIN, v);
