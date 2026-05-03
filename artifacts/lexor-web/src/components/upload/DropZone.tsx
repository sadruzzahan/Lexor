import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload as UploadIcon, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onFile: (file: File) => void;
  onText: (text: string) => void;
  busy: boolean;
}

export function DropZone({ onFile, onText, busy }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) return;
      onFile(f);
    },
    [onFile],
  );

  return (
    <div className="relative">
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        animate={{
          borderColor: isDragging
            ? "var(--color-accent)"
            : "var(--color-border-strong)",
          scale: isDragging ? 1.01 : 1,
        }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "relative isolate overflow-hidden",
          "rounded-xl2 border-2 border-dashed",
          "bg-bg-elevated/40 backdrop-blur",
          "min-h-[420px] p-12 flex flex-col items-center justify-center text-center",
        )}
      >
        {/* Scanline */}
        <motion.div
          aria-hidden
          className="absolute inset-x-0 h-[2px] pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in oklch, var(--color-accent) 70%, transparent), transparent)",
            boxShadow:
              "0 0 24px color-mix(in oklch, var(--color-accent) 40%, transparent)",
          }}
          initial={{ top: 0 }}
          animate={{ top: ["0%", "100%", "0%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />

        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="rounded-full bg-bg-raised border border-border-strong p-5">
            <UploadIcon className="size-7 text-accent" aria-hidden />
          </div>
          <h2 className="font-display text-3xl md:text-4xl tracking-tight text-fg">
            Drop your letter anywhere on this screen.
          </h2>
          <p className="text-fg-muted max-w-xl">
            JPG, PNG, WebP, or PDF up to 10&nbsp;MB. We never share your
            documents. You can also{" "}
            <button
              type="button"
              className="text-accent underline-offset-4 hover:underline"
              onClick={() => setPasteOpen((v) => !v)}
            >
              paste the letter text
            </button>
            .
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="shimmer-btn rounded-base px-5 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Processing…" : "Choose a file"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>
      </motion.div>

      {pasteOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-base border border-border-strong bg-bg-elevated p-4"
        >
          <label
            htmlFor="paste-text"
            className="text-xs uppercase tracking-wider text-fg-muted"
          >
            Paste the letter text
          </label>
          <textarea
            id="paste-text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder="Paste the full text of the letter here…"
            className="mt-2 w-full rounded-base bg-bg-raised border border-border p-3 text-sm font-mono text-fg outline-none focus:border-accent"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={busy || pasteText.trim().length < 20}
              onClick={() => onText(pasteText.trim())}
              className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              <FileText className="inline size-4 mr-1.5" />
              Analyze pasted text
            </button>
            <span className="text-xs text-fg-subtle">
              We only run the legal pipeline; we don't keep raw text.
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
