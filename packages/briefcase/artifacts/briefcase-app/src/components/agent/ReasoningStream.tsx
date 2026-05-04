import { motion, AnimatePresence } from "framer-motion";

interface ReasoningStreamProps {
  lines: string[];
}

export function ReasoningStream({ lines }: ReasoningStreamProps) {
  // Show the most recent ~3 reasoning lines, oldest at the top, in italic
  // muted text per the spec.
  const visible = lines.slice(-3);
  return (
    <div
      className="max-h-20 space-y-1 overflow-hidden text-xs italic text-muted-foreground"
      data-testid="reasoning-stream"
    >
      <AnimatePresence initial={false}>
        {visible.map((line, i) => (
          <motion.p
            key={`${i}-${line.slice(0, 24)}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="line-clamp-1"
          >
            {line}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}
