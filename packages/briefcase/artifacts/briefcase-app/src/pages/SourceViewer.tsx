import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Share2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGetCaseFile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { GlassAppBar } from "@/components/GlassAppBar";
import { useApi } from "@/hooks/useApi";
import { selection } from "@/lib/haptics";
import { hashSnippet } from "@/components/agent/CitationChip";

// Lazy-import pdfjs-dist on mount so the heavy worker bundle isn't pulled
// onto the Cases home / CaseDetail screens. The legacy build is the
// browser-friendly entrypoint (no top-level Node imports).
//
// Vite resolves the worker URL at build time via `?url`.
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface Highlight {
  pageIndex: number; // 0-based
  spanIndices: number[]; // indices into the rendered text-layer span list
}

export default function SourceViewer() {
  const params = useParams<{ id: string; fileId: string }>();
  const caseId = params.id;
  const fileId = params.fileId;
  const reduce = useReducedMotion();

  // Read ?page= and ?q= from the URL on mount. Wouter doesn't expose query
  // params via `useParams`, so we read window.location directly. (G14 will
  // promote this to a `useSearchParams` hook once Wouter v4 ships it.)
  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const targetPage = (() => {
    const v = search.get("page");
    const n = v ? Number.parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const targetQuery = search.get("q") ?? "";
  const layoutId = `citation-${fileId}-${targetPage ?? "na"}-${
    targetQuery ? hashSnippet(targetQuery) : "na"
  }`;

  const { request } = useApi();
  const { data, isLoading, isError } = useGetCaseFile(caseId, fileId, {
    request,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [renderState, setRenderState] = useState<
    "idle" | "downloading" | "parsing" | "rendering" | "ready" | "error"
  >("idle");
  const [pageCount, setPageCount] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Render the PDF once the signed URL is ready.
  useEffect(() => {
    if (!data?.signedUrl || !containerRef.current) return;
    let cancelled = false;
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

    async function run() {
      try {
        setRenderState("downloading");
        // Authenticated fetch — the storage endpoint requires `x-demo-user`.
        // Use credentials/headers from the same `apiRequestOptions` that the
        // generated React Query hooks use, so dev/prod stay aligned.
        const headers = await buildAuthHeaders();
        const resp = await fetch(data!.signedUrl, { headers });
        if (!resp.ok) {
          throw new Error(`download failed (${resp.status})`);
        }
        const buf = await resp.arrayBuffer();
        if (cancelled) return;

        setRenderState("parsing");
        pdfDoc = await pdfjsLib.getDocument({
          data: buf,
          // Disable network range requests — we already have the full buffer.
          disableRange: true,
          disableStream: true,
        }).promise;
        if (cancelled) return;
        setPageCount(pdfDoc.numPages);

        setRenderState("rendering");
        pageRefs.current = new Array(pdfDoc.numPages).fill(null);
        // Render pages sequentially; the canvas/text-layer DOM is appended to
        // each page slot in order. For a 50-page demo this is well under a
        // second on a modern laptop.
        const containerWidth = containerRef.current!.clientWidth;
        const targetWidth = Math.min(containerWidth - 32, 920);

        const collected: Highlight[] = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const slot = pageRefs.current[i - 1];
          if (!slot) continue;
          slot.style.width = `${viewport.width}px`;
          slot.style.height = `${viewport.height}px`;
          // Wipe any previous content (re-runs from query change).
          slot.replaceChildren();

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          slot.appendChild(canvas);

          await page.render({
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;

          // Build the text layer for selection + highlight overlays.
          const textContent = await page.getTextContent();
          const textLayer = document.createElement("div");
          textLayer.className = "pdf-text-layer";
          slot.appendChild(textLayer);

          const spanRecords: Array<{ el: HTMLSpanElement; text: string }> = [];
          for (const item of textContent.items) {
            // pdf.js TextItem has `.str` and `.transform`; type-narrow.
            const t = item as { str?: string; transform?: number[]; width?: number; height?: number };
            if (typeof t.str !== "string" || !t.transform) continue;
            const tx = pdfjsLib.Util.transform(viewport.transform, t.transform);
            const fontHeight = Math.hypot(tx[2], tx[3]);
            const left = tx[4];
            const top = tx[5] - fontHeight;
            const span = document.createElement("span");
            span.textContent = t.str;
            span.style.left = `${left}px`;
            span.style.top = `${top}px`;
            span.style.fontSize = `${fontHeight}px`;
            span.style.fontFamily = "sans-serif";
            textLayer.appendChild(span);
            spanRecords.push({ el: span, text: t.str });
          }

          // Look for the cited query on this page. We do a case-insensitive
          // substring search across the *concatenated* text of the page so we
          // can highlight queries that span multiple text-layer spans (very
          // common — pdf.js often splits at glyph boundaries). When a hit is
          // found we mark every span whose character range overlaps the hit.
          if (targetQuery) {
            const matches = findMatches(spanRecords, targetQuery);
            for (const m of matches) {
              for (const idx of m) {
                spanRecords[idx]!.el.classList.add("violet-highlight");
              }
              collected.push({ pageIndex: i - 1, spanIndices: m });
            }
          }
        }

        if (cancelled) return;
        setHighlights(collected);
        setRenderState("ready");

        // Auto-jump: prefer the page-hint match if any; otherwise the first.
        if (collected.length > 0) {
          const preferred =
            (targetPage
              ? collected.findIndex((h) => h.pageIndex + 1 === targetPage)
              : -1);
          const idx = preferred >= 0 ? preferred : 0;
          setActiveMatchIdx(idx);
          requestAnimationFrame(() => scrollToMatch(idx, collected, reduce));
        } else if (targetPage) {
          // No textual match but we know the page — jump there anyway.
          requestAnimationFrame(() => {
            const slot = pageRefs.current[targetPage - 1];
            slot?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to render PDF";
        setErrorMessage(msg);
        setRenderState("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
      pdfDoc?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.signedUrl, targetQuery]);

  const goPrev = () => {
    if (highlights.length === 0) return;
    selection();
    const next = (activeMatchIdx - 1 + highlights.length) % highlights.length;
    setActiveMatchIdx(next);
    scrollToMatch(next, highlights, reduce);
  };
  const goNext = () => {
    if (highlights.length === 0) return;
    selection();
    const next = (activeMatchIdx + 1) % highlights.length;
    setActiveMatchIdx(next);
    scrollToMatch(next, highlights, reduce);
  };
  const share = async () => {
    selection();
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Source link copied to clipboard");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const subtitle = data?.name
    ? targetPage
      ? `${data.name} · p.${targetPage}`
      : data.name
    : undefined;

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-12"
      data-testid="source-viewer-screen"
    >
      <GlassAppBar
        title="Source"
        subtitle={subtitle}
        backHref={`/case/${caseId}`}
        backLabel="Back to case"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={goPrev}
              disabled={highlights.length === 0}
              data-testid="source-prev-anchor"
              aria-label="Previous citation"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span
              className="min-w-[3rem] text-center text-[11px] tabular-nums text-muted-foreground"
              data-testid="source-anchor-counter"
            >
              {highlights.length > 0
                ? `${activeMatchIdx + 1}/${highlights.length}`
                : "—"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={goNext}
              disabled={highlights.length === 0}
              data-testid="source-next-anchor"
              aria-label="Next citation"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={share}
              data-testid="source-share"
              aria-label="Share link"
            >
              <Share2 className="size-4" />
            </Button>
          </>
        }
      />

      {/* Citation chip → viewer shared-element transition: the chip carries
          layoutId="citation-{fileId}-{page}", so the viewer mirrors it on a
          small title pill near the top so framer-motion morphs the chip
          into the pill. */}
      <motion.div
        layoutId={reduce ? undefined : layoutId}
        className="mb-3 inline-flex w-fit items-center gap-1 self-start rounded-full border px-2.5 py-1 text-[11px] font-medium"
        style={{
          backgroundColor: "hsl(var(--violet) / 0.12)",
          borderColor: "hsl(var(--violet) / 0.35)",
          color: "hsl(var(--foreground))",
        }}
      >
        <FileText className="size-3" style={{ color: "hsl(var(--violet))" }} />
        <span className="max-w-[16rem] truncate">
          {data?.name ?? (isLoading ? "Loading…" : "Source")}
        </span>
        {typeof targetPage === "number" && (
          <span className="opacity-70">p.{targetPage}</span>
        )}
      </motion.div>

      {(isLoading || renderState === "downloading" || renderState === "parsing" || renderState === "rendering") && (
        <div
          className="flex flex-1 items-center justify-center gap-2 py-20 text-sm text-muted-foreground"
          data-testid="source-loading"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          <span>
            {renderState === "downloading"
              ? "Downloading…"
              : renderState === "parsing"
                ? "Parsing PDF…"
                : renderState === "rendering"
                  ? "Rendering…"
                  : "Loading…"}
          </span>
        </div>
      )}

      {(isError || renderState === "error") && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          data-testid="source-error"
        >
          {errorMessage ?? "Couldn't load this source. The file may have been deleted or is in an unsupported format."}
        </div>
      )}

      <div
        ref={containerRef}
        className="flex flex-col items-center gap-4"
        data-testid="source-pages"
      >
        {Array.from({ length: pageCount }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              pageRefs.current[i] = el;
            }}
            className="relative overflow-hidden rounded-md border bg-white shadow-sm"
            data-testid={`source-page-${i + 1}`}
            data-page={i + 1}
          />
        ))}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function buildAuthHeaders(): Promise<HeadersInit> {
  // `apiRequestOptions` is the same static `{ headers }` object the generated
  // React Query hooks pass to their fetch wrapper. Reusing it keeps the
  // signed-URL fetch authenticated under the demo `x-demo-user` header.
  const { apiRequestOptions } = await import("@/lib/api");
  return (apiRequestOptions as { headers?: Record<string, string> }).headers ?? {};
}

/**
 * Locate every occurrence of `needle` (case-insensitive) within the
 * concatenated page text, then map each occurrence back to the set of
 * text-layer span indices it overlaps. PDF.js often splits glyphs into many
 * single-character spans, so a single citation snippet typically spans
 * dozens of spans.
 */
function findMatches(
  records: Array<{ text: string }>,
  needle: string,
): number[][] {
  if (!needle.trim()) return [];

  // Build a concatenated string + a map from char-index → span-index.
  let combined = "";
  const charToSpan: number[] = [];
  for (let i = 0; i < records.length; i++) {
    const text = records[i]!.text;
    for (let j = 0; j < text.length; j++) {
      charToSpan.push(i);
    }
    combined += text;
  }

  // Normalize whitespace in both haystack and needle so a snippet harvested
  // from a model response (single-spaced) still matches a PDF that's full of
  // line breaks / non-breaking spaces.
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const haystack = norm(combined);
  // Build a parallel char-index map for the *normalized* haystack so we can
  // translate a hit position back to the original concat index, and from
  // there to span indices. We approximate by walking the original string and
  // emitting each kept character.
  const normToOrig: number[] = [];
  let last = "";
  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i]!;
    const lower = ch.toLowerCase();
    if (/\s/.test(ch)) {
      if (last !== " ") {
        normToOrig.push(i);
        last = " ";
      }
    } else {
      normToOrig.push(i);
      last = lower;
    }
  }

  const needleNorm = norm(needle);
  if (needleNorm.length === 0) return [];

  const out: number[][] = [];
  let from = 0;
  // Cap to a handful of matches to keep the highlight overlay readable.
  while (out.length < 16) {
    const hit = haystack.indexOf(needleNorm, from);
    if (hit < 0) break;
    const start = normToOrig[hit];
    const endNorm = hit + needleNorm.length - 1;
    const end = normToOrig[Math.min(endNorm, normToOrig.length - 1)];
    if (typeof start === "number" && typeof end === "number") {
      const spanSet = new Set<number>();
      for (let i = start; i <= end; i++) {
        const s = charToSpan[i];
        if (typeof s === "number") spanSet.add(s);
      }
      if (spanSet.size > 0) {
        out.push([...spanSet].sort((a, b) => a - b));
      }
    }
    from = hit + Math.max(needleNorm.length, 1);
  }
  return out;
}

function scrollToMatch(
  idx: number,
  highlights: Highlight[],
  reduce: boolean | null,
) {
  const h = highlights[idx];
  if (!h) return;
  // Pull the first highlighted span on that page into view.
  const pages = document.querySelectorAll<HTMLDivElement>(`[data-testid^="source-page-"]`);
  const slot = pages[h.pageIndex];
  if (!slot) return;
  const span = slot.querySelectorAll<HTMLSpanElement>(".pdf-text-layer > span")[
    h.spanIndices[0] ?? 0
  ];
  (span ?? slot).scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "center",
  });
  // Pulse the active match so the user sees which one is "current".
  if (span) {
    span.animate?.(
      [
        { boxShadow: "0 0 0 4px hsl(var(--violet) / 0.45)" },
        { boxShadow: "0 0 0 1px hsl(var(--violet) / 0.45)" },
      ],
      { duration: reduce ? 0 : 600, easing: "ease-out" },
    );
  }
}
