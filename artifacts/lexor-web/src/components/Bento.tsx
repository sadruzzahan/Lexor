import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  FileScan,
  ScanSearch,
  MapPinned,
  Users2,
  PhoneCall,
  BookOpenCheck,
  Gavel,
  Quote,
} from "lucide-react";
import { useT, type TKey } from "@/lib/i18n";
import { useReducedMotionPref } from "@/lib/hooks";

interface BentoFeature {
  k: number;
  span: string;
  icon: typeof FileScan;
  titleKey: TKey;
  descKey: TKey;
}

const FEATURES: ReadonlyArray<BentoFeature> = [
  { k: 1, span: "md:col-span-2 md:row-span-2", icon: FileScan, titleKey: "bento.1.title", descKey: "bento.1.desc" },
  { k: 2, span: "md:col-span-2", icon: ScanSearch, titleKey: "bento.2.title", descKey: "bento.2.desc" },
  { k: 3, span: "md:col-span-2", icon: MapPinned, titleKey: "bento.3.title", descKey: "bento.3.desc" },
  { k: 4, span: "", icon: Users2, titleKey: "bento.4.title", descKey: "bento.4.desc" },
  { k: 5, span: "", icon: PhoneCall, titleKey: "bento.5.title", descKey: "bento.5.desc" },
  { k: 6, span: "md:col-span-2", icon: BookOpenCheck, titleKey: "bento.6.title", descKey: "bento.6.desc" },
  { k: 7, span: "", icon: Gavel, titleKey: "bento.7.title", descKey: "bento.7.desc" },
  { k: 8, span: "", icon: Quote, titleKey: "bento.8.title", descKey: "bento.8.desc" },
];

interface SplitInstance {
  words: HTMLElement[];
  revert?: () => void;
}

export function Bento() {
  const { t } = useT();
  const reduced = useReducedMotionPref();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    let cleanup = () => {};
    let cancelled = false;
    (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      type SplitTextCtor = new (target: Element, opts: { type: string }) => SplitInstance;
      let SplitTextCtor: SplitTextCtor | null = null;
      try {
        const splitMod = await import("gsap/SplitText");
        SplitTextCtor = (splitMod.SplitText as unknown) as SplitTextCtor;
      } catch {
        SplitTextCtor = null;
      }
      if (cancelled || !headingRef.current) return;
      gsap.registerPlugin(ScrollTrigger);

      let words: HTMLElement[] = [];
      let split: SplitInstance | null = null;
      if (SplitTextCtor) {
        try {
          gsap.registerPlugin(SplitTextCtor as unknown as gsap.Plugin);
          const instance = new SplitTextCtor(headingRef.current, { type: "words" });
          split = instance;
          words = instance.words;
        } catch {
          words = [];
        }
      }
      if (words.length === 0) {
        const text = headingRef.current.textContent ?? "";
        headingRef.current.innerHTML = text
          .split(" ")
          .map((w) => `<span class="inline-block will-change-transform">${w}</span>`)
          .join(" ");
        words = Array.from(headingRef.current.querySelectorAll("span"));
      }

      gsap.set(words, { yPercent: 110, opacity: 0 });
      const trigger = ScrollTrigger.create({
        trigger: headingRef.current,
        start: "top 80%",
        once: true,
        onEnter: () => {
          gsap.to(words, {
            yPercent: 0,
            opacity: 1,
            duration: 0.9,
            ease: "expo.out",
            stagger: 0.04,
          });
        },
      });

      cleanup = () => {
        trigger.kill();
        if (split && typeof split.revert === "function") split.revert();
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [reduced]);

  return (
    <section className="relative mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-28">
      <h2
        ref={headingRef}
        className="font-display text-3xl sm:text-5xl font-semibold tracking-tight max-w-3xl overflow-hidden"
      >
        {t("section.bento.heading")}
      </h2>
      <p className="mt-4 text-fg-muted max-w-2xl">{t("about.lead")}</p>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-4 md:auto-rows-[12rem] gap-3 sm:gap-4">
        {FEATURES.map(({ k, span, icon: Icon, titleKey, descKey }, i) => (
          <motion.article
            key={k}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: reduced ? 0.2 : 0.55, delay: reduced ? 0 : i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            className={`group relative overflow-hidden rounded-lg2 border border-border bg-bg-elevated/60 p-5 sm:p-6 hover:border-border-strong transition-colors ${span}`}
            data-testid={`bento-card-${k}`}
          >
            <div
              aria-hidden
              className="absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background:
                  "radial-gradient(closest-side, color-mix(in oklch, var(--color-accent) 22%, transparent), transparent 70%)",
              }}
            />
            <div className="flex items-center justify-between">
              <span className="kbd-chip">0{k}</span>
              <Icon className="h-5 w-5 text-fg-muted group-hover:text-accent transition-colors" />
            </div>
            <h3 className="mt-6 font-display text-lg sm:text-xl font-semibold tracking-tight">
              {t(titleKey)}
            </h3>
            <p className="mt-2 text-sm text-fg-muted leading-relaxed">{t(descKey)}</p>

            <div className="absolute inset-x-5 bottom-5 h-1 rounded-full bg-bg-raised overflow-hidden">
              {reduced ? (
                <div aria-hidden className="h-full bg-accent/70" style={{ width: "30%" }} />
              ) : (
                <motion.div
                  aria-hidden
                  className="h-full bg-accent/70"
                  initial={{ width: "10%" }}
                  animate={{ width: ["10%", "70%", "30%"] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
                />
              )}
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
