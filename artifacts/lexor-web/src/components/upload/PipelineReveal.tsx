import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, AlertCircle } from "lucide-react";
import type { PipelineEvent } from "@/lib/sse";

const STEP_LABEL: Record<string, string> = {
  vision: "Reading your letter",
  classify: "Identifying the document type",
  rules: "Checking what they did wrong",
  grounding: "Locating your rights",
  draft: "Drafting your response",
  complaints: "Preparing regulator complaints",
  adversary: "Pulling their record",
  coalition: "Looking for your coalition",
};

const STEP_ORDER = [
  "vision",
  "classify",
  "rules",
  "grounding",
  "draft",
  "complaints",
  "adversary",
  "coalition",
];

interface StepCard {
  step: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}

function reduceEvents(events: PipelineEvent[]): StepCard[] {
  const map = new Map<string, StepCard>();
  for (const ev of events) {
    if (!ev.step || ev.step === "init") continue;
    const existing = map.get(ev.step) ?? {
      step: ev.step,
      label: STEP_LABEL[ev.step] ?? ev.step,
      status: "running" as const,
    };
    if (ev.type === "step_start") {
      map.set(ev.step, { ...existing, status: "running" });
    } else if (ev.type === "step_complete") {
      map.set(ev.step, {
        ...existing,
        status: "done",
        detail: formatDetail(ev.step, ev.data),
      });
    } else if (ev.type === "error") {
      map.set(ev.step, {
        ...existing,
        status: "error",
        detail: ev.message,
      });
    }
  }
  return STEP_ORDER.filter((s) => map.has(s)).map((s) => map.get(s)!);
}

function formatDetail(step: string, data: unknown): string | undefined {
  if (!data || typeof data !== "object") return;
  const d = data as Record<string, unknown>;
  switch (step) {
    case "vision":
      return d.documentType
        ? `Recognized: ${String(d.documentType)}${d.sender ? ` from ${String(d.sender)}` : ""}`
        : undefined;
    case "classify":
      return d.vertical
        ? `Vertical: ${String(d.vertical)}${d.jurisdiction ? ` · ${String(d.jurisdiction)}` : ""}`
        : undefined;
    case "rules":
      return typeof d.count === "number"
        ? `${d.count} violation${d.count === 1 ? "" : "s"} detected`
        : undefined;
    case "grounding":
      return typeof d.groundedCount === "number"
        ? `${d.groundedCount} statute${d.groundedCount === 1 ? "" : "s"} cited`
        : undefined;
    case "draft":
      return "Response ready to send";
    case "complaints":
      return Array.isArray(d.agencies) && d.agencies.length > 0
        ? `Drafted for: ${(d.agencies as string[]).join(", ")}`
        : "No regulator filings needed";
    default:
      return undefined;
  }
}

export function PipelineReveal({ events }: { events: PipelineEvent[] }) {
  const cards = reduceEvents(events);

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {cards.map((c) => (
          <motion.div
            key={c.step}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-base border border-border-strong bg-bg-elevated px-5 py-4 flex items-start gap-4"
          >
            <div className="mt-0.5">
              {c.status === "running" ? (
                <Loader2 className="size-5 text-accent animate-spin" />
              ) : c.status === "done" ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 18 }}
                >
                  <Check className="size-5 text-accent" />
                </motion.div>
              ) : (
                <AlertCircle className="size-5 text-violation" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-fg">{c.label}…</div>
              {c.detail && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1 text-xs text-fg-muted"
                >
                  {c.detail}
                </motion.div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
