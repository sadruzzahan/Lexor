import { createWorker, type Worker } from "tesseract.js";
import { jsPDF } from "jspdf";

let workerPromise: Promise<Worker> | null = null;

/**
 * Build a Tesseract.js worker that loads every asset from the app's own
 * origin (under `${BASE_URL}tesseract/`) instead of the default jsdelivr
 * CDN. This is what makes the scan path genuinely "offline-friendly" per
 * the G9 spec — once the SPA is loaded, OCR runs without any further
 * network access.
 *
 * The assets under `public/tesseract/` are copied from `tesseract.js` and
 * `tesseract.js-core` by `scripts/copy-tesseract-assets.mjs` (wired into
 * the package's `postinstall` hook), and `eng.traineddata.gz` is checked
 * into the repo.
 */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = import.meta.env.BASE_URL.endsWith("/")
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const tessRoot = `${base}tesseract`;
    workerPromise = createWorker("eng", 1, {
      workerPath: `${tessRoot}/worker.min.js`,
      corePath: tessRoot,
      langPath: tessRoot,
      // Skip the IndexedDB cache entirely so we never silently fall back
      // to a cached-from-CDN copy if the local asset is missing — the
      // load either succeeds with bundled bytes or fails loudly.
      cacheMethod: "none",
    });
  }
  return workerPromise;
}

export async function recognizeImage(
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const worker = await getWorker();
  const result = await worker.recognize(blob);
  if (onProgress) onProgress(1);
  return result.data.text ?? "";
}

export function joinOcrPages(pages: string[]): string {
  return pages
    .map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
    .join("\n\f\n");
}

export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

export async function readFileAsBlob(file: File): Promise<Blob> {
  return file;
}

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

interface ImageDims {
  dataUrl: string;
  width: number;
  height: number;
  format: "JPEG" | "PNG";
}

async function loadImage(file: File): Promise<ImageDims> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image decode failed"));
    el.src = dataUrl;
  });
  const format: "JPEG" | "PNG" =
    file.type === "image/png" ? "PNG" : "JPEG";
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight, format };
}

/**
 * Stitch every scanned page into a single multi-page PDF (one image per
 * page, each sized to fit the image's aspect ratio). The resulting Blob is
 * what we upload as the canonical bytes so the signed-URL preview shows
 * every page and the SHA-256 changes when the user adds/removes a page —
 * fixing the "first-page-only" idempotency footgun.
 */
export async function stitchPagesToPdf(files: File[]): Promise<Blob> {
  if (files.length === 0) throw new Error("No pages to stitch");
  const pages = await Promise.all(files.map(loadImage));
  // Use the first page's pixel dimensions as the document size (in pt at
  // 72dpi). jsPDF then scales subsequent pages to their own pixel size so
  // none of them are stretched.
  const first = pages[0]!;
  const doc = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "pt",
    format: [first.width, first.height],
  });
  doc.addImage(first.dataUrl, first.format, 0, 0, first.width, first.height);
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i]!;
    doc.addPage([p.width, p.height], p.width >= p.height ? "landscape" : "portrait");
    doc.addImage(p.dataUrl, p.format, 0, 0, p.width, p.height);
  }
  return doc.output("blob");
}
