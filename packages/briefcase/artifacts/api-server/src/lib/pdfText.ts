/**
 * Lightweight PDF text extraction wrapper around `pdf-parse` (v2.x ESM).
 *
 * Spec §9.5 calls for E2B (PyMuPDF + Tesseract OCR). For G8 we ship the
 * text-PDF fast path only — image-only / scanned PDFs will return text:""
 * and the caller surfaces an `error` IngestEvent (`ocr-not-supported`).
 * E2B-backed OCR is left for G9 (camera ingest) where we already need a
 * Python sandbox for Tesseract.
 */
import { PDFParse } from "pdf-parse";

interface PdfTextResult {
  text: string;
  pageCount: number;
}

export async function extractPdfText(buf: Buffer): Promise<PdfTextResult> {
  // pdf-parse v2 wants a Uint8Array (not a Buffer's underlying ArrayBuffer
  // slice) — Buffer IS a Uint8Array, but we copy into a fresh view to be
  // safe on the offset/length boundaries.
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  // Declare BEFORE the try so a constructor failure (invalid header, etc.)
  // still leaves `parser` in scope for the finally cleanup.
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data });
    const result = await parser.getText();
    return {
      text: (result.text ?? "").trim(),
      pageCount: result.pages?.length ?? 0,
    };
  } finally {
    // The pdfjs document holds a worker port; release it so the process
    // can exit cleanly after batch ingest.
    if (parser) await parser.destroy?.().catch(() => undefined);
  }
}
