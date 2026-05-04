import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Terminal,
  X,
  ChevronDown,
  RefreshCw,
  Camera,
  Mic,
  Download,
  Share2,
  Play,
  Square,
} from "lucide-react";
import {
  useGetCase,
  getGetCaseQueryKey,
  useStartRun,
  useDeleteRun,
  useGetDraft,
  getGetDraftQueryKey,
  getListCasesQueryKey,
  useListCaseFiles,
  getListCaseFilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAgentRun } from "@/hooks/useAgentRun";
import { useRunReplay } from "@/hooks/useRunReplay";
import { AgentPane } from "@/components/AgentPane";
import { parseCitationsInText } from "@/components/CitationChip";
import { PhotoGallery } from "@/components/PhotoGallery";
import { CameraCapture } from "@/components/CameraCapture";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { UploadedFile } from "@/hooks/useFileUpload";

const PANES = [
  { key: "SceneCaptureTagger", label: "Scene Tags" },
  { key: "WitnessMapper", label: "Witness Map" },
  { key: "SuspectBackground", label: "Suspect Background" },
  { key: "StatementDrafter", label: "Draft Incident Report" },
];

function storeActiveRunId(caseId: string, runId: string) {
  try { localStorage.setItem(`beat_run_${caseId}`, runId); } catch {}
}
function clearActiveRunId(caseId: string) {
  try { localStorage.removeItem(`beat_run_${caseId}`); } catch {}
}
function getActiveRunId(caseId: string): string | null {
  try { return localStorage.getItem(`beat_run_${caseId}`); } catch { return null; }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Extract [cite:xxx] markers from draft body */
function extractCitations(body: string): string[] {
  const matches = [...body.matchAll(/\[cite:([^\]]+)\]/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

async function exportDraft(
  caseId: string,
  runId: string | null,
  caseTitle: string,
  draftBody: string,
  apiBase: string,
) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = caseTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

  // Fetch artifact IDs from the completed run
  let artifacts: Array<{ id: string; kind: string; subagent: string }> = [];
  if (runId) {
    try {
      const resp = await fetch(`${apiBase}/api/v1/runs/${runId}/artifacts`);
      if (resp.ok) {
        const data = (await resp.json()) as { artifacts: typeof artifacts };
        artifacts = data.artifacts ?? [];
      }
    } catch {
      /* non-blocking */
    }
  }

  const citations = extractCitations(draftBody);
  const now = new Date().toISOString();

  // Markdown — NOT FOR EVIDENTIARY USE must be the very first line per free-tier spec
  const md = [
    `NOT FOR EVIDENTIARY USE — Demo environment only. Free tier.`,
    ``,
    `# ${caseTitle}`,
    ``,
    `Generated: ${now}`,
    `Case ID: ${caseId}`,
    runId ? `Run ID: ${runId}` : "",
    ``,
    draftBody,
  ]
    .filter((l) => l !== null)
    .join("\n");

  // JSON sidecar with full provenance metadata
  const sidecar = {
    evidentiary: false,
    tier: "free",
    disclaimer: "NOT FOR EVIDENTIARY USE — Demo environment only. Free tier.",
    exportedAt: now,
    caseId,
    caseTitle,
    runId: runId ?? null,
    artifactIds: artifacts.map((a) => a.id),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      kind: a.kind,
      subagent: a.subagent,
    })),
    citations,
    draft: draftBody,
  };

  downloadBlob(new Blob([md], { type: "text/markdown" }), `beat-draft-${slug}-${ts}.md`);
  setTimeout(() => {
    downloadBlob(
      new Blob([JSON.stringify(sidecar, null, 2)], { type: "application/json" }),
      `beat-draft-${slug}-${ts}.json`,
    );
  }, 300);
}

