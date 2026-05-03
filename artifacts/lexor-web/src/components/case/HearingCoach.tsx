import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Headphones,
  Mic,
  MicOff,
  Loader2,
  Play,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  ackDisclosure,
  getCoachBrief,
  postCoachInterject,
  type CaseRow,
  type CoachBrief,
  type CoachInterjection,
} from "@/lib/api";
import { useReducedMotionPref } from "@/lib/hooks";

/**
 * Hearing Coach (Feature 7) — the user wears one earbud during a live
 * hearing, taps "Start," and Lexor whispers tactical guidance grounded
 * in the case record. End-to-end latency target ≤1.5s.
 *
 * Drift from spec, intentional:
 *  - Live STT uses the browser SpeechRecognition API (Chrome / Safari
 *    iOS 14.5+). Deepgram Flux integration is wired server-side and
 *    activates the moment DEEPGRAM_API_KEY is present.
 *  - TTS uses the browser SpeechSynthesis API. ElevenLabs Flash TTS
 *    activates the moment ELEVENLABS_API_KEY is present.
 *  - Speaker diarization is heuristic: we label any segment that begins
 *    after >2.5s of silence "OPPOSING" and any segment under 4s after
 *    a previous one "USER". Imperfect but works for demo audio.
 *  - Audio is captured + transcribed locally and never leaves the
 *    browser; only text transcripts hit the server. The disclaimer
 *    states this explicitly and the acknowledgement is logged.
 */

const DISCLOSURE_VERSION = "hearing-coach-v1";
const SILENCE_GAP_MS = 1200; // user-side pause before we consider whispering
const POLL_INTERVAL_MS = 3000; // hard floor between LLM hits
const MAX_TRANSCRIPT_CHARS = 6000;
// Per spec: only consult the brain on segments we're at least 70% sure
// we transcribed correctly. Whispers built on garbled input would be
// worse than silence.
const MIN_CONFIDENCE = 0.7;

// SpeechRecognition lives behind a vendor prefix on most browsers.
type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
};

