import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import {
  useCreateCourtroomSession,
  useEndCourtroomSession,
  getStreamCourtroomEventsUrl,
  getUploadCourtroomChunkUrl,
  getEndCourtroomSessionUrl,
  type CourtroomSession,
  type ObjectionEvent,
  type CreateCourtroomSessionRequestJurisdictionCountry,
} from "@workspace/api-client-react";
import { apiRequestOptions } from "@/lib/api";
import { selection, success, warning } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useHushModeStore } from "@/stores/hushModeStore";
import { JurisdictionBadge } from "@/components/signature/JurisdictionBadge";

type Phase = "consent" | "engaging" | "live" | "ended";

const SEVERITY_GLOW: Record<ObjectionEvent["severity"], string> = {
  info: "shadow-[0_0_24px_rgba(139,92,246,0.45)] ring-violet-400/40",
  warn: "shadow-[0_0_28px_rgba(244,180,84,0.55)] ring-amber-300/50",
  strong: "shadow-[0_0_36px_rgba(248,113,113,0.65)] ring-rose-400/60",
};

export default function Courtroom() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const caseId = params?.id ?? null;

  const [phase, setPhase] = useState<Phase>("consent");
  const [jurisdiction, setJurisdiction] =
    useState<CreateCourtroomSessionRequestJurisdictionCountry>("US");
  const [consentTranscript, setConsentTranscript] = useState(false);
  const [hush, setHush] = useState(true);
  const [session, setSession] = useState<CourtroomSession | null>(null);
  // Tracked client-side because CourtroomSession from R-30 doesn't
  // carry endedAt (it's set server-side by R-33). We flip this true
  // once finalizeSession() has resolved successfully so the UI can
  // gate Save/Discard, Done, Back, Start-another correctly.
  const [sessionEnded, setSessionEnded] = useState(false);
  const [events, setEvents] = useState<ObjectionEvent[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const finalizingRef = useRef<Promise<void> | null>(null);
  // Mirror of `session` for the unmount cleanup, which captures stale
  // closure values for state but always sees the current ref.
  const sessionRef = useRef<CourtroomSession | null>(null);
  const endedRef = useRef(false);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    endedRef.current = sessionEnded;
  }, [sessionEnded]);

  const createMut = useCreateCourtroomSession({
    request: apiRequestOptions,
  });
  const endMut = useEndCourtroomSession({
    request: apiRequestOptions,
  });

  const headers = useMemo(
    () => (apiRequestOptions.headers ?? {}) as Record<string, string>,
    [],
  );

  // ----- teardown helpers --------------------------------------------------
  function stopMedia() {
    try {
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    } catch {
      /* noop */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setMicActive(false);
    setMicLevel(0);
  }

  useEffect(() => {
    return () => {
      sseAbortRef.current?.abort();
      stopMedia();
      // Best-effort R-33 on unmount so a navigation-away never leaves
      // a live session dangling on the server.
      const s = sessionRef.current;
      if (s && !endedRef.current) {
        const url = getEndCourtroomSessionUrl(s.id);
        try {
          // keepalive lets the browser flush the request even as the
          // page tears down; sendBeacon would also work but doesn't
          // accept JSON content-type.
          fetch(url, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ saveTranscript: false }),
            keepalive: true,
          }).catch(() => undefined);
        } catch {
          /* swallow — TTL tombstone (10 min) is the backstop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- engage ------------------------------------------------------------
  async function engage() {
    setError(null);
    setPhase("engaging");
    selection();
    try {
      const created = await createMut.mutateAsync({
        data: {
          caseId,
          jurisdictionCountry: jurisdiction,
          consentTranscript,
        },
      });
      // Mirror to refs SYNCHRONOUSLY before any awaits so the
      // catch-block / unmount finalizer can always see this session
      // even if React hasn't flushed setState yet.
      sessionRef.current = created;
      endedRef.current = false;
      setSession(created);
      setSessionEnded(false);
      await startMicAndStream(created.id);
      setPhase("live");
      success();
    } catch (err) {
      console.error("[courtroom] engage failed", err);
      setError(err instanceof Error ? err.message : "Failed to start session");
      // If a session was already created server-side before the mic
      // step failed, finalize it so we don't leak an open session.
      // Pass sessionRef.current?.id explicitly: setSession() may not
      // have flushed yet, but the ref was set synchronously above.
      try {
        await finalizeSession(false, sessionRef.current?.id);
      } catch {
        /* toast already raised inside finalize */
      }
      sessionRef.current = null;
      setSession(null);
      setPhase("consent");
      warning();
    }
  }

  async function startMicAndStream(sessionId: string) {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;
    setMicActive(true);

    // VU meter — purely visual.
    try {
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]! - 128) / 128;
          if (v > peak) peak = v;
        }
        setMicLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* analyser is best-effort */
    }

    const mime = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined,
    );
    recorderRef.current = recorder;

    recorder.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      const fd = new FormData();
      fd.append(
        "audio",
        new File([ev.data], `chunk-${Date.now()}.webm`, {
          type: ev.data.type || mime || "audio/webm",
        }),
      );
      try {
        const res = await fetch(getUploadCourtroomChunkUrl(sessionId), {
          method: "POST",
          headers,
          body: fd,
        });
        if (!res.ok && res.status !== 202) {
          console.warn("[courtroom] chunk upload non-202", res.status);
        }
      } catch (err) {
        console.warn("[courtroom] chunk upload failed", err);
      }
    };

    // 1s timeslices per spec.
    recorder.start(1000);

    // Open SSE stream.
    sseAbortRef.current?.abort();
    const controller = new AbortController();
    sseAbortRef.current = controller;
    void streamObjectionEvents(sessionId, controller.signal, headers, (ev) => {
      setEvents((prev) =>
        prev.some((p) => p.idx === ev.idx) ? prev : [...prev, ev],
      );
      // Vibration cue per severity.
      if (ev.severity === "strong") warning();
      else if (ev.severity === "warn") warning();
      else selection();
    });
  }

  // Guarded finalizer — privacy contract: every exit path that has ever
  // created a server session MUST call R-33 so the in-memory bus is
  // dropped + tombstoned. Re-entrancy is prevented via finalizingRef so
  // accidental double-clicks don't double-fire (and aren't dropped on
  // the floor either — the second call awaits the first promise).
  async function finalizeSession(save: boolean, explicitSessionId?: string): Promise<void> {
    sseAbortRef.current?.abort();
    stopMedia();
    // Resolve session identity from refs (deterministic) rather than
    // React state, which is async/batched and races with engage().
    const sid = explicitSessionId ?? sessionRef.current?.id;
    if (!sid || endedRef.current) return;
    if (finalizingRef.current) {
      await finalizingRef.current;
      return;
    }
    const p = (async () => {
      try {
        await endMut.mutateAsync({
          sessionId: sid,
          data: { saveTranscript: save },
        });
        endedRef.current = true;
        setSessionEnded(true);
        toast.success(save ? "Session saved" : "Session ended");
      } catch (err) {
        console.error("[courtroom] end failed", err);
        toast.error("Could not end session cleanly — please try again");
        throw err;
      }
    })();
    finalizingRef.current = p;
    try {
      await p;
    } finally {
      finalizingRef.current = null;
    }
  }

  async function endSession(save: boolean) {
    selection();
    try {
      await finalizeSession(save);
    } catch {
      // toast already raised; stay on ended screen so user can retry.
    }
    setPhase("ended");
  }

  async function safeNavigateAway(to: string) {
    try {
      await finalizeSession(false);
    } catch {
      // Even if R-33 fails the server-side TTL tombstone (10 min) will
      // still drop the bus. We continue navigation to avoid trapping
      // the user.
    }
    setLocation(to);
  }

  // ----- render ------------------------------------------------------------
  const showHush = phase === "live" && hush;
  const latest = events[events.length - 1] ?? null;

  // G20 — broadcast hush state to AmbientReactor so the global aurora
  // freezes while Courtroom is in Hush mode. Always release on unmount.
  const setHushGlobal = useHushModeStore((s) => s.setHush);
  useEffect(() => {
    setHushGlobal(showHush);
    return () => setHushGlobal(false);
  }, [showHush, setHushGlobal]);

  return (
    <div
      data-testid="page-courtroom"
      className={[
        "min-h-screen w-full transition-colors duration-700",
        showHush
          ? "bg-[#0a0418] text-violet-50"
          : "bg-background text-foreground",
      ].join(" ")}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={endMut.isPending}
            onClick={() =>
              void safeNavigateAway(caseId ? `/case/${caseId}` : "/cases")
            }
            data-testid="button-courtroom-back"
          >
            ← Back
          </Button>
          <h1 className="text-lg font-semibold tracking-tight">Courtroom</h1>
        </div>
        {phase === "live" && (
          <div className="flex items-center gap-3 text-xs">
            <MicIndicator active={micActive} level={micLevel} />
            <JurisdictionBadge
              country={jurisdiction}
              anchorId={session?.id ?? "courtroom"}
            />
            <span className="text-muted-foreground">
              {consentTranscript ? "Transcript on" : "Snippets redacted"}
            </span>
            <Label className="flex items-center gap-2">
              <span>Hush</span>
              <Switch
                checked={hush}
                onCheckedChange={(v) => setHush(Boolean(v))}
                data-testid="switch-hush"
              />
            </Label>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                // Stop capture immediately so the mic LED goes dark,
                // and move to the end-screen where Save / Discard is
                // an EXPLICIT user action. The server session is still
                // alive at this point — finalize is called when the
                // user picks Save or Discard (or navigates away).
                sseAbortRef.current?.abort();
                stopMedia();
                setPhase("ended");
                selection();
              }}
              data-testid="button-courtroom-end"
            >
              End
            </Button>
          </div>
        )}
      </header>

      <Dialog open={phase === "consent"}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-courtroom-consent"
        >
          <DialogHeader>
            <DialogTitle>Engage Courtroom Mode</DialogTitle>
            <DialogDescription>
              Briefcase will listen through your device microphone and surface
              objection cues in real time. Audio is processed in chunks and
              never stored. Transcript snippets are kept only if you opt in
              below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Select
                value={jurisdiction}
                onValueChange={(v) =>
                  setJurisdiction(
                    v as CreateCourtroomSessionRequestJurisdictionCountry,
                  )
                }
              >
                <SelectTrigger id="jurisdiction" data-testid="select-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States — FRE</SelectItem>
                  <SelectItem value="UK">United Kingdom — Civil Evidence</SelectItem>
                  <SelectItem value="IN">India — Indian Evidence Act</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
              <Switch
                id="consent"
                checked={consentTranscript}
                onCheckedChange={(v) => setConsentTranscript(Boolean(v))}
                data-testid="switch-consent-transcript"
              />
              <div className="text-sm">
                <Label htmlFor="consent" className="font-medium">
                  Save transcript for review
                </Label>
                <p className="text-muted-foreground text-xs mt-1">
                  Off by default. When off, snippets are redacted on the wire
                  and nothing is written to disk.
                </p>
              </div>
            </div>

            {error && (
              <p
                className="text-sm text-destructive"
                data-testid="text-courtroom-error"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setLocation(caseId ? `/case/${caseId}` : "/cases")
              }
              data-testid="button-courtroom-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={engage}
              disabled={createMut.isPending || phase === "engaging"}
              data-testid="button-courtroom-engage"
            >
              {phase === "engaging" ? "Engaging…" : "Engage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {phase === "live" && session?.transport === "http_chunks" && (
        <div
          className="px-6 py-2 text-[11px] uppercase tracking-wider text-amber-300/80 bg-amber-950/30 border-b border-amber-300/10"
          data-testid="badge-transport-fallback"
        >
          Low-latency transport unavailable — using HTTP chunk fallback (1s segments)
        </div>
      )}

      {phase === "live" && (
        <main
          className={[
            "px-6 py-8 transition-opacity duration-700",
            showHush ? "opacity-90" : "",
          ].join(" ")}
        >
          {showHush ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
              {latest ? (
                <CueChip event={latest} hush />
              ) : (
                <p className="text-violet-300/70 text-sm">
                  Listening… cues appear here when one is detected.
                </p>
              )}
              <p className="text-violet-300/40 text-xs">
                Hush mode dims the screen. Toggle off to see history.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl mx-auto">
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
                Cues ({events.length})
              </h2>
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Listening… cues appear here when one is detected.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="list-objection-events">
                  {events
                    .slice()
                    .reverse()
                    .map((ev) => (
                      <li key={ev.idx}>
                        <CueChip event={ev} />
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </main>
      )}

      {phase === "ended" && (
        <main className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
          <h2 className="text-xl font-semibold">Session ended</h2>
          <p className="text-muted-foreground text-sm">
            {events.length} cue{events.length === 1 ? "" : "s"} fired.
          </p>
          {session && consentTranscript ? (
            <p className="text-xs text-muted-foreground max-w-sm">
              Transcript snippets are still in memory. Save them to this case
              for review, or discard them — nothing is written to disk
              unless you choose Save.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground max-w-sm">
              Transcript consent was off, so snippets were redacted on the
              wire and cannot be saved.
            </p>
          )}
          <div className="flex flex-wrap gap-2 justify-center">
            <Button
              variant="ghost"
              disabled={endMut.isPending || (!!session && !sessionEnded)}
              onClick={() =>
                void safeNavigateAway(caseId ? `/case/${caseId}` : "/cases")
              }
              data-testid="button-courtroom-done"
            >
              Done
            </Button>
            {session && !sessionEnded && (
              <>
                <Button
                  variant="outline"
                  disabled={endMut.isPending}
                  onClick={() => endSession(false)}
                  data-testid="button-courtroom-discard"
                >
                  Discard
                </Button>
                {consentTranscript && (
                  <Button
                    disabled={endMut.isPending || events.length === 0}
                    onClick={() => endSession(true)}
                    data-testid="button-courtroom-save"
                  >
                    Save transcript
                  </Button>
                )}
              </>
            )}
            <Button
              variant="secondary"
              disabled={endMut.isPending || (!!session && !sessionEnded)}
              onClick={async () => {
                // Finalize the current session before resetting so
                // "Start another" can never resurrect a live one.
                if (session && !sessionEnded) {
                  try {
                    await finalizeSession(false);
                  } catch {
                    return; // stay on ended screen for retry
                  }
                }
                setEvents([]);
                setSession(null);
                setSessionEnded(false);
                setPhase("consent");
              }}
              data-testid="button-courtroom-restart"
            >
              Start another
            </Button>
          </div>
        </main>
      )}
    </div>
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function MicIndicator({ active, level }: { active: boolean; level: number }) {
  const scale = 0.7 + Math.min(level, 1) * 0.6;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="indicator-mic"
    >
      <span
        className={[
          "inline-block w-2.5 h-2.5 rounded-full transition-transform duration-100",
          active ? "bg-rose-400 shadow-[0_0_10px_rgba(248,113,113,0.7)]" : "bg-muted",
        ].join(" ")}
        style={{ transform: `scale(${active ? scale : 1})` }}
      />
      <span className="text-muted-foreground">{active ? "LIVE" : "idle"}</span>
    </span>
  );
}

function CueChip({ event, hush = false }: { event: ObjectionEvent; hush?: boolean }) {
  const glow = SEVERITY_GLOW[event.severity];
  return (
    <div
      data-testid={`cue-${event.idx}`}
      className={[
        "rounded-2xl px-5 py-4 ring-1 backdrop-blur-sm transition-shadow",
        hush
          ? "bg-violet-950/70 max-w-md"
          : "bg-card/80 border border-border/60",
        glow,
      ].join(" ")}
    >
      <div
        className={[
          "text-base font-semibold leading-snug",
          hush ? "text-violet-50" : "",
        ].join(" ")}
      >
        {event.suggestion}
      </div>
      <div
        className={[
          "mt-1.5 text-xs flex items-center gap-2",
          hush ? "text-violet-200/70" : "text-muted-foreground",
        ].join(" ")}
      >
        <span className="font-mono">{event.citation}</span>
        <span>·</span>
        <span>{event.ruleLabel}</span>
        <span>·</span>
        <span className="uppercase tracking-wide">{event.severity}</span>
      </div>
      {event.transcriptSnippet && (
        <div
          className={[
            "mt-2 text-xs italic",
            hush ? "text-violet-200/50" : "text-muted-foreground/80",
          ].join(" ")}
        >
          “{event.transcriptSnippet}”
        </div>
      )}
    </div>
  );
}

/** Minimal SSE reader for ObjectionEvent frames (separate from streamSse,
 * which is typed against AgentEvent). */
async function streamObjectionEvents(
  sessionId: string,
  signal: AbortSignal,
  headers: Record<string, string>,
  onEvent: (ev: ObjectionEvent) => void,
): Promise<void> {
  let resumeIdx = -1;
  while (!signal.aborted) {
    const url = getStreamCourtroomEventsUrl(
      sessionId,
      resumeIdx >= 0 ? { since: resumeIdx } : undefined,
    );
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...headers },
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE failed: ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let dataLine = "";
          for (const raw of frame.split("\n")) {
            const line = raw.trimEnd();
            if (line.startsWith("data:")) dataLine += line.slice(5).trimStart();
          }
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine) as ObjectionEvent;
            if (typeof parsed?.idx === "number") resumeIdx = parsed.idx;
            onEvent(parsed);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
      if (signal.aborted) return;
    } catch (err) {
      if (signal.aborted) return;
      console.warn("[courtroom] sse error", err);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
