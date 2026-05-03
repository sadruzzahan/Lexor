import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Download, Check, Sparkles, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { CaseRow } from "@/lib/api";
import { useInjectedDefenses, selectInjectedFor } from "@/lib/defenseInjection";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function Typewriter({ text, speed = 8 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!text) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setShown((n) => {
        const next = Math.min(n + speed, text.length);
        if (next < text.length) requestAnimationFrame(tick);
        return next;
      });
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [text, speed]);
  return (
    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans text-fg">
      {text.slice(0, shown)}
      {shown < text.length && (
        <span
          aria-hidden
          className="inline-block w-[0.4ch] h-[1em] -mb-[0.15em] bg-accent ml-[1px] align-middle"
          style={{ animation: "lexor-pulse 1s step-end infinite" }}
        />
      )}
    </pre>
  );
}

export function Defense({ row }: { row: CaseRow }) {
  const letter = row.responseLetter;
  const parsed = row.parsed as
    | { documentType?: string; keyClaims?: string[]; sender?: { name?: string | null } }
    | null;
  const [copied, setCopied] = useState(false);
  const injected = useInjectedDefenses(selectInjectedFor(row.id));
  const removeInjected = useInjectedDefenses((s) => s.remove);

  const summary = parsed?.documentType
    ? `This is a ${parsed.documentType.toLowerCase()}${parsed.sender?.name ? ` from ${parsed.sender.name}` : ""}.`
    : "Plain-language summary of your letter.";

  function combinedPlainText(): string {
    if (!letter) return "";
    if (injected.length === 0) return letter.plainText;
    const extras = injected
      .map(
        (d, i) =>
          `\n\n[Additional ground ${i + 1} — from ${d.fromEntityName} dossier]\n${d.bodyParagraph}\n(Cf. ${d.citation})`,
      )
      .join("");
    return letter.plainText + extras;
  }

  function copyEmail() {
    if (!letter) return;
    void navigator.clipboard.writeText(combinedPlainText()).then(() => {
      setCopied(true);
      toast.success("Email body copied");
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function downloadPdf() {
    if (!letter) return;
    const extrasHtml =
      injected.length === 0
        ? ""
        : `<hr style="margin:32px 0;border:none;border-top:1px solid #ddd"/>` +
          injected
            .map(
              (d, i) =>
                `<p><strong>Additional ground ${i + 1}</strong> — from ${escapeHtml(
                  d.fromEntityName,
                )} dossier</p><p>${escapeHtml(d.bodyParagraph)}</p><p><em>Cf. ${escapeHtml(d.citation)}</em></p>`,
            )
            .join("");
    const html = letter.html.replace("</body>", `${extrasHtml}</body>`);
    const blob = new Blob([html], { type: "text/html" });
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
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg2 border border-border-strong bg-bg-elevated p-5"
      >
        <div className="text-xs uppercase tracking-wider text-fg-subtle">
          What this letter says
        </div>
        <p className="mt-2 text-fg leading-relaxed">{summary}</p>
        {parsed?.keyClaims && parsed.keyClaims.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
            {parsed.keyClaims.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 size-1 rounded-full bg-accent shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      {!letter ? (
        <div className="text-fg-muted text-sm">
          Response letter still drafting…
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg2 border border-border-strong bg-bg-elevated p-5"
        >
          <div className="flex items-center justify-between mb-4 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-fg-subtle">
                Your response
              </div>
              <h3 className="font-display text-xl mt-1">{letter.subject}</h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={copyEmail}
                className="ghost-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
              >
                {copied ? (
                  <Check className="size-4 text-accent" />
                ) : (
                  <Copy className="size-4" />
                )}
                Copy email
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                className="shimmer-btn rounded-base px-3 py-2 text-sm inline-flex items-center gap-2"
              >
                <Download className="size-4" />
                Download PDF
              </button>
            </div>
          </div>
          <div className="rounded-base bg-bg-raised border border-border p-5 max-h-[60vh] overflow-y-auto">
            <Typewriter text={letter.plainText} />
            {injected.length > 0 && (
              <div className="mt-6 pt-6 border-t border-border space-y-4">
                {injected.map((d, i) => (
                  <div
                    key={d.id}
                    className="rounded-base border border-accent/30 bg-accent/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
                        <Sparkles className="size-3.5" />
                        Additional ground {i + 1} — from {d.fromEntityName}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeInjected(row.id, d.id)}
                        className="text-fg-subtle hover:text-fg"
                        aria-label="Remove this defense"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 font-medium text-sm text-fg">{d.title}</div>
                    <p className="mt-1.5 text-sm text-fg leading-relaxed">
                      {d.bodyParagraph}
                    </p>
                    <a
                      href={d.citationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      {d.citation} <ExternalLink className="size-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
          {letter.deliveryHints && letter.deliveryHints.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-xs text-fg-muted">
              {letter.deliveryHints.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1 rounded-full bg-accent shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          )}
          {letter.strippedCitations && letter.strippedCitations.length > 0 && (
            <div className="mt-3 text-xs text-violation">
              We removed {letter.strippedCitations.length} unverified citation(s) for safety.
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
