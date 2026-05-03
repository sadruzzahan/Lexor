import { isValidElement, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotionPref } from "@/lib/hooks";

type AsTag = "p" | "span" | "h1" | "h2" | "h3" | "li" | "div";

interface RevealTextProps {
  children: ReactNode;
  as?: AsTag;
  className?: string;
  delay?: number;
  stagger?: number;
}

function flattenToString(children: ReactNode): string {
  if (children === null || children === undefined) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flattenToString).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return flattenToString(children.props.children);
  }
  return "";
}

/**
 * Word-stagger reveal for long-copy blocks. Honors prefers-reduced-motion
 * with a simple fade. Splits the visible text into per-word spans for the
 * animation; assistive tech reads the full sentence via `aria-label` on the
 * container while the per-word spans are hidden with `aria-hidden="true"`.
 */
export function RevealText(props: RevealTextProps) {
  const { children, as = "p", className, delay = 0, stagger = 0.025 } = props;
  const reduced = useReducedMotionPref();
  const text = flattenToString(children);
  const words = text.split(/\s+/).filter(Boolean);

  const Tag = motion[as] as typeof motion.p;

  if (reduced) {
    return (
      <Tag
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: 0.25, delay }}
        className={className}
      >
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-10%" }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      aria-label={text}
    >
      <span aria-hidden="true">
        {words.map((w, i) => (
          <motion.span
            key={`${w}-${i}`}
            variants={{
              hidden: { opacity: 0, y: 12, filter: "blur(6px)" },
              show: { opacity: 1, y: 0, filter: "blur(0px)" },
            }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block mr-[0.25em]"
          >
            {w}
          </motion.span>
        ))}
      </span>
    </Tag>
  );
}
