import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { DropZone } from "@/components/upload/DropZone";
import { PipelineReveal } from "@/components/upload/PipelineReveal";
import { useEventStream } from "@/lib/sse";
import {
  createCase,
  uploadToPresignedUrl,
  finalizeCase,
  createTextCase,
  eventStreamUrl,
  getVoiceUploadToken,
  completeVoiceUpload,
} from "@/lib/api";
import { useDocumentTitle } from "@/lib/hooks";

const SAMPLE_LETTER = `GREENWAY APARTMENTS LLC
1450 Mission Street, San Francisco, California 94103

October 12, 2026

To: Maria Hernandez
2200 Folsom St., Apt 4B
San Francisco, CA 94110

NOTICE TO QUIT — 3 DAYS

You are hereby notified that your tenancy is terminated. You must vacate the
premises within three (3) days of receiving this notice. The sheriff will
remove you and your belongings if you do not leave.

This notice is given without further explanation. We do not need to provide
any reason for terminating your tenancy.

— GREENWAY APARTMENTS LLC, Owner`;

export default function UploadPage() {
  useDocumentTitle("Upload — Lexor");
  const [, navigate] = useLocation();
  const [caseId, setCaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  // If the user arrived from a mid-call SMS bridge ("#voice=<token>"),
  // the upload feeds back into their active phone call instead of opening
  // a fresh case page.
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceDone, setVoiceDone] = useState(false);

  useEffect(() => {
    const m = /#voice=([a-f0-9]+)/i.exec(window.location.hash);
    if (m && m[1]) setVoiceToken(m[1]);
  }, []);
  const { events, isComplete, error } = useEventStream(
    caseId ? eventStreamUrl(caseId) : null,
  );

  // "Drop your letter anywhere on this screen" — wire drag/drop to the
  // window so users don't have to aim for the dashed box. We swallow the
  // default browser behavior (which would navigate to the file) on the
  // whole document, and only run our handler when the case hasn't started.
  useEffect(() => {
    if (caseId) return;
    function onOver(e: DragEvent) {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      setPageDrag(true);
    }
    function onLeave(e: DragEvent) {
      if (e.relatedTarget === null) setPageDrag(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      setPageDrag(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void startWithFile(f);
    }
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    if (isComplete && caseId) {
      const t = setTimeout(() => navigate(`/c/${caseId}`), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isComplete, caseId, navigate]);

  useEffect(() => {
    if (error) toast.error(`Pipeline error: ${error}`);
  }, [error]);

  async function startWithFile(file: File) {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      // Voice-bridge path: upload feeds the in-flight phone call instead
      // of opening a new browser case.
      if (voiceToken) {
        const t = await getVoiceUploadToken(voiceToken);
        await uploadToPresignedUrl(t.uploadURL, file, file.type);
        await completeVoiceUpload(voiceToken, t.objectPath, hash);
        setVoiceDone(true);
        setBusy(false);
        return;
      }
      const c = await createCase();
      if (!c.uploadURL || !c.objectPath) {
        throw new Error("Server did not return an upload URL — try again.");
      }
      await uploadToPresignedUrl(c.uploadURL, file, file.type);
      await finalizeCase(c.caseId, c.objectPath, hash);
      setCaseId(c.caseId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "upload failed");
      setBusy(false);
    }
  }

  async function startWithText(text: string) {
    setBusy(true);
    try {
      const id = await createTextCase(text);
      setCaseId(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "submission failed");
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 md:px-6 py-12 md:py-20">
      <div className="text-center mb-8">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight">
          Drop in any scary letter.
        </h1>
        <p className="mt-3 text-fg-muted">
          We'll explain it in plain language, find the laws on your side, and
          draft your response — in about 30&nbsp;seconds.
        </p>
      </div>

      {pageDrag && !caseId && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 bg-accent/10 ring-4 ring-inset ring-accent/40 flex items-center justify-center backdrop-blur-sm"
        >
          <div className="rounded-xl2 bg-bg-elevated/90 border border-accent px-6 py-4 text-fg font-display text-xl shadow-2xl">
            Release to scan your letter
          </div>
        </div>
      )}

      {voiceDone ? (
        <div className="rounded-2xl border border-accent/40 bg-accent/5 p-8 text-center">
          <div className="font-display text-2xl mb-2">Got it — return to your call.</div>
          <p className="text-sm text-fg-muted">
            We're analyzing the letter now. Lexor will read the response back to
            you on the phone in under a minute.
          </p>
        </div>
      ) : voiceToken && !caseId ? (
        <>
          <div className="mb-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-accent text-center">
            Mid-call upload — snap or pick the photo of your letter, then go back to your phone.
          </div>
          <DropZone onFile={startWithFile} onText={startWithText} busy={busy} />
        </>
      ) : !caseId ? (
        <>
          <DropZone onFile={startWithFile} onText={startWithText} busy={busy} />
          <div className="mt-6 text-center text-xs text-fg-subtle">
            No account needed. We don't sell your data.{" "}
            <button
              type="button"
              className="text-accent underline-offset-4 hover:underline"
              onClick={() => startWithText(SAMPLE_LETTER)}
              disabled={busy}
            >
              Try a sample eviction notice
            </button>
          </div>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid md:grid-cols-[260px_1fr] gap-6"
        >
          <ScannedFrame />
          <div>
            <div className="text-xs uppercase tracking-wider text-fg-subtle mb-3">
              Pipeline · {caseId.slice(0, 8)}
            </div>
            <PipelineReveal events={events} />
          </div>
          {isComplete && (
            <div className="mt-6 text-center text-sm text-accent">
              Done — opening your case…
            </div>
          )}
          {error && (
            <div className="mt-6 text-center text-sm text-violation md:col-span-2">
              {error}
            </div>
          )}
        </motion.div>
      )}
    </section>
  );
}

/**
 * Decorative "scanned page" frame shown next to the pipeline reveal.
 * Pure CSS — no real preview of the uploaded file (we keep raw text out
 * of the DOM). The intent is to give the user a visual anchor that says
 * "your document is being read right now".
 */
function ScannedFrame() {
  return (
    <div className="relative isolate overflow-hidden rounded-lg2 border border-border-strong bg-white/5 aspect-[3/4] min-h-[280px]">
      <div className="absolute inset-3 rounded-base bg-gradient-to-b from-white/[0.06] to-white/[0.02] border border-border p-4 flex flex-col gap-2">
        <FileText className="size-5 text-fg-muted" aria-hidden />
        <div className="h-2 w-3/4 rounded bg-fg/10" />
        <div className="h-2 w-1/2 rounded bg-fg/10" />
        <div className="mt-3 space-y-1.5" aria-hidden>
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded bg-fg/10"
              style={{ width: `${65 + ((i * 17) % 35)}%` }}
            />
          ))}
        </div>
      </div>
      <motion.div
        aria-hidden
        className="absolute inset-x-0 h-[2px] pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklch, var(--color-accent) 80%, transparent), transparent)",
          boxShadow:
            "0 0 18px color-mix(in oklch, var(--color-accent) 50%, transparent)",
        }}
        initial={{ top: 0 }}
        animate={{ top: ["0%", "100%", "0%"] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