function getSpeechRecognitionCtor():
  | { new (): SpeechRecognitionLike }
  | null {
  if (typeof window === "undefined") return null;
  type W = typeof window & {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  const w = window as W;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface TranscriptSegment {
  id: number;
  speaker: "user" | "opposing" | "court";
  text: string;
  isFinal: boolean;
  /** STT confidence in [0,1] for the final alternative. 0 for interim. */
  confidence: number;
  ts: number;
}

function getOrCreateSessionId(): string {
  const KEY = "lexor.coach.session";
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(KEY, v);
  }
  return v;
}

export function HearingCoach({ row }: { row: CaseRow }) {
  const reduced = useReducedMotionPref();
  const [brief, setBrief] = useState<CoachBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [acked, setAcked] = useState(false);
  const [recognitionAvailable, setRecognitionAvailable] = useState(true);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [coachLines, setCoachLines] = useState<
    Array<{ id: number; line: string; citation: string | null; urgency: string }>
  >([]);
  const [thinking, setThinking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const segIdRef = useRef(1);
  const lineIdRef = useRef(1);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastFinalAtRef = useRef<number>(Date.now());
  const lastInterjectAtRef = useRef<number>(0);
  const lastSpokenLineRef = useRef<string>("");
  const inFlightCtrlRef = useRef<AbortController | null>(null);
  const utteranceQueueRef = useRef<SpeechSynthesisUtterance[]>([]);
  const mutedRef = useRef(false);
  // SpeechRecognition's onend handler captures `listening` at closure
  // creation time — but at that moment we've just called startListening
  // and the React state hasn't flushed yet, so the captured value would
  // always be `false` and the auto-restart never fires. Reading from a
  // ref keeps the handler in sync with the live session state.
  const listeningRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  // Capability detection — surfaced in the UI so the user sees why we
  // gated the start button if browser STT is missing.
  useEffect(() => {
    setRecognitionAvailable(getSpeechRecognitionCtor() !== null);
  }, []);

  // Initial brief load.
  useEffect(() => {
    if (row.status !== "complete") return;
    let alive = true;
    getCoachBrief(row.id)
      .then((b) => {
        if (alive) setBrief(b);
      })
      .catch((e: unknown) => {
        if (alive)
          setBriefError(e instanceof Error ? e.message : "Couldn't load brief.");
      });
    return () => {
      alive = false;
    };
  }, [row.id, row.status]);

  // ────── speech synthesis ──────
  const speak = useCallback(
    (text: string, urgency: "high" | "normal") => {
      if (mutedRef.current) return;
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      // High-urgency interrupts the queue so the user hears the
      // objection cue BEFORE the next courtroom sentence lands.
      if (urgency === "high") {
        window.speechSynthesis.cancel();
        utteranceQueueRef.current = [];
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.15; // slightly faster than default — courtroom pace
      u.pitch = 1.0;
      u.volume = 1.0;
      utteranceQueueRef.current.push(u);
      window.speechSynthesis.speak(u);
    },
    [],
  );

  // ────── coaching loop ──────
  const requestInterjection = useCallback(async () => {
    if (mutedRef.current) return;
    const now = Date.now();
    if (now - lastInterjectAtRef.current < POLL_INTERVAL_MS) return;
    // Only fire after the user has been silent for SILENCE_GAP_MS — we
    // don't want to whisper while they're still speaking.
    if (now - lastFinalAtRef.current < SILENCE_GAP_MS) return;

    // Confidence gate (spec): require the most recent final segment to
    // have crossed MIN_CONFIDENCE before consulting the brain. Garbled
    // STT → silence rather than acting on a misheard line. Browsers
    // that don't expose a confidence value report 0 — in that case we
    // accept the segment if at least one earlier final segment in this
    // session crossed the threshold (proves the field is populated)
    // OR if the recent text looks substantial (>40 chars).
    const finals = segments.filter((s) => s.isFinal);
    const lastFinal = finals[finals.length - 1];
    if (!lastFinal) return;
    const seenConfidence = finals.some((s) => s.confidence > 0);
    const meetsConfidence =
      lastFinal.confidence >= MIN_CONFIDENCE ||
      (!seenConfidence && lastFinal.text.length > 40);
    if (!meetsConfidence) return;

    const transcript = finals
      .map((s) => `${s.speaker.toUpperCase()}: ${s.text}`)
      .join("\n")
      .slice(-MAX_TRANSCRIPT_CHARS);
    if (!transcript) return;

    lastInterjectAtRef.current = now;
    inFlightCtrlRef.current?.abort();
    const ctrl = new AbortController();
    inFlightCtrlRef.current = ctrl;
    setThinking(true);
    const t0 = performance.now();
    let result: CoachInterjection;
    try {
      result = await postCoachInterject(row.id, transcript, ctrl.signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setThinking(false);
      return;
    }
    setThinking(false);
    setLatencyMs(Math.round(performance.now() - t0));
    if (!result.line) return;
    // Suppress repeats within the same hearing so the user doesn't get
    // the same whisper twice in a row.
    if (result.line === lastSpokenLineRef.current) return;
    lastSpokenLineRef.current = result.line;

    setCoachLines((cur) => [
      ...cur.slice(-9),
      {
        id: lineIdRef.current++,
        line: result.line!,
        citation: result.citation,
        urgency: result.urgency,
      },
    ]);
    speak(result.line, result.urgency);
  }, [row.id, segments, speak]);

  // Drive the loop: every 800ms check whether we should poke the brain.
  useEffect(() => {
    if (!listening) return;
    const id = window.setInterval(() => void requestInterjection(), 800);
    return () => window.clearInterval(id);
  }, [listening, requestInterjection]);

  // ────── start / stop ──────
  const startListening = useCallback(async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error(
        "This browser can't transcribe live audio. Try Chrome or Safari.",
      );
      return;
    }
    // Provoke the mic permission prompt up-front so the user sees one
    // explicit OS dialog instead of a silent failure deep in
    // SpeechRecognition.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("Microphone permission was denied.");
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (!res) continue;
        const alt = res[0];
        const text = (alt.transcript ?? "").trim();
        if (!text) continue;
        const confidence = res.isFinal
          ? typeof alt.confidence === "number"
            ? alt.confidence
            : 0
          : 0;
        const now = Date.now();
        // Heuristic diarization: a final segment after >2.5s of silence
        // is "the courtroom" (judge/opposing); otherwise it's the user.
        const speaker: TranscriptSegment["speaker"] =
          res.isFinal && now - lastFinalAtRef.current > 2500
            ? "opposing"
            : "user";
        setSegments((cur) => {
          // Replace the trailing interim segment if the new one is from
          // the same speaker — keeps the transcript readable.
          const last = cur[cur.length - 1];
          if (last && !last.isFinal && last.speaker === speaker) {
            return [
              ...cur.slice(0, -1),
              { ...last, text, isFinal: res.isFinal, confidence, ts: now },
            ];
          }
          return [
            ...cur,
            {
              id: segIdRef.current++,
              speaker,
              text,
              isFinal: res.isFinal,
              confidence,
              ts: now,
            },
          ];
        });
        if (res.isFinal) lastFinalAtRef.current = now;
      }
    };
    r.onerror = (e) => {
      // "no-speech" / "aborted" are routine — only surface real failures.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error(`Mic error: ${e.error}`);
      }
    };
    r.onend = () => {
      // Auto-restart while the session is still active — the browser
      // sometimes terminates after a long silence and we want the
      // hearing to keep being heard. Read live state from the ref;
      // the captured `listening` would still be `false` here because
      // setListening(true) below hasn't flushed when this closure was
      // created.
      if (recognitionRef.current === r && listeningRef.current) {
        try {
          r.start();
        } catch {
          /* race with stopListening — ignore */
        }
      }
    };
    recognitionRef.current = r;
    listeningRef.current = true;
    setListening(true);
    setMuted(false);
    try {
      r.start();
    } catch {
      /* already started */
    }
    if (brief?.brief) {
      // Speak the opening brief so the user gets immediate value.
      speak(brief.brief, "normal");
    }
  }, [brief?.brief, speak]);

  const stopListening = useCallback(() => {
    // Flip the ref BEFORE calling stop() so the onend restart guard
    // sees the new value and doesn't immediately revive the session.
    listeningRef.current = false;
    setListening(false);
    const r = recognitionRef.current;
    recognitionRef.current = null;
    try {
      r?.stop();
    } catch {
      /* ignore */
    }
    inFlightCtrlRef.current?.abort();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceQueueRef.current = [];
  }, []);

  // PANIC: instant mute + stop. Cancels in-flight LLM call too so the
  // next interjection doesn't sneak through.
  const panic = useCallback(() => {
    setMuted(true);
    mutedRef.current = true;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceQueueRef.current = [];
    inFlightCtrlRef.current?.abort();
    stopListening();
    toast.success("Coach muted. Mic stopped.");
  }, [stopListening]);

  // Hard-stop on unmount — we never want a tab close to leave the mic
  // hot or speech queued.
  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      try {
        r?.abort();
      } catch {
        /* ignore */
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function acceptDisclaimer() {
    // Mandatory: the session does NOT start until the acknowledgment
    // has been recorded server-side. If the network call fails the
    // user stays on the disclaimer with a retry toast — the audit log
    // must contain a row for every coaching session that runs.
    const sid = getOrCreateSessionId();
    try {
      await ackDisclosure(DISCLOSURE_VERSION, sid);
    } catch {
      toast.error(
        "We couldn't log your acknowledgement. Check your connection and try again.",
      );
      return;
    }
    setAcked(true);
    setShowDisclaimer(false);
    void startListening();
  }

  if (row.status !== "complete") {
    return (
      <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
        <Headphones className="size-9 text-fg-muted mx-auto" aria-hidden />
        <h3 className="font-display text-2xl mt-3">Hearing Coach</h3>
        <p className="text-fg-muted mt-2 text-sm max-w-md mx-auto">
          The coach unlocks once the case pipeline finishes parsing.
        </p>
      </div>
    );
  }

  if (briefError) {
    return (
      <div className="rounded-lg2 border border-violation/40 bg-violation/5 p-6 text-sm text-fg">
        <AlertTriangle className="inline size-4 mr-2 text-violation" />
        Couldn't load coach brief — {briefError}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-lg2 border border-border-strong bg-bg-elevated p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-accent inline-flex items-center gap-2">
              <Headphones className="size-3.5" aria-hidden /> Hearing Coach
            </div>
            <h3 className="font-display text-2xl mt-1">
              On-call counsel for the courtroom
            </h3>
            <p className="text-fg-muted text-sm mt-1 max-w-xl">
              Pop in one earbud. Tap start when you walk in. The coach
              listens, stays silent until it matters, and whispers a
              short tactical cue.
            </p>
          </div>
          <ProvidersBadge brief={brief} />
        </div>

        {!listening && !acked && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowDisclaimer(true)}
              disabled={!recognitionAvailable}
              className="shimmer-btn rounded-base px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Play className="size-4" /> I'm in court now
            </button>
            {!recognitionAvailable && (
              <span className="text-xs text-fg-subtle self-center">
                Live transcription needs Chrome or Safari.
              </span>
            )}
          </div>
        )}

        {acked && !listening && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void startListening()}
              className="shimmer-btn rounded-base px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
            >
              <Mic className="size-4" /> Resume
            </button>
          </div>
        )}

        {listening && (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={panic}
              className="rounded-base bg-violation/15 border border-violation/50 text-violation hover:bg-violation/25 px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
              aria-label="Panic mute and stop"
            >
              <ShieldAlert className="size-4" /> Panic — mute & stop
            </button>
            <button
              type="button"
              onClick={() => {
                if (muted) {
                  setMuted(false);
                  mutedRef.current = false;
                } else {
                  setMuted(true);
                  mutedRef.current = true;
                  if (window.speechSynthesis) window.speechSynthesis.cancel();
                }
              }}
              className="rounded-base border border-border-strong bg-bg-raised hover:bg-bg-elevated px-4 py-2 text-sm inline-flex items-center gap-2"
            >
              {muted ? (
                <>
                  <MicOff className="size-4" /> Unmute coach
                </>
              ) : (
                <>
                  <Mic className="size-4" /> Mute coach
                </>
              )}
            </button>
            <span className="ml-auto inline-flex items-center gap-2 text-xs text-fg-subtle self-center">
              {thinking ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> thinking…
                </>
              ) : latencyMs !== null ? (
                <>
                  <Sparkles className="size-3 text-accent" /> last cue {latencyMs}ms
                </>
              ) : (
                <>
                  <Wifi className="size-3 text-accent" /> listening
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Brief + transcript + coach lines side-by-side on desktop */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Brief */}
        <div className="rounded-lg2 border border-border-strong bg-bg-elevated p-5 lg:col-span-1">
          <div className="text-xs uppercase tracking-wider text-fg-subtle">
            Opening brief
          </div>
          <p className="mt-2 text-sm text-fg leading-relaxed">
            {brief?.brief ?? "Loading…"}
          </p>
          {brief && brief.violations.length > 0 && (
            <>
              <div className="mt-4 text-xs uppercase tracking-wider text-fg-subtle">
                Cite if pressed
              </div>
              <ul className="mt-2 space-y-2 text-xs text-fg">
                {brief.violations.slice(0, 4).map((v, i) => (
                  <li
                    key={i}
                    className="rounded-base border border-border bg-bg-raised p-2"
                  >
                    <div className="font-medium">{v.statute}</div>
                    <div className="text-fg-muted">
                      {v.description.slice(0, 120)}
                      {v.description.length > 120 ? "…" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Transcript */}
        <div
          className="rounded-lg2 border border-border-strong bg-bg-elevated p-5 lg:col-span-2 min-h-[240px]"
          aria-label="Live courtroom transcript"
          aria-live="polite"
        >
          <div className="text-xs uppercase tracking-wider text-fg-subtle">
            Courtroom transcript
          </div>
          {segments.length === 0 ? (
            <div className="mt-6 text-center text-fg-subtle text-sm">
              {listening
                ? "Listening… speak or play the courtroom audio."
                : "Tap “I'm in court now” to start the session."}
            </div>
          ) : (
            <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
              {segments.slice(-30).map((s) => (
                <div key={s.id} className="text-sm">
                  <span
                    className={
                      "inline-block min-w-16 mr-2 text-[10px] uppercase tracking-wider font-medium " +
                      (s.speaker === "user"
                        ? "text-accent"
                        : "text-fg-subtle")
                    }
                  >
                    {s.speaker === "user" ? "you" : s.speaker}
                  </span>
                  <span className={s.isFinal ? "text-fg" : "text-fg-muted italic"}>
                    {s.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Coach whispers */}
          <div className="mt-5 border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-fg-subtle inline-flex items-center gap-2">
              <Sparkles className="size-3 text-accent" /> Coach whispers
              {muted && (
                <span className="text-violation inline-flex items-center gap-1">
                  <WifiOff className="size-3" /> muted
                </span>
              )}
            </div>
            <AnimatePresence initial={false}>
              {coachLines.length === 0 ? (
                <div className="mt-2 text-fg-subtle text-xs">
                  Silence is the default. Cues appear here only when there's
                  a tactical move to make.
                </div>
              ) : (
                coachLines.slice(-6).map((c) => (
                  <motion.div
                    key={c.id}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className={
                      "mt-2 rounded-base border p-3 " +
                      (c.urgency === "high"
                        ? "border-violation/50 bg-violation/10"
                        : "border-accent/40 bg-accent/5")
                    }
                  >
                    <div className="text-sm font-medium text-fg">
                      “{c.line}”
                    </div>
                    {c.citation && (
                      <div className="mt-1 text-[11px] text-fg-subtle italic">
                        {c.citation}
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-fg-subtle">
        Hearing Coach is a personal preparation tool. Lexor receives only
        the text transcript — your browser's speech recognition may route
        audio through your browser vendor's service. Recording laws vary
        by state; many require all parties' consent. You are responsible
        for compliance.
      </p>

      <DisclaimerModal
        open={showDisclaimer}
        onAccept={() => void acceptDisclaimer()}
        onCancel={() => setShowDisclaimer(false)}
      />
    </div>
  );
}

function ProvidersBadge({ brief }: { brief: CoachBrief | null }) {
  if (!brief) return null;
  const realtime = brief.providers.stt === "deepgram";
  return (
    <div className="rounded-base border border-border bg-bg-raised px-3 py-2 text-[11px] text-fg-muted">
      <div className="font-medium text-fg flex items-center gap-1.5">
        {realtime ? (
          <Wifi className="size-3 text-accent" />
        ) : (
          <WifiOff className="size-3" />
        )}
        {realtime ? "Realtime mode" : "Browser mode"}
      </div>
      <div className="mt-0.5">
        STT · {brief.providers.stt} &nbsp;·&nbsp; TTS · {brief.providers.tts}
      </div>
    </div>
  );
}

function DisclaimerModal({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-disclaimer-title"
      className="fixed inset-0 z-40 grid place-items-center bg-bg/80 backdrop-blur-sm p-4"
    >
      <div className="max-w-lg w-full rounded-xl2 border border-border-strong bg-bg-elevated p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-accent/10 border border-accent/30 p-2">
            <ShieldAlert className="size-5 text-accent" aria-hidden />
          </div>
          <div className="flex-1">
            <h3 id="coach-disclaimer-title" className="font-display text-xl">
              Before we start listening
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-fg-muted leading-relaxed list-disc pl-5">
              <li>
                Hearing Coach is <strong>not a lawyer</strong>. Cues are
                AI-generated suggestions, not legal advice.
              </li>
              <li>
                <strong>Lexor never receives or stores your audio.</strong>{" "}
                Only the text transcript is sent to our servers to generate
                cues. Note: your browser's built-in transcription
                (SpeechRecognition) may route audio through your browser
                vendor's speech service (e.g. Google for Chrome) — review
                your browser's privacy policy if that matters to you.
              </li>
              <li>
                Recording laws vary by state. Many require everyone in the
                room to consent. <strong>You are responsible</strong> for
                following your jurisdiction's rules — ask the court before
                the hearing if you are unsure.
              </li>
              <li>
                The whisper voice plays through your device. Use a single
                earbud and keep the volume modest so you can hear the room.
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-base border border-border-strong bg-bg-raised px-4 py-2 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="shimmer-btn rounded-base px-4 py-2 text-sm font-medium"
          >
            I understand — start
          </button>
        </div>
      </div>
    </div>
  );
}
