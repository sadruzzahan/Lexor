import { useState, useEffect, useCallback } from "react";
import { useListCaseFiles, getListCaseFilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { SourceViewer } from "@/components/SourceViewer";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ImagePlus } from "lucide-react";

interface PhotoGalleryProps {
  caseId: string;
  refreshTrigger?: number;
}

export function PhotoGallery({ caseId, refreshTrigger = 0 }: PhotoGalleryProps) {
  const queryClient = useQueryClient();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  const { data, isLoading, refetch } = useListCaseFiles(
    caseId,
    { sourceType: "photo" },
    {
      query: {
        queryKey: getListCaseFilesQueryKey(caseId, { sourceType: "photo" }),
        refetchInterval: (query) => {
          // Keep polling while any photo lacks a caption/tag (auto-tag in progress)
          const files = (query.state.data as { files: Array<{ caption?: string | null }> } | undefined)?.files ?? [];
          const hasPending = files.some((f) => !f.caption);
          return hasPending ? 3000 : false;
        },
      },
    },
  );

  // Refetch when a new file is uploaded
  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  const photos = data?.files ?? [];

  if (isLoading && photos.length === 0) {
    return (
      <div className="flex gap-2 overflow-x-auto py-2 px-1">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="w-20 h-20 rounded shrink-0" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) return null;

  const autoTag = (photo: typeof photos[number]) => {
    const t = photo.autoTagJson as { caption?: string; tags?: string[] } | null | undefined;
    return t;
  };

  return (
    <>
      <div
        className="flex gap-2 overflow-x-auto py-2 px-1 scrollbar-thin"
        data-testid="photo-gallery"
        style={{ scrollbarColor: "rgba(0,255,136,0.2) transparent" }}
      >
        {photos.map((photo) => {
          const tag = autoTag(photo);
          const hasPendingTag = !tag && !photo.caption;
          const contentUrl = `${apiBase}/api/v1/cases/${caseId}/files/${photo.id}/content`;

          return (
            <button
              key={photo.id}
              onClick={() => setSelectedFileId(photo.id)}
              className="flex-none w-20 flex flex-col items-center gap-1 group"
              data-testid={`photo-thumb-${photo.id}`}
            >
              <div className="w-20 h-20 rounded overflow-hidden border border-border/40 group-hover:border-primary/40 transition-colors relative">
                <img
                  src={contentUrl}
                  alt={photo.originalName ?? photo.filename}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = "none";
                    el.parentElement!.style.background = "rgba(255,255,255,0.05)";
                  }}
                />
                {hasPendingTag && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="w-3 h-3 rounded-full border border-primary border-t-transparent animate-spin" />
                  </div>
                )}
              </div>
              <div className="w-full text-center">
                {tag?.tags && tag.tags.length > 0 ? (
                  <span className="text-[9px] font-mono text-primary/80 truncate block leading-tight">
                    {tag.tags[0]}
                  </span>
                ) : photo.caption ? (
                  <span className="text-[9px] font-mono text-muted-foreground truncate block leading-tight">
                    {photo.caption.slice(0, 20)}
                  </span>
                ) : (
                  <span className="text-[9px] font-mono text-muted-foreground/40 block leading-tight">
                    analyzing…
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedFileId && (
        <SourceViewer
          open={!!selectedFileId}
          onClose={() => setSelectedFileId(null)}
          caseId={caseId}
          fileId={selectedFileId}
        />
      )}
    </>
  );
}
