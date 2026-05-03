import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { DropZone } from "@/components/upload/DropZone";
import { PipelineReveal } from "@/components/upload/PipelineReveal";
import { useEventStream } from "@/lib/sse";
import {
  createCase,
  uploadToPresignedUrl,
  finalizeCase,
  createTextCase,
  eventStreamUrl,
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

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function UploadPage() {
  useDocumentTitle("Upload — Lexor");
  const [, navigate] = useLocation();
  const [caseId, setCaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { events, isComplete, error } = useEventStream(
    caseId ? eventStreamUrl(caseId) : null,
  );

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
      const c = await createCase();
      await uploadToPresignedUrl(c.uploadURL, file, file.type);
      const buf = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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

      {!caseId ? (
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
        >
          <div className="text-xs uppercase tracking-wider text-fg-subtle mb-3">
            Pipeline · {caseId.slice(0, 8)}
          </div>
          <PipelineReveal events={events} />
          {isComplete && (
            <div className="mt-6 text-center text-sm text-accent">
              Done — opening your case…
            </div>
          )}
          {error && (
            <div className="mt-6 text-center text-sm text-violation">
              {error}
            </div>
          )}
        </motion.div>
      )}
    </section>
  );
}
