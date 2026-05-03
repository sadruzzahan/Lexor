import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, ShieldAlert, X, Download, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { CaseRow, RegulatorComplaint, Violation } from "@/lib/api";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-violation/20 text-violation border-violation/40",
  high: "bg-violation/15 text-violation border-violation/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-fg/10 text-fg-muted border-border-strong",
};

export function CounterAttack({ row }: { row: CaseRow }) {
  const violations = row.violations ?? [];
  const complaints = row.regulatorComplaints ?? [];
  const [active, setActive] = useState<RegulatorComplaint | null>(null);

  if (violations.length === 0) {
    return (
      <div className="rounded-lg2 border border-border-strong bg-bg-elevated p-8 text-center">
        <ShieldAlert className="size-8 text-fg-muted mx-auto" />
        <h3 className="font-display text-xl mt-3">No violations detected</h3>
        <p className="text-fg-muted mt-2 max-w-md mx-auto text-sm">
          We didn't find a clear statutory violation in this letter. That doesn't
          mean it's fine — consider running it past a licensed attorney.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {violations.map((v: Violation, i: number) => {
          const complaint = complaints.find((c) => c.agency === v.agency);
          return (
            <motion.div
              key={v.code}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-lg2 border border-border-strong bg-bg-elevated p-5"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <span
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-base border ${SEVERITY_STYLE[v.severity] ?? SEVERITY_STYLE.low}`}
                >
                  {v.severity}
                </span>
                <a
                  href={v.citationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1"
                >
                  {v.statute}
                  <ExternalLink className="size-3" />
                </a>
              </div>
              <h3 className="font-display text-lg mt-2 text-fg">{v.code}</h3>
              <p className="mt-2 text-fg-muted text-sm leading-relaxed">
                {v.description}
              </p>
              {complaint && (
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setActive(complaint)}
                    className="shimmer-btn rounded-base px-3 py-1.5 text-xs font-medium"
                  >
                    File complaint with {complaint.agency}
                  </button>
                  <span className="text-xs text-fg-subtle">
                    {complaint.agencyLabel}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {active && <ComplaintModal complaint={active} onClose={() => setActive(null)} />}
      </AnimatePresence>
    </>
  );
}

function ComplaintModal({
  complaint,
  onClose,
}: {
  complaint: RegulatorComplaint;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function copyDraft() {
    void navigator.clipboard.writeText(complaint.draftPlainText).then(() => {
      setCopied(true);
      toast.success("Complaint text copied");
      setTimeout(() => setCopied(false), 1500);
    });
  }
  function downloadPdf() {
    const blob = new Blob([complaint.draftHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups to download.");
      return;
    }
    setTimeout(() => {
      w.print();
      URL.revokeObjectURL(url);
    }, 400);
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl2 border border-border-strong bg-bg-elevated"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 border-b border-border bg-bg-elevated">
          <div>
            <div className="text-xs uppercase tracking-wider text-fg-subtle">
              Draft complaint
            </div>
            <div className="font-display text-lg text-fg">
              {complaint.agencyLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ghost-btn rounded-base p-2"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-border bg-warning/10 text-xs text-warning">
          <strong>You are filing this complaint personally.</strong> Lexor is
          preparing the document at your direction; we don't submit on your
          behalf. Citations come from a curated, hand-verified statute corpus
          (CA / TX / NY plus federal FDCPA + FLSA) — confirm the contents are
          accurate and consider consulting a licensed attorney before you file.
        </div>

        <div className="px-6 py-5">
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans text-fg">
            {complaint.draftPlainText}
          </pre>
        </div>

        <div className="px-6 pb-5">
          <div className="text-xs uppercase tracking-wider text-fg-subtle mb-2">
            How to file
          </div>
          <ol className="space-y-1.5 text-sm text-fg-muted list-decimal list-inside">
            {complaint.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>

        <div className="sticky bottom-0 px-6 py-4 border-t border-border bg-bg-elevated flex items-center justify-end gap-2 flex-wrap">
          <button type="button" onClick={onClose} className="ghost-btn rounded-base px-3 py-2 text-sm">
            Close
          </button>
          <button
            type="button"
            onClick={copyDraft}
            className="ghost-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
          >
            {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
            Copy text
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            className="ghost-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
          >
            <Download className="size-4" />
            Download PDF
          </button>
          <a
            href={complaint.filingUrl}
            target="_blank"
            rel="noreferrer"
            className="shimmer-btn rounded-base px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            Open {complaint.agency} portal
            <ExternalLink className="size-4" />
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}
