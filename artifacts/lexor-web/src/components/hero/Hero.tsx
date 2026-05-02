import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, PhoneCall } from "lucide-react";
import { ShaderBackground } from "./ShaderBackground";
import { useT } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import { useReducedMotionPref } from "@/lib/hooks";

function BlurFadeWords({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduced = useReducedMotionPref();
  const words = text.split(" ");
  return (
    <span className="inline">
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, filter: "blur(12px)" }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: reduced ? 0.2 : 0.7,
            delay: delay + i * 0.045,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="inline-block mr-[0.25em]"
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

export function Hero() {
  const { t, locale } = useT();
  const reduced = useReducedMotionPref();

  return (
    <section className="relative isolate overflow-hidden min-h-[88vh] flex items-center">
      <ShaderBackground />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-bg/60" />

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-20 sm:py-28 text-center">
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-bg-elevated/60 backdrop-blur px-3 py-1 text-xs font-mono text-fg-muted mb-8"
        >
          <span className="pulse-dot" aria-hidden />
          <span>
            {BRAND.name} · {locale.toUpperCase()} · {t("hero.live")}
          </span>
        </motion.div>

        <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-semibold leading-[1.05] tracking-tight">
          <BlurFadeWords text={BRAND.tagline[locale]} />
        </h1>

        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 sm:mt-8 max-w-2xl mx-auto text-base sm:text-lg text-fg-muted leading-relaxed"
        >
          {BRAND.subTagline[locale]}
        </motion.p>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.85, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6"
        >
          <Link
            href="/upload"
            className="shimmer-btn inline-flex items-center gap-2 rounded-base px-6 py-3 text-sm sm:text-base font-medium"
            data-testid="button-hero-upload"
          >
            {t("hero.cta.primary")}
            <ArrowRight className="h-4 w-4" />
          </Link>

          <a
            href={`tel:${BRAND.phone.replace(/[^+\d]/g, "")}`}
            className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition-colors"
            data-testid="link-hero-call"
          >
            <PhoneCall className="h-4 w-4" />
            <span>
              {t("hero.cta.secondary")} <span className="font-mono text-fg">{BRAND.phone}</span>
            </span>
            <span className="pulse-dot" aria-hidden />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
