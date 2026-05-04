import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/stores/agentRunStore";

interface ToolCallChipProps {
  call: ToolCall;
  index: number;
}

export function ToolCallChip({ call, index }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const StatusIcon =
    call.status === "success"
      ? CheckCircle2
      : call.status === "error"
        ? XCircle
        : Loader2;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-md border bg-background/60 text-xs"
      data-testid={`tool-call-${call.tool}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover-elevate"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <StatusIcon
          className={cn(
            "size-3 shrink-0",
            call.status === "success" && "text-emerald-500",
            call.status === "error" && "text-destructive",
            (call.status === "pending" || call.status === "running") &&
              "animate-spin text-primary",
          )}
        />
        <span className="font-mono text-[11px] font-medium">{call.tool}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t px-2 py-1.5 text-[11px] text-muted-foreground"
          >
            {Object.keys(call.args).length > 0 && (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            )}
            {call.resultPreview && (
              <p className="mt-1 line-clamp-3 text-foreground/80">
                {call.resultPreview}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
