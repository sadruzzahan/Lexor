import { useRef, useEffect } from "react";
import { useGetCaseFile, getGetCaseFileQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Image, Mic, MapPin, Clock, Tag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface SourceViewerProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
  fileId: string;
  /** Optional text span to highlight inside the audio transcript. */
  highlightText?: string;
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground min-w-[80px]">{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}

/**
 * Split `text` around all occurrences of `highlight` (case-insensitive) and
 * return React nodes with the matching spans wrapped in <mark>.
 */
function HighlightedTranscript({
  text,
  highlight,
}: {
  text: string;
  highlight?: string;
}) {
  if (!highlight || highlight.length < 3) {
    return <>{text}</>;
  }

  const escaped = highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded-sm px-0.5"
            style={{ background: "rgba(0,255,136,0.25)", color: "inherit" }}
            data-testid="transcript-highlight"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SourceViewer({ open, onClose, caseId, fileId, highlightText }: SourceViewerProps) {
  const { data: file, isLoading } = useGetCaseFile(caseId, fileId, {
    query: {
      enabled: open && !!fileId,
      queryKey: getGetCaseFileQueryKey(caseId, fileId),
    },
  });

  const highlightRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [open, file?.transcript]);

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const contentUrl = `${apiBase}/api/v1/cases/${caseId}/files/${fileId}/content`;

  const isPhoto = file?.sourceType === "photo" || file?.mimeType?.startsWith("image/");
  const isAudio = file?.sourceType === "audio" || file?.mimeType?.startsWith("audio/");

  const autoTag = file?.autoTagJson as { caption?: string; tags?: string[] } | null | undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden"
        style={{ background: "#0D1410", border: "1px solid rgba(0,255,136,0.2)" }}
        data-testid="modal-source-viewer"
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
            {isPhoto ? (
              <Image className="w-4 h-4 text-primary" />
            ) : isAudio ? (
              <Mic className="w-4 h-4 text-primary" />
            ) : (
              <FileText className="w-4 h-4 text-primary" />
            )}
            {file?.originalName ?? file?.filename ?? "Source File"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-40 w-full rounded" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !file ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Source not found.</div>
        ) : (
          <div className="overflow-y-auto max-h-[70vh]">
            {/* Photo viewer */}
            {isPhoto && (
              <div className="relative bg-black">
                <img
                  src={contentUrl}
                  alt={file.originalName ?? file.filename}
                  className="w-full object-contain max-h-64"
                  data-testid="source-viewer-image"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {autoTag && (
                  <div
                    className="absolute bottom-0 left-0 right-0 px-3 py-2"
                    style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.8))" }}
                  >
                    {autoTag.tags && autoTag.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {autoTag.tags.map((tag: string) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 border-primary/40 text-primary bg-black/60"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Audio player */}
            {isAudio && (
              <div className="px-4 py-4 border-b border-border/40">
                <audio
                  controls
                  className="w-full h-10"
                  src={contentUrl}
                  data-testid="source-viewer-audio"
                />
              </div>
            )}

            {/* Metadata + transcript */}
            <div className="p-4 space-y-4">
              {/* AI Tag / Caption */}
              {autoTag?.caption && (
                <div
                  className="rounded-lg p-3 space-y-2"
                  style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)" }}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary uppercase tracking-wider">
                    <Tag className="w-3 h-3" />
                    AI Analysis
                  </div>
                  <p className="text-xs text-foreground">{autoTag.caption}</p>
                  {autoTag.tags && autoTag.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {autoTag.tags.map((tag: string) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 border-primary/40 text-primary/80"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Transcript with cited-span highlighting */}
              {file.transcript && (
                <div
                  className="rounded-lg p-3 space-y-2"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    <Mic className="w-3 h-3" />
                    Transcript
                    {highlightText && (
                      <span className="ml-auto text-[9px] text-primary/60 normal-case tracking-normal font-normal">
                        cited span highlighted
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs text-foreground leading-relaxed whitespace-pre-wrap"
                    data-testid="source-viewer-transcript"
                    ref={(el) => {
                      if (el && highlightText) {
                        const mark = el.querySelector<HTMLElement>("[data-testid='transcript-highlight']");
                        highlightRef.current = mark;
                      }
                    }}
                  >
                    <HighlightedTranscript text={file.transcript} highlight={highlightText} />
                  </p>
                </div>
              )}

              {/* Caption (non-AI) */}
              {file.caption && !autoTag?.caption && (
                <MetaRow label="Caption" value={file.caption} />
              )}

              {/* File metadata */}
              <div className="space-y-1.5 border-t border-border/40 pt-3">
                <MetaRow label="Type" value={file.mimeType} />
                <MetaRow label="Size" value={`${(file.sizeBytes / 1024).toFixed(1)} KB`} />
                <MetaRow label="Source" value={file.sourceType} />
                {file.capturedAt && (
                  <div className="flex gap-2 text-xs">
                    <Clock className="w-3 h-3 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground">
                      {new Date(file.capturedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {file.gps && typeof file.gps === "object" && (
                  <div className="flex gap-2 text-xs">
                    <MapPin className="w-3 h-3 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {JSON.stringify(file.gps)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
