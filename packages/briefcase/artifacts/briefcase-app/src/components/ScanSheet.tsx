import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Camera, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  startCaseRun,
  uploadCaseFile,
  useCreateCase,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/hooks/useApi";
import {
  blobToObjectUrl,
  joinOcrPages,
  recognizeImage,
  stitchPagesToPdf,
} from "@/lib/ocr";
import { apiRequestOptions } from "@/lib/api";
import { showUndoToast } from "@/components/UndoToast";

interface ScanPage {
  id: string;
  file: File;
  previewUrl: string;
  ocrText: string | null;
  ocrError: string | null;
  ocrInFlight: boolean;
}

/**
 * Best-effort detection of "user dismissed the camera / denied permission".
 * `<input type="file" capture="…">` does not surface a permission API to JS,
 * so all we can observe is "the user opened the picker and it returned no
 * files". We track whether the user pressed our launch button and reset the
 * hint when they actually pick something.
 */
function CameraHelp({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
      data-testid="scan-permission-help"
    >
      No image was captured. If your browser blocked the camera, open your
      browser settings (Site Settings → Camera) and allow access for this
      page, then try again.
    </p>
  );
}

interface ScanSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, scanned pages are uploaded to this case. Otherwise a new case is created. */
  caseId?: string;
}

/**
 * G9 — camera scan + on-device OCR (web).
 *
 * The native task spec (`react-native-document-scanner-plugin` +
 * `@react-native-ml-kit/text-recognition`) maps onto the web by:
 *  - using `<input type="file" accept="image/*" capture="environment"
 *    multiple>` for the camera scanner (mobile browsers surface the system
 *    capture sheet; desktop falls back to a file picker so the demo still
 *    works on a laptop), and
 *  - running Tesseract.js in-browser as the on-device OCR engine.
 *
 * Pages are reviewed (delete / retake), each page is OCR'd locally, then the
 * concatenated text is uploaded alongside the original image bytes via R-06
 * with `sourceType: 'scan'`. The server stores the OCR text into
 * `case_files.ocr_text` and skips its own parse step.
 */
