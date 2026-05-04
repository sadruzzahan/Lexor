/**
 * G17 — Design system barrel.
 *
 * Re-exports the token / motion / haptics / sounds / glass modules so the
 * rest of the app can `import { MotionSystem, liquidGlass, HapticSystem }
 * from '@/theme'` without remembering individual file paths.
 */
export * from "./tokens";
export * from "./motion";
export * from "./haptics";
export * from "./sounds";
export * from "./glass";
