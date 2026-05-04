/**
 * G17 — Liquid Glass surface helper.
 *
 * Native plan used `expo-blur` regular material with three intensity tiers
 * (small/medium/large). On web we resolve each tier to a CSS style block
 * driving `backdrop-filter` + a tint over the aurora layer.
 *
 * Usage:
 *   <SheetContent style={liquidGlass('large')}>…</SheetContent>
 *   <Popover style={liquidGlass('small')}>…</Popover>
 *
 * Dark-mode tint is applied automatically when the document carries the
 * `dark` class (matches shadcn / next-themes convention).
 */
import type { CSSProperties } from "react";
import { glass, type GlassElevation } from "./tokens";

function inDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function liquidGlass(elevation: GlassElevation = "medium"): CSSProperties {
  const tier = glass[elevation];
  const tint = inDarkMode() ? tier.tintDark : tier.tintLight;
  const blur = `blur(${tier.blur}) saturate(${tier.saturation})`;
  return {
    backgroundColor: tint,
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
    border: `1px solid ${tier.border}`,
  };
}

/**
 * Tailwind class string variant — useful when you can't pass a `style` prop
 * (e.g. inside `cn()` calls). Pair with the `.glass-*` utilities defined in
 * `index.css` so `dark:` variants and reduced-transparency overrides stay
 * in CSS land.
 */
export function liquidGlassClass(elevation: GlassElevation = "medium"): string {
  switch (elevation) {
    case "small":
      return "glass glass-sm";
    case "large":
      return "glass glass-lg";
    case "medium":
    default:
      return "glass glass-md";
  }
}
