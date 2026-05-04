/**
 * G17 / M4 — OLED true-black + accent oscillation.
 *
 * Native plan asked `expo-system-ui` whether the device is OLED. The web
 * has no equivalent API, so we approximate it by combining:
 *   - `(prefers-color-scheme: dark)` — the user has opted into dark mode
 *   - `(dynamic-range: high)` — the display reports HDR, a reliable proxy
 *     for OLED on iPhone / iPad / modern Android Chrome
 *   - `(prefers-contrast: more)` — manual opt-in for any other display
 *
 * When OLED-true-black is active, we flip `--background` to `#000000` and
 * begin oscillating the accent's lightness ±8% in sync with agent activity
 * (the `activity` argument flows in from `AmbientReactor`).
 */
import { useEffect } from "react";

interface Options {
  /** 0–1 activity level from AmbientReactor; oscillates accent on `dark`. */
  activity: number;
  /** Hard override (Settings → Appearance → "True black on OLED"). */
  forceTrueBlack?: boolean;
  reducedMotion: boolean;
}

function detectOled(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (!dark) return false;
  const hdr = window.matchMedia("(dynamic-range: high)").matches;
  const contrast = window.matchMedia("(prefers-contrast: more)").matches;
  return hdr || contrast;
}

export function useOledTrueBlack({
  activity,
  forceTrueBlack,
  reducedMotion,
}: Options): boolean {
  const enabled = forceTrueBlack ?? detectOled();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (enabled) {
      // 0 0% 0% in HSL space — feeds `--background: hsl(var(--background))`.
      root.style.setProperty("--background", "0 0% 0%");
      root.dataset.oled = "true";
    } else {
      root.style.removeProperty("--background");
      delete root.dataset.oled;
    }
    return () => {
      root.style.removeProperty("--background");
      delete root.dataset.oled;
    };
  }, [enabled]);

  // Accent oscillation: ±8% lightness around the Linear-violet base
  // (HSL 247° 87% 67%). Reduced-motion holds the accent steady.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!enabled) return;
    const root = document.documentElement;
    const baseLightness = 67;
    const swing = reducedMotion ? 0 : 8 * Math.max(0, Math.min(1, activity));
    const lightness = baseLightness + (Math.sin(Date.now() / 600) * swing);
    root.style.setProperty("--accent-violet-l", `${lightness.toFixed(2)}%`);
    return () => {
      root.style.removeProperty("--accent-violet-l");
    };
  }, [enabled, activity, reducedMotion]);

  return enabled;
}
