/**
 * G17 — SoundSystem.
 *
 * Native plan used `expo-av`; web equivalent is a tiny `HTMLAudioElement`
 * cache. Sounds are *opt-in* — `Settings → Sound effects` flips
 * `setSoundsEnabled(true)`. The map below is the single registry; G18 will
 * land the actual asset files (paths are relative to `BASE_URL`).
 *
 * Browsers gate `audio.play()` behind a user gesture — calling `play()`
 * before the first interaction throws `NotAllowedError`. We swallow that
 * error so the rest of the app stays functional during a silent boot.
 */

export type SoundEvent =
  | "tap"
  | "success"
  | "warning"
  | "error"
  | "haloPulse"
  | "verdictRibbon"
  | "objection"
  | "briefcaseOpen"
  | "briefcaseClose";

/**
 * Event → asset path. G18 will drop real files into
 * `artifacts/briefcase-app/public/sounds/` matching these names.
 */
export const SOUND_ASSETS: Record<SoundEvent, string> = {
  tap: "sounds/tap.mp3",
  success: "sounds/success.mp3",
  warning: "sounds/warning.mp3",
  error: "sounds/error.mp3",
  haloPulse: "sounds/halo-pulse.mp3",
  verdictRibbon: "sounds/verdict-ribbon.mp3",
  objection: "sounds/objection.mp3",
  briefcaseOpen: "sounds/briefcase-open.mp3",
  briefcaseClose: "sounds/briefcase-close.mp3",
};

let enabled = false;
let muted = false;
let masterVolume = 0.5;

const cache = new Map<SoundEvent, HTMLAudioElement>();

function resolveUrl(asset: string): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  // BASE_URL is guaranteed to end with `/` by Vite.
  return `${base}${asset}`;
}

function getElement(event: SoundEvent): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = cache.get(event);
  if (!el) {
    el = new Audio(resolveUrl(SOUND_ASSETS[event]));
    el.preload = "none";
    cache.set(event, el);
  }
  return el;
}

export function setSoundsEnabled(value: boolean): void {
  enabled = value;
}

export function areSoundsEnabled(): boolean {
  return enabled && !muted;
}

export function setSoundsMuted(value: boolean): void {
  muted = value;
}

export function setSoundVolume(value: number): void {
  masterVolume = Math.max(0, Math.min(1, value));
}

/**
 * Trigger a sound. No-ops if sounds are disabled / muted, the asset is
 * missing, or the browser blocks autoplay (no user gesture yet).
 */
export function playSound(event: SoundEvent): void {
  if (!enabled || muted) return;
  const el = getElement(event);
  if (!el) return;
  try {
    el.volume = masterVolume;
    el.currentTime = 0;
    const result = el.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        /* Autoplay rejected — first user gesture hasn't happened yet. */
      });
    }
  } catch {
    /* ignore */
  }
}

export const SoundSystem = {
  play: playSound,
  setEnabled: setSoundsEnabled,
  isEnabled: areSoundsEnabled,
  setMuted: setSoundsMuted,
  setVolume: setSoundVolume,
};
