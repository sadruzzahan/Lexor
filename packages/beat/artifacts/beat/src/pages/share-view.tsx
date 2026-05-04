import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { ShieldX, Clock, Tag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { parseCitationsInText } from "@/components/CitationChip";

interface SceneTag {
  tag: string;
  confidence?: number;
  location?: string;
}

interface ShareData {
  caseTitle: string;
  caseId: string;
  description: string | null;
  draft: {
    id: string;
    body: string;
    updatedAt: string;
  };
  sceneTags: { tags?: SceneTag[] } | SceneTag[] | null;
  expiresAt: string;
}

function normalizeSceneTags(raw: ShareData["sceneTags"]): SceneTag[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as SceneTag[];
  if (typeof raw === "object" && raw !== null && "tags" in raw && Array.isArray(raw.tags)) {
    return raw.tags as SceneTag[];
  }
  return [];
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ShareView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiBase}/api/v1/share/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to load");
        }
        return res.json() as Promise<ShareData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });
  }, [token, apiBase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-2xl space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldX className="h-12 w-12 text-muted-foreground/40" />
          <h1 className="text-xl font-bold font-mono tracking-tight text-foreground">
            Link Unavailable
          </h1>
          <p className="text-sm text-muted-foreground font-mono max-w-xs">
            {error ?? "This share link has expired or does not exist."}
          </p>
        </div>
      </div>
    );
  }

  const sceneTags = normalizeSceneTags(data.sceneTags);

  return (
    <div className="min-h-screen bg-background flex flex-col pb-12" data-testid="share-view-screen">
      <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between bg-background/90 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
          <span className="text-xs font-mono font-bold tracking-tight text-foreground uppercase truncate">
            Beat — Read-only Report
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="w-3 h-3" aria-hidden="true" />
          Expires {formatExpiry(data.expiresAt)}
        </div>
      </div>

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight text-foreground">
            {data.caseTitle}
          </h1>
          {data.description && (
            <p className="text-xs text-muted-foreground font-mono mt-1">{data.description}</p>
          )}
        </div>

        {sceneTags.length > 0 && (
          <div
            className="rounded-lg border border-border/40 bg-card overflow-hidden"
            data-testid="share-scene-tags-section"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50">
              <Tag className="w-3 h-3 text-primary" aria-hidden="true" />
              <span className="text-xs font-mono font-bold tracking-tight text-foreground uppercase">
                Scene Tags
              </span>
            </div>
            <div className="p-4 flex flex-wrap gap-2">
              {sceneTags.map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20"
                >
                  {t.tag}
                  {t.location && (
                    <span className="text-muted-foreground">· {t.location}</span>
                  )}
                  {typeof t.confidence === "number" && (
                    <span className="text-muted-foreground">
                      {Math.round(t.confidence * 100)}%
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div
          className="rounded-lg border border-primary/30 bg-card overflow-hidden"
          data-testid="share-draft-section"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50">
            <div className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
            <span className="text-xs font-mono font-bold tracking-tight text-foreground uppercase">
              Statement Draft
            </span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground">
              {new Date(data.draft.updatedAt).toLocaleString()}
            </span>
          </div>
          <div className="p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">
            {parseCitationsInText(data.draft.body, data.caseId)}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground font-mono text-center">
          NOT FOR EVIDENTIARY USE — Demo environment only. Read-only shared report.
        </p>
      </div>
    </div>
  );
}