export default function BeatView() {
  const { id: caseId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [runId, setRunId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const startingRef = useRef(false);

  const [showCamera, setShowCamera] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [photoRefresh, setPhotoRefresh] = useState(0);
  const [isSharing, setIsSharing] = useState(false);

  const { data: caseData, isLoading: caseLoading } = useGetCase(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) },
  });

  const startRun = useStartRun();
  const deleteRun = useDeleteRun();
  const agentRun = useAgentRun(caseId, runId);
  const replay = useRunReplay(runId);

  const { data: draft, refetch: refetchDraft } = useGetDraft(caseId, {
    query: { enabled: !!caseId, queryKey: getGetDraftQueryKey(caseId) },
  });

  const { data: audioFiles, refetch: refetchAudio } = useListCaseFiles(
    caseId,
    { sourceType: "audio" },
    {
      query: {
        queryKey: getListCaseFilesQueryKey(caseId, { sourceType: "audio" }),
        refetchInterval: (query) => {
          const files = (query.state.data as { files: Array<{ transcript?: string | null }> } | undefined)?.files ?? [];
          return files.some((f) => !f.transcript) ? 3000 : false;
        },
      },
    },
  );

  useEffect(() => {
    if (!caseId || startingRef.current) return;

    // Restore a persisted run (e.g. navigating back to a completed investigation).
    // On retry runKey increments AND localStorage is cleared first, so this path
    // is skipped and a fresh run is started.
    const storedRunId = getActiveRunId(caseId);
    if (storedRunId) {
      setRunId(storedRunId);
      setIsStarting(false);
      return;
    }

    startingRef.current = true;
    setIsStarting(true);
    setRunId(null);

    startRun.mutate(
      { caseId, data: {} },
      {
        onSuccess: (res) => {
          startingRef.current = false;
          setRunId(res.runId);
          setIsStarting(false);
          storeActiveRunId(caseId, res.runId);
        },
        onError: () => {
          startingRef.current = false;
          setIsStarting(false);
        },
      },
    );
  }, [caseId, runKey]);

  useEffect(() => {
    if (agentRun.state === "done") {
      refetchDraft();
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
    }
  }, [agentRun.state]);

  function handleCancel() {
    if (!runId) return;
    deleteRun.mutate({ runId }, {
      onSuccess: () => {
        clearActiveRunId(caseId);
        setRunId(null);
      },
    });
  }

  function handleRetry() {
    if (runId) clearActiveRunId(caseId);
    startingRef.current = false;
    setRunId(null);
    setIsStarting(false);
    setRunKey((k) => k + 1);
  }

  async function handleShare() {
    if (!caseId || isSharing) return;
    setIsSharing(true);
    try {
      const resp = await fetch(`${apiBase}/api/v1/cases/${caseId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to create share link");
      }
      const { token } = (await resp.json()) as { token: string };
      const base = window.location.origin + (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      const shareUrl = `${base}/share/${token}`;
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied!", description: "Share link copied to clipboard. Valid for 7 days." });
    } catch (err) {
      toast({ title: "Share failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsSharing(false);
    }
  }

  const handlePhotoUploaded = useCallback((file: UploadedFile) => {
    setPhotoRefresh((n) => n + 1);
    queryClient.invalidateQueries({ queryKey: getListCaseFilesQueryKey(caseId, { sourceType: "photo" }) });
  }, [caseId, queryClient]);

  const handleAudioUploaded = useCallback((file: UploadedFile) => {
    queryClient.invalidateQueries({ queryKey: getListCaseFilesQueryKey(caseId, { sourceType: "audio" }) });
    refetchAudio();
  }, [caseId, queryClient, refetchAudio]);

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  const isRunning = agentRun.state === "running" || isStarting;
  const isDone = agentRun.state === "done";
  const isReplayMode = replay.isReplaying;

  const activeSubagents = isReplayMode ? replay.subagents : agentRun.subagents;

  const audioWithTranscripts = (audioFiles?.files ?? []).filter((f) => f.transcript);
  const audioTranscribing = (audioFiles?.files ?? []).filter((f) => !f.transcript);

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20" data-testid="beat-view-screen">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/investigations")}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Back to investigations"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            {caseLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <h1 className="text-sm font-bold tracking-tight text-foreground truncate">
                {caseData?.title ?? "Investigation"}
              </h1>
            )}
            <p className="text-[11px] text-muted-foreground font-mono" role="status" aria-live="polite">
              {isReplayMode
                ? `Replay ${replay.progress}%`
                : isStarting
                ? "Initializing..."
                : isRunning
                ? "Agents running..."
                : isDone
                ? "Analysis complete"
                : agentRun.state === "error"
                ? "Error — tap retry"
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(`/investigations/${caseId}/agent`)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label="Open agent inspector"
            data-testid="button-agent-inspector"
          >
            <Terminal className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Replay control */}
          {isDone && runId && !isRunning && (
            isReplayMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={replay.stopReplay}
                className="h-7 text-xs gap-1"
                aria-label="Stop replay"
                data-testid="button-stop-replay"
              >
                <Square className="w-3 h-3" aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={replay.startReplay}
                className="h-7 text-xs gap-1"
                aria-label="Replay run at 4× speed"
                data-testid="button-replay-run"
              >
                <Play className="w-3 h-3" aria-hidden="true" />
                Replay
              </Button>
            )
          )}

          {isRunning && runId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
              aria-label="Cancel current run"
              data-testid="button-cancel-run"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              Cancel
            </Button>
          )}
          {(agentRun.state === "error" || (!isRunning && !isDone && !isStarting && runId === null && runKey > 0)) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="h-7 text-xs gap-1"
              aria-label="Retry run"
              data-testid="button-retry-run"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* 4-pane grid */}
      <div className="flex-1 px-4 py-4 max-w-4xl mx-auto w-full space-y-4">
        {isStarting ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Loading agents" role="status">
            {PANES.map((p) => (
              <Skeleton key={p.key} className="h-[280px] rounded-lg" />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {PANES.map((p, i) => {
              const paneData = activeSubagents[p.key];
              const isDraftPane = p.key === "StatementDrafter";
              const isScenePane = p.key === "SceneCaptureTagger";
              const isWitnessPane = p.key === "WitnessMapper";

              return (
                <motion.div
                  key={p.key}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="flex flex-col gap-0"
                >
                  <AgentPane
                    name={p.label}
                    subagentKey={p.key}
                    state={paneData?.state ?? "idle"}
                    text={paneData?.text ?? ""}
                    toolCalls={paneData?.toolCalls ?? []}
                    onRetry={paneData?.state === "error" ? handleRetry : undefined}
                    renderContent={
                      isDraftPane
                        ? (text) => parseCitationsInText(text, caseId)
                        : undefined
                    }
                  />

                  {/* Photo gallery below SceneCaptureTagger */}
                  {isScenePane && (
                    <div
                      className="rounded-b-lg border-x border-b border-border/40 bg-card px-2"
                      style={{ background: "rgba(18,24,20,0.8)" }}
                      data-testid="scene-tags-gallery"
                    >
                      <PhotoGallery caseId={caseId} refreshTrigger={photoRefresh} />
                    </div>
                  )}

                  {/* Transcript snippets below WitnessMapper */}
                  {isWitnessPane && (audioWithTranscripts.length > 0 || audioTranscribing.length > 0) && (
                    <div
                      className="rounded-b-lg border-x border-b border-border/40 px-3 py-2 space-y-2"
                      style={{ background: "rgba(18,24,20,0.8)" }}
                      data-testid="audio-transcript-panel"
                    >
                      {audioTranscribing.length > 0 && (
                        <div
                          className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono py-1"
                          role="status"
                          aria-live="polite"
                          data-testid="audio-transcribing-indicator"
                        >
                          <span className="h-2.5 w-2.5 rounded-full border border-primary border-t-transparent animate-spin" aria-hidden="true" />
                          Transcribing {audioTranscribing.length} statement{audioTranscribing.length > 1 ? "s" : ""}…
                        </div>
                      )}
                      {audioWithTranscripts.map((af) => (
                        <div
                          key={af.id}
                          className="text-[10px] font-mono text-foreground/80 leading-relaxed border-l-2 border-primary/40 pl-2"
                          data-testid={`audio-entry-${af.id}`}
                        >
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                            {af.originalName ?? af.filename}
                          </div>
                          {af.transcript}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Full draft below grid after completion */}
        {isDone && draft && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-lg border border-primary/30 bg-card overflow-hidden"
            data-testid="draft-section"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
                <span className="text-xs font-mono font-bold tracking-tight text-foreground uppercase">
                  Statement Draft
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleShare}
                  disabled={isSharing}
                  className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                  aria-label="Share draft as a read-only link"
                  data-testid="button-share-draft"
                >
                  <Share2 className="w-3 h-3" aria-hidden="true" />
                  {isSharing ? "Sharing…" : "Share"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportDraft(caseId, runId, caseData?.title ?? "investigation", draft.body, apiBase)}
                  className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                  aria-label="Export draft as Markdown and JSON"
                  data-testid="button-export-draft"
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  Export
                </Button>
                <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
            <div className="p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">
              {parseCitationsInText(draft.body, caseId)}
            </div>
          </motion.div>
        )}
      </div>

      {/* Camera + Record FABs */}
      <div
        className="fixed flex flex-col gap-2"
        style={{ bottom: "4.5rem", right: "1rem" }}
      >
        <Button
          onClick={() => setShowCamera(true)}
          size="icon"
          className="w-11 h-11 rounded-full shadow-lg"
          style={{ background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.4)", color: "#00FF88" }}
          aria-label="Capture scene photo"
          data-testid="button-open-camera"
        >
          <Camera className="w-5 h-5" aria-hidden="true" />
        </Button>
        <Button
          onClick={() => setShowAudio(true)}
          size="icon"
          className="w-11 h-11 rounded-full shadow-lg"
          style={{ background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.4)", color: "#00FF88" }}
          aria-label="Record witness statement"
          data-testid="button-open-audio"
        >
          <Mic className="w-5 h-5" aria-hidden="true" />
        </Button>
      </div>

      {/* Capture modals */}
      <CameraCapture
        caseId={caseId}
        open={showCamera}
        onClose={() => setShowCamera(false)}
        onUploaded={handlePhotoUploaded}
      />
      <AudioRecorder
        caseId={caseId}
        open={showAudio}
        onClose={() => setShowAudio(false)}
        onUploaded={handleAudioUploaded}
        jurisdictionSig={(() => {
          const jc = caseData?.jurisdictionContext as Record<string, unknown> | null | undefined;
          if (!jc) return undefined;
          const c = String(jc.country ?? "");
          const r = String(jc.region ?? "");
          return c ? (r ? `${c}-${r}` : c) : undefined;
        })()}
      />
    </div>
  );
}
