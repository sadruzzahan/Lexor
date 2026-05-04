/**
 * G20 — Jurisdiction Bloom.
 *
 * Renders an inline jurisdiction badge with a flag emoji + label. On
 * first appearance per session per (caseOrSessionId, country) the badge
 * "blooms" — an expanding violet ring radiates outward and the badge
 * itself fades + scales in. Reduced-motion degrades to a static chip.
 *
 * The aurora theme shift the spec calls for is wired separately via
 * AmbientReactor (cooler tones for EU contexts) — this component is
 * the visual badge only so it can be slotted into any header.
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { markIfFirst } from "@/lib/sessionFirsts";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const FLAGS: Record<string, string> = {
  US: "🇺🇸",
  UK: "🇬🇧",
  IN: "🇮🇳",
  EU: "🇪🇺",
};

const LABELS: Record<string, string> = {
  US: "US · FRE",
  UK: "UK · Civil Evidence",
  IN: "India · IEA",
  EU: "EU · GDPR",
};

interface Props {
  /** Country code — drives flag, label, and ring color. */
  country: string;
  /** Anchor key for the once-per-session bloom guard. */
  anchorId: string;
  testId?: string;
}

export function JurisdictionBadge({ country, anchorId, testId }: Props) {
  const reduced = useReducedMotion();
  const [bloom, setBloom] = useState(false);
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (!country || !anchorId) return;
    const key = `jurisdiction-bloom:${anchorId}:${country}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (markIfFirst(key)) setBloom(true);
  }, [country, anchorId]);

  const flag = FLAGS[country] ?? "🏳️";
  const label = LABELS[country] ?? country;

  return (
    <span
      className="relative inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--violet)/0.45)] bg-[hsl(var(--violet)/0.10)] px-2.5 py-0.5 text-[11px] font-medium text-[hsl(var(--violet))]"
      data-testid={testId ?? "jurisdiction-badge"}
      data-country={country}
    >
      <motion.span
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={
          reduced
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 320, damping: 20 }
        }
        aria-hidden
      >
        {flag}
      </motion.span>
      <span>{label}</span>
      <AnimatePresence>
        {bloom && !reduced && (
          <motion.span
            key="ring"
            aria-hidden
            initial={{ scale: 0.6, opacity: 0.6 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            onAnimationComplete={() => setBloom(false)}
            className="pointer-events-none absolute inset-0 rounded-full border border-[hsl(var(--violet)/0.7)]"
          />
        )}
      </AnimatePresence>
    </span>
  );
}
