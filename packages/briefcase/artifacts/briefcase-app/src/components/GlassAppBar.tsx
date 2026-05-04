import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { selection } from "@/lib/haptics";

interface GlassAppBarProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  /** Right-side action slot (buttons, etc). */
  actions?: ReactNode;
}

/**
 * Liquid-glass app bar — the web stand-in for the spec's `<GlassTabBar>`.
 *
 * Briefcase uses Wouter stack routing on the web (no tabs), so the
 * morally-equivalent piece of floating chrome is a top app bar. It
 *   - sticks to the top with a translucent backdrop-filter blur,
 *   - shrinks its height + tightens its title as the page scrolls
 *     (driven by framer-motion's `useScroll` + `useTransform`),
 *   - and is fully static under `prefers-reduced-motion`.
 */
export function GlassAppBar({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  actions,
}: GlassAppBarProps) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [shrunk, setShrunk] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    setShrunk(y > 12);
  });

  // When reduced-motion is on we skip the shrink transforms entirely; the bar
  // stays at full height and titles don't reflow.
  const titleScale = useTransform(scrollY, [0, 80], [1, 0.86]);
  const titleY = useTransform(scrollY, [0, 80], [0, -2]);
  const padY = useTransform(scrollY, [0, 80], [14, 8]);

  useEffect(() => {
    // Make sure the body has padding for the floating bar so first-paint
    // content isn't hidden underneath it on slow networks.
    document.body.classList.add("has-glass-app-bar");
    return () => document.body.classList.remove("has-glass-app-bar");
  }, []);

  return (
    <motion.header
      data-testid="glass-app-bar"
      data-shrunk={shrunk ? "1" : "0"}
      className={cn(
        "sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 px-4",
        "border-b border-white/10 dark:border-white/5",
        "bg-background/55 backdrop-blur-2xl backdrop-saturate-150",
        "supports-[backdrop-filter]:bg-background/45",
        "transition-shadow",
        shrunk && "shadow-[0_2px_24px_-8px_hsl(var(--violet)/0.35)]",
      )}
      style={reduce ? { paddingTop: 14, paddingBottom: 14 } : { paddingTop: padY, paddingBottom: padY }}
    >
      {backHref ? (
        <Link
          href={backHref}
          onClick={() => selection()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          data-testid="glass-app-bar-back"
          aria-label={backLabel}
        >
          <ArrowLeft className="size-4" />
        </Link>
      ) : null}

      <motion.div
        className="min-w-0 flex-1"
        style={reduce ? undefined : { scale: titleScale, y: titleY, transformOrigin: "left center" }}
      >
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </motion.div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </motion.header>
  );
}
