/**
 * G17 / M5 — Aurora background.
 *
 * Native plan used a Skia mesh-gradient shader. On web we paint the same
 * three drifting blobs into a `<canvas>` with radial gradients and `mix-
 * blend-mode: screen` for the soft "aurora" effect. The component owns the
 * RAF loop; `<AmbientReactor>` modulates `intensity` / `colorDrift` from
 * the agent run stream.
 *
 * Reduced-motion → static gradient (one paint, no RAF).
 * Throttle to 30 fps when `lowBattery` is true (spec §7.1, M5).
 */
import { useEffect, useRef } from "react";
import { ACCENT_VIOLET, HOLO_MARKER } from "@/theme/tokens";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export interface AuroraProps {
  /** 0–1 — drives blob radius + opacity. AmbientReactor pushes this. */
  intensity?: number;
  /** 0–1 — extra hue rotation when subagents are working. */
  colorDrift?: number;
  /** True when battery is below 20% — throttle to 30 fps. */
  lowBattery?: boolean;
  /** Use OLED true-black backdrop fill behind the blobs. */
  trueBlack?: boolean;
}

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  baseRadius: number;
}

const PALETTE = [
  ACCENT_VIOLET,
  HOLO_MARKER,
  "#5BB4FF", // Replit-blue accent — completes the trio for the mesh.
];

function makeBlobs(width: number, height: number): Blob[] {
  return PALETTE.map((_, i) => ({
    x: width * (0.25 + i * 0.25),
    y: height * (0.3 + i * 0.2),
    vx: (Math.random() - 0.5) * 12,
    vy: (Math.random() - 0.5) * 12,
    hue: i * 30,
    baseRadius: Math.max(width, height) * 0.45,
  }));
}

export function AuroraCanvas({
  intensity = 0.6,
  colorDrift = 0,
  lowBattery = false,
  trueBlack = false,
}: AuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas || !ctx) return;
      const { innerWidth, innerHeight } = window;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      blobsRef.current = makeBlobs(innerWidth, innerHeight);
    }
    resize();
    window.addEventListener("resize", resize);

    const targetFps = lowBattery ? 30 : 60;
    const frameInterval = 1000 / targetFps;

    function paint(now: number) {
      if (!canvas || !ctx) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const tint = trueBlack ? "#000000" : "rgba(8, 8, 14, 0.0)";

      // Backdrop wash. Slight alpha keeps a smear trail behind drifting
      // blobs which reads as "aurora" rather than three crisp circles.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = trueBlack ? tint : "rgba(8, 8, 14, 0.18)";
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "screen";
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;

      blobsRef.current.forEach((blob, i) => {
        if (!reduced) {
          blob.x += blob.vx * dt;
          blob.y += blob.vy * dt;
          if (blob.x < 0 || blob.x > w) blob.vx *= -1;
          if (blob.y < 0 || blob.y > h) blob.vy *= -1;
        }
        const radius = blob.baseRadius * (0.6 + intensity * 0.6);
        const hueShift = colorDrift * 60;
        const color = PALETTE[i % PALETTE.length]!;
        const grad = ctx.createRadialGradient(
          blob.x,
          blob.y,
          0,
          blob.x,
          blob.y,
          radius,
        );
        const alpha = (0.35 + intensity * 0.4).toFixed(3);
        grad.addColorStop(0, hexWithAlpha(color, alpha));
        grad.addColorStop(1, hexWithAlpha(color, "0"));
        ctx.fillStyle = grad;
        ctx.filter = `hue-rotate(${hueShift}deg)`;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.filter = "none";
    }

    function tick(now: number) {
      if (now - lastFrameRef.current >= frameInterval) {
        paint(now);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    if (reduced) {
      // Single paint, no RAF — static aurora for users who asked the OS to
      // calm motion down. Still pretty; just doesn't drift.
      lastFrameRef.current = performance.now();
      paint(lastFrameRef.current);
    } else {
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [intensity, colorDrift, lowBattery, trueBlack, reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="aurora-canvas"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ filter: "blur(60px)" }}
    />
  );
}

function hexWithAlpha(hex: string, alpha: string): string {
  const h = hex.replace("#", "");
  const bigint = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
