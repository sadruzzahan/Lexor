/**
 * G17 / M6 — Gyro parallax helper.
 *
 * Reads `DeviceOrientationEvent` (the web equivalent of `expo-sensors`
 * `DeviceMotion`) and returns a clamped `{ x, y }` tilt in CSS-degrees,
 * capped at `MAX_TILT_DEG` (4°). Reduced-motion freezes the value at 0/0
 * so cards stay rock-still for users who asked the OS to limit motion.
 *
 * iOS Safari requires `DeviceOrientationEvent.requestPermission()` to be
 * invoked from a user gesture. Components that opt into tilt should wire
 * `requestGyroPermission()` to a button if they need it on iOS.
 */
import { useEffect, useState } from "react";
import { MAX_TILT_DEG } from "@/theme/tokens";
import { useReducedMotion } from "./useReducedMotion";

export interface GyroTilt {
  x: number;
  y: number;
}

interface IosOrientation {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export async function requestGyroPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const ctor = (window as unknown as {
    DeviceOrientationEvent?: IosOrientation & typeof DeviceOrientationEvent;
  }).DeviceOrientationEvent;
  if (!ctor || typeof ctor.requestPermission !== "function") return true;
  try {
    const result = await ctor.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export function useGyroTilt(scale = 1): GyroTilt {
  const reduced = useReducedMotion();
  const [tilt, setTilt] = useState<GyroTilt>({ x: 0, y: 0 });

  useEffect(() => {
    if (reduced || typeof window === "undefined") {
      setTilt({ x: 0, y: 0 });
      return;
    }
    if (typeof window.DeviceOrientationEvent === "undefined") return;

    const handler = (ev: DeviceOrientationEvent) => {
      // gamma → left/right (-90..90), beta → front/back (-180..180)
      const rawX = ((ev.gamma ?? 0) / 45) * MAX_TILT_DEG * scale;
      const rawY = ((ev.beta ?? 0) / 45) * MAX_TILT_DEG * scale;
      const clamp = (v: number) => Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, v));
      setTilt({ x: clamp(rawX), y: clamp(rawY) });
    };
    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [reduced, scale]);

  return tilt;
}