export default function ScanSheet({
  open,
  onOpenChange,
  caseId,
}: ScanSheetProps) {
  const [, setLocation] = useLocation();
  const { request } = useApi();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPermissionHint, setShowPermissionHint] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const retakeIndexRef = useRef<number | null>(null);
  const launchedRef = useRef(false);

  const createCase = useCreateCase({ request });

  // Revoke any object URLs we minted when the sheet closes / unmounts so we
  // don't leak blob handles for every retake.
  useEffect(() => {
    return () => {
      pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) {
      pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPages([]);
      retakeIndexRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function startOcrForPage(pageId: string, file: File) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId ? { ...p, ocrInFlight: true, ocrError: null } : p,
      ),
    );
    recognizeImage(file)
      .then((text) => {
        setPages((prev) =>
          prev.map((p) =>
            p.id === pageId
              ? { ...p, ocrText: text, ocrInFlight: false }
              : p,
          ),
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "OCR failed";
        setPages((prev) =>
          prev.map((p) =>
            p.id === pageId
              ? { ...p, ocrError: msg, ocrInFlight: false }
              : p,
          ),
        );
      });
  }

  function handleFilesSelected(ev: React.ChangeEvent<HTMLInputElement>) {
    const fileList = ev.target.files;
    if (!fileList || fileList.length === 0) {
      // The launch button was pressed but the picker came back empty —
      // either the user cancelled or the OS denied camera access. Surface
      // a hint pointing at browser settings; this is the only signal we
      // get from `<input capture>` (no Permissions API for it).
      if (launchedRef.current) setShowPermissionHint(true);
      launchedRef.current = false;
      return;
    }
    setShowPermissionHint(false);
    launchedRef.current = false;
    const incoming = Array.from(fileList);

    if (retakeIndexRef.current !== null && incoming[0]) {
      const idx = retakeIndexRef.current;
      retakeIndexRef.current = null;
      const file = incoming[0];
      setPages((prev) => {
        const next = [...prev];
        const old = next[idx];
        if (!old) return prev;
        URL.revokeObjectURL(old.previewUrl);
        const replaced: ScanPage = {
          id: old.id,
          file,
          previewUrl: blobToObjectUrl(file),
          ocrText: null,
          ocrError: null,
          ocrInFlight: true,
        };
        next[idx] = replaced;
        return next;
      });
      startOcrForPage(pages[idx]!.id, file);
    } else {
      const newPages: ScanPage[] = incoming.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: blobToObjectUrl(file),
        ocrText: null,
        ocrError: null,
        ocrInFlight: true,
      }));
      setPages((prev) => [...prev, ...newPages]);
      newPages.forEach((p) => startOcrForPage(p.id, p.file));
    }

    // Reset the input so re-selecting the same file fires onChange again.
    ev.target.value = "";
  }

  function openCapture() {
    retakeIndexRef.current = null;
    launchedRef.current = true;
    setShowPermissionHint(false);
    fileInputRef.current?.click();
  }

  function retakePage(idx: number) {
    retakeIndexRef.current = idx;
    launchedRef.current = true;
    setShowPermissionHint(false);
    fileInputRef.current?.click();
  }

  function deletePage(idx: number) {
    let removed: ScanPage | undefined;
    setPages((prev) => {
      const next = [...prev];
      [removed] = next.splice(idx, 1);
      return next;
    });
    if (!removed) return;
    const removedPage = removed;
    const restoreIndex = idx;
    // G19 / B10 — universal undo. We hold off on revoking the previewUrl
    // until either the toast commits (auto-close / dismiss) or the user
    // restores the page; restoring re-inserts it at the original slot.
    showUndoToast({
      label: `Deleted page ${restoreIndex + 1}`,
      onUndo: () => {
        setPages((prev) => {
          const next = [...prev];
          next.splice(restoreIndex, 0, removedPage);
          return next;
        });
      },
      onCommit: () => {
        URL.revokeObjectURL(removedPage.previewUrl);
      },
    });
  }

  const allOcrDone =
    pages.length > 0 &&
    pages.every((p) => !p.ocrInFlight && p.ocrText !== null);
  const hasErrors = pages.some((p) => p.ocrError !== null);

  async function combineToSingleBlob(): Promise<{
    blob: Blob;
    name: string;
    mime: string;
  }> {
    // Stitch every scanned page into a single multi-page PDF on the client
    // so the canonical bytes represent the *whole* scan. This both makes the
    // signed-URL preview show every page (not just page 1) and ensures the
    // SHA-256 changes when the user adds/removes pages — required for the
    // server's idempotent-ingest hash check to behave correctly.
    const blob = await stitchPagesToPdf(pages.map((p) => p.file));
    return {
      blob,
      name: `scan-${pages.length}-page${pages.length === 1 ? "" : "s"}.pdf`,
      mime: "application/pdf",
    };
  }

  async function handleConfirm() {
    if (pages.length === 0) return;
    if (!allOcrDone) {
      toast.error("OCR still running — give it a moment.");
      return;
    }

    setUploading(true);
    try {
      let targetCaseId = caseId;
      if (!targetCaseId) {
        const created = await createCase.mutateAsync({
          data: {
            title: `Scan ${new Date().toLocaleDateString()}`,
            rolePack: "defender",
          },
        });
        targetCaseId = created.id;
      }

      const { blob, name, mime } = await combineToSingleBlob();
      const ocrText = joinOcrPages(pages.map((p) => p.ocrText ?? ""));
      const file = new File([blob], name, { type: mime });

      await uploadCaseFile(
        targetCaseId,
        {
          file,
          sourceType: "scan",
          ocrText,
          pageCount: pages.length,
        },
        apiRequestOptions,
      );

      // G9 done-criteria: "on success, push the user into the Briefcase
      // view and trigger a run". We POST start-run with a fresh
      // idempotency key here; if the server already has an active run for
      // this case it returns 409 and we silently fall through (CaseDetail
      // will bind to the existing run on mount).
      try {
        await startCaseRun(
          targetCaseId,
          { idempotencyKey: crypto.randomUUID() },
          apiRequestOptions,
        );
      } catch (runErr) {
        // 409 = run already active; anything else is non-fatal here — the
        // user can press "Start run" from the case detail page.
        // eslint-disable-next-line no-console
        console.warn("Auto-start run after scan upload failed", runErr);
      }

      toast.success(
        `Scanned ${pages.length} page${pages.length === 1 ? "" : "s"} — starting analysis.`,
      );
      onOpenChange(false);
      setLocation(`/case/${targetCaseId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[88vh] overflow-y-auto"
        data-testid="scan-sheet"
      >
        <SheetHeader>
          <SheetTitle>Scan documents</SheetTitle>
          <SheetDescription>
            Use your camera (or pick images) to add paperwork. Text is read
            on-device; nothing leaves your machine until you tap Confirm.
          </SheetDescription>
        </SheetHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
          data-testid="scan-file-input"
        />

        <div className="mt-6 flex flex-col gap-4">
          {pages.length === 0 ? (
            <button
              type="button"
              onClick={openCapture}
              className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/40 bg-secondary/30 px-6 py-12 text-muted-foreground transition hover:bg-secondary/60"
              data-testid="scan-launch"
            >
              <Camera className="size-10" />
              <span className="text-sm font-medium">
                Tap to open the camera
              </span>
              <span className="text-xs">
                Multiple pages supported · review before upload
              </span>
            </button>
          ) : (
            <>
              <ul
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                data-testid="scan-pages-list"
              >
                {pages.map((page, idx) => (
                  <li
                    key={page.id}
                    className="overflow-hidden rounded-lg border bg-card shadow-sm"
                    data-testid={`scan-page-${idx}`}
                  >
                    <div className="relative aspect-[3/4] w-full bg-muted">
                      <img
                        src={page.previewUrl}
                        alt={`Page ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        Page {idx + 1}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        {page.ocrInFlight ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" />
                            Reading text…
                          </span>
                        ) : page.ocrError ? (
                          <span className="text-destructive">
                            OCR failed
                          </span>
                        ) : (
                          <span>
                            {(page.ocrText ?? "").trim().length} chars
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Retake page ${idx + 1}`}
                          onClick={() => retakePage(idx)}
                          data-testid={`scan-retake-${idx}`}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete page ${idx + 1}`}
                          onClick={() => deletePage(idx)}
                          data-testid={`scan-delete-${idx}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                variant="outline"
                onClick={openCapture}
                data-testid="scan-add-page"
              >
                <Plus className="size-4" />
                Add another page
              </Button>
            </>
          )}

          <CameraHelp visible={showPermissionHint} />

          {hasErrors && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              One or more pages couldn't be read. Retake or delete them before
              confirming.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-2 border-t bg-background pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
            data-testid="scan-cancel"
          >
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              pages.length === 0 || !allOcrDone || uploading || hasErrors
            }
            data-testid="scan-confirm"
          >
            {uploading ? <Spinner className="size-4" /> : null}
            {uploading
              ? "Uploading…"
              : caseId
                ? "Add to case"
                : "Create case"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
