/**
 * G17 — Design system tokens.
 *
 * One source of truth for color, spacing, typography, depth, and the M1–M10
 * "modern visual language" tokens called out in spec §7.1. The native plan
 * targeted Expo/React Native primitives (expo-blur, Skia, expo-sensors); on
 * web we map each one onto a CSS-friendly equivalent so the rest of the
 * codebase can keep using a single token API.
 */

/** Linear-violet accent (spec §7.1) used for FAB, primary buttons, halos. */
export const ACCENT_VIOLET = "#7C6AF7";

/** Holographic AI marker hue (M8 — referenced for parity, full impl in G18). */
export const HOLO_MARKER = "#A99CFF";

/** Brand palette extracted from spec §7.1. */
export const colors = {
  accent: ACCENT_VIOLET,
  accentSoft: "rgba(124, 106, 247, 0.30)",
  accentHalo: "rgba(124, 106, 247, 0.16)",
  holoMarker: HOLO_MARKER,
  successHalo: "rgba(16, 185, 129, 0.30)",
  warnHalo: "rgba(245, 158, 11, 0.30)",
  errorHalo: "rgba(239, 68, 68, 0.30)",
  // M4 — true-black for OLED. Applied via useOledTrueBlack.
  oledBlack: "#000000",
} as const;

/** 4px grid (spec §7.1). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

/** Border radii (spec §7.1). */
export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * M3 — Variable typography. Inter Variable + Geist Variable are loaded via
 * Google Fonts in `index.css`. Use `weight.emphasis` / `weight.active` with
 * `useVariableFontWeight` to animate the weight axis on focus/active.
 */
export const typography = {
  family: {
    sans: "'Inter Variable', 'Inter', system-ui, sans-serif",
    display: "'Geist Variable', 'Geist', 'Inter Variable', sans-serif",
    mono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
  },
  weight: {
    rest: 400,
    emphasis: 500,
    active: 600,
    display: 700,
  },
  size: {
    micro: "11px",
    caption: "12px",
    body: "14px",
    bodyLg: "16px",
    title: "20px",
    display: "28px",
    hero: "36px",
  },
  tracking: {
    tight: "-0.01em",
    normal: "0em",
    loose: "0.04em",
  },
} as const;

/**
 * M1 — Liquid Glass. Web equivalent of `expo-blur` regular material. The
 * "elevation" axis (small/medium/large) maps to backdrop blur intensity
 * plus the tint that floats over the aurora layer.
 */
export const glass = {
  small: {
    blur: "12px",
    saturation: "140%",
    tintLight: "rgba(255, 255, 255, 0.55)",
    tintDark: "rgba(18, 18, 24, 0.45)",
    border: "rgba(255, 255, 255, 0.18)",
  },
  medium: {
    blur: "20px",
    saturation: "160%",
    tintLight: "rgba(255, 255, 255, 0.65)",
    tintDark: "rgba(20, 20, 28, 0.55)",
    border: "rgba(255, 255, 255, 0.22)",
  },
  large: {
    blur: "32px",
    saturation: "180%",
    tintLight: "rgba(255, 255, 255, 0.72)",
    tintDark: "rgba(22, 22, 32, 0.62)",
    border: "rgba(255, 255, 255, 0.28)",
  },
} as const;

export type GlassElevation = keyof typeof glass;

/**
 * M6 — 5-layer depth model (spec §7.1).
 *
 *   background  → aurora canvas, true-black on OLED
 *   ambient     → subtle texture / light reactor halos
 *   cards       → cards, lists, primary content
 *   foreground  → FABs, tab bar, sticky chrome (always above cards)
 *   modal       → sheets, popovers, dialogs (top of the stack)
 *
 * We expose each layer as a numeric z-index *and* a tilt magnitude (used by
 * `useGyroTilt`) so deeper layers shift more slowly than near ones.
 */
export const depth = {
  background: { z: 0, tilt: 0.25 },
  ambient: { z: 5, tilt: 0.5 },
  cards: { z: 10, tilt: 1 },
  foreground: { z: 30, tilt: 1.5 },
  modal: { z: 50, tilt: 2 },
} as const;

export type DepthLayer = keyof typeof depth;

/** Maximum gyro tilt in degrees (spec §7.1, M6). */
export const MAX_TILT_DEG = 4;

/**
 * M9 — Skeleton-to-content morph timing (also referenced by `motion.ts`).
 * Kept here so other modules can resolve the duration without importing
 * the motion preset.
 */
export const SKELETON_MORPH_MS = 320;

/**
 * M10 — All transitions must resolve through MotionSystem tokens. The
 * `lint-motion.mjs` script greps for raw `transition:` / `Easing.linear`
 * usages and points violators at this constant.
 */
export const MOTION_TOKEN_HINT =
  "Use MotionSystem.{whisper,soft,bouncy,elastic,snap,dramatic} from '@/theme/motion'";
