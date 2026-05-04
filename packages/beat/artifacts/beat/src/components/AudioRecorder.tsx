import { useRef, useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";
import { useFileUpload, type UploadedFile } from "@/hooks/useFileUpload";
import { RecordingConsentModal } from "@/components/RecordingConsentModal";
import { useRecording } from "@/contexts/RecordingContext";
import { cn } from "@/lib/utils";

interface AudioRecorderProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: (file: UploadedFile) => void;
  /** ISO country + region signature (e.g. "US-CA") — consent is re-prompted per jurisdiction */
  jurisdictionSig?: string;
}

const WAVEFORM_BARS = 32;

export function AudioRecorder({ caseId, open, onClose, onUploaded, jurisdictionSig }: AudioRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showConsent, setShowConsent] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));
  const [micError, setMicError] = useState<string | null>(null);

  const { setRecording: setGlobalRecording } = useRecording();

  const { uploadFile } = useFileUpload({
    caseId,
    sourceType: "audio",
    onSuccess: onUploaded,
  });

  function stopAll() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.state !== "inactive" && mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  }

  useEffect(() => {
    if (!open) {
      stopAll();
      setIsRecording(false);
      setGlobalRecording(false);
      setIsUploading(false);
      setElapsed(0);
      setBars(Array(WAVEFORM_BARS).fill(0));
      setMicError(null);
    }
  }, [open]);

  function drawWaveform() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.floor(data.length / WAVEFORM_BARS);
    const newBars = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const slice = data.slice(i * step, (i + 1) * step);
      return slice.reduce((s, v) => s + v, 0) / slice.length / 255;
    });
    setBars(newBars);
    rafRef.current = requestAnimationFrame(drawWaveform);
  }

  function checkConsent() {
    const key = jurisdictionSig
      ? `beat_recording_consent_${jurisdictionSig}`
      : "beat_recording_consent_default";
    const given = sessionStorage.getItem(key);
    if (!given) {
      setPendingStart(true);
      setShowConsent(true);
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stopAll();
        setIsRecording(false);
        setGlobalRecording(false);
        setBars(Array(WAVEFORM_BARS).fill(0));

        // Auto-upload immediately on stop — no extra button click required
        setIsUploading(true);
        const ext = mimeType.includes("webm") ? "webm" : "wav";
        const file = new File([blob], `statement-${Date.now()}.${ext}`, { type: mimeType });
        const result = await uploadFile(file, "Witness statement recording");
        setIsUploading(false);
        if (result) onClose();
      };

      mr.start(250);
      setIsRecording(true);
      setGlobalRecording(true);
      setElapsed(0);

      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      rafRef.current = requestAnimationFrame(drawWaveform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "Microphone permission denied."
          : "Microphone unavailable.",
      );
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setBars(Array(WAVEFORM_BARS).fill(0));
    mediaRecorderRef.current?.stop();
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const statusLabel = isUploading
    ? "Uploading & transcribing…"
    : isRecording
    ? "Recording…"
    : "Ready to record";

  return (
    <>
      {showConsent && (
        <RecordingConsentModal
          jurisdictionSig={jurisdictionSig}
          onConsent={() => {
            setShowConsent(false);
            if (pendingStart) {
              setPendingStart(false);
              startRecording();
            }
          }}
          onDecline={() => {
            setShowConsent(false);
            setPendingStart(false);
          }}
        />
      )}

      <Dialog open={open && !showConsent} onOpenChange={(v) => { if (!v && !isUploading) { stopAll(); onClose(); } }}>
        <DialogContent
          className="max-w-sm"
          style={{ background: "#0A0F0C", border: "1px solid rgba(0,255,136,0.2)" }}
          data-testid="modal-audio-recorder"
        >
          <DialogHeader className="border-b border-border/40 pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Mic className="w-4 h-4 text-primary" />
              Record Witness Statement
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Waveform */}
            <div
              className="flex items-end justify-center gap-[2px] h-16 px-2 rounded-lg"
              style={{ background: "rgba(0,255,136,0.04)", border: "1px solid rgba(0,255,136,0.1)" }}
              data-testid="waveform-bars"
            >
              {bars.map((v, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[6px] rounded-sm transition-all duration-75",
                    isRecording ? "bg-primary" : "bg-muted-foreground/20",
                  )}
                  style={{ height: `${Math.max(4, v * 56)}px` }}
                />
              ))}
            </div>

            {/* Timer + status */}
            <div className="flex items-center justify-center gap-3">
              {isRecording && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  REC
                </span>
              )}
              {isUploading && (
                <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              )}
              <span
                className="text-2xl font-mono font-bold tabular-nums"
                style={{ color: isRecording ? "#00FF88" : isUploading ? "#00FF88" : "#8FA89A" }}
                data-testid="recording-timer"
              >
                {formatTime(elapsed)}
              </span>
            </div>

            {/* Status label */}
            <p className="text-center text-xs text-muted-foreground" data-testid="recorder-status">
              {statusLabel}
            </p>

            {/* Error */}
            {micError && (
              <p className="text-xs text-destructive text-center" data-testid="mic-error">
                {micError}
              </p>
            )}

            {/* Controls — only shown when not uploading */}
            {!isUploading && (
              <div className="flex gap-2">
                {!isRecording ? (
                  <Button
                    onClick={checkConsent}
                    disabled={!!micError}
                    className="flex-1 h-10 gap-2 text-xs font-semibold"
                    style={{ background: "#00FF88", color: "#0A0F0C" }}
                    data-testid="button-start-recording"
                  >
                    <Mic className="w-4 h-4" />
                    Start Recording
                  </Button>
                ) : (
                  <Button
                    onClick={stopRecording}
                    variant="outline"
                    className="flex-1 h-10 gap-2 text-xs font-semibold border-red-500/60 text-red-400 hover:bg-red-500/10"
                    data-testid="button-stop-recording"
                  >
                    <Square className="w-4 h-4" />
                    Stop & Upload
                  </Button>
                )}
              </div>
            )}

            {/* File upload fallback — only shown when idle */}
            {!isRecording && !isUploading && (
              <label className="block">
                <p className="text-[10px] text-muted-foreground text-center mb-1">
                  or upload an audio file directly
                </p>
                <Button
                  asChild
                  variant="ghost"
                  className="w-full h-8 text-xs text-muted-foreground"
                >
                  <span>Browse audio file</span>
                </Button>
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  data-testid="input-audio-file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const result = await uploadFile(file, "Uploaded audio statement");
                    if (result) onClose();
                  }}
                />
              </label>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
