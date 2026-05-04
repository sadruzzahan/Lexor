import { useRef, useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, RefreshCw, ImagePlus, Upload } from "lucide-react";
import { useFileUpload, type UploadedFile } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";

interface CameraCaptureProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: (file: UploadedFile) => void;
}

export function CameraCapture({ caseId, open, onClose, onUploaded }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const { uploadFile, isUploading } = useFileUpload({
    caseId,
    sourceType: "photo",
    onSuccess: onUploaded,
  });

  async function startCamera() {
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setCameraError("Camera permission denied. Use file upload below.");
      } else {
        setCameraError("Camera unavailable. Use file upload below.");
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  useEffect(() => {
    if (open) {
      setCaptured(null);
      setCapturedBlob(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open]);

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCaptured(canvas.toDataURL("image/jpeg", 0.9));
        stopCamera();
      },
      "image/jpeg",
      0.9,
    );
  }, []);

  function retake() {
    setCaptured(null);
    setCapturedBlob(null);
    startCamera();
  }

  async function handleUpload() {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    const result = await uploadFile(file);
    if (result) {
      setCaptured(null);
      setCapturedBlob(null);
      onClose();
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCaptured(url);
    setCapturedBlob(file);
    stopCamera();
  }

  async function handleDirectFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadFile(file);
    if (result) {
      onClose();
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { stopCamera(); onClose(); } }}>
      <DialogContent
        className="max-w-sm p-0 overflow-hidden"
        style={{ background: "#0A0F0C", border: "1px solid rgba(0,255,136,0.2)" }}
        data-testid="modal-camera-capture"
      >
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Camera className="w-4 h-4 text-primary" />
            Capture Scene Photo
          </DialogTitle>
        </DialogHeader>

        <div className="relative aspect-video bg-black">
          {/* Live camera feed */}
          <video
            ref={videoRef}
            className={cn("w-full h-full object-cover", (captured || cameraError) && "hidden")}
            muted
            playsInline
            data-testid="camera-preview"
          />

          {/* Captured snapshot preview */}
          {captured && (
            <img
              src={captured}
              alt="Captured"
              className="w-full h-full object-cover"
              data-testid="captured-preview"
            />
          )}

          {/* Camera error / no camera */}
          {cameraError && !captured && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <Camera className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">{cameraError}</p>
            </div>
          )}

          {/* Loading state */}
          {!cameraReady && !cameraError && !captured && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}
        </div>

        {/* Hidden canvas for snapshot */}
        <canvas ref={canvasRef} className="hidden" />

        <div className="p-4 space-y-3">
          {!captured ? (
            <div className="flex gap-2">
              <Button
                onClick={captureSnapshot}
                disabled={!cameraReady || isUploading}
                className="flex-1 h-10 gap-2 text-xs font-semibold"
                style={{ background: "#00FF88", color: "#0A0F0C" }}
                data-testid="button-capture-snapshot"
              >
                <Camera className="w-4 h-4" />
                Capture
              </Button>
              <label className="flex-1">
                <Button
                  asChild
                  variant="outline"
                  className="w-full h-10 gap-2 text-xs border-border/60"
                  data-testid="button-upload-photo-file"
                >
                  <span>
                    <ImagePlus className="w-4 h-4" />
                    Browse
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleDirectFileUpload}
                  data-testid="input-photo-file"
                />
              </label>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={retake}
                variant="outline"
                className="flex-1 h-10 gap-2 text-xs border-border/60"
                disabled={isUploading}
                data-testid="button-retake-photo"
              >
                <RefreshCw className="w-4 h-4" />
                Retake
              </Button>
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className="flex-1 h-10 gap-2 text-xs font-semibold"
                style={{ background: "#00FF88", color: "#0A0F0C" }}
                data-testid="button-save-photo"
              >
                {isUploading ? (
                  <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {isUploading ? "Uploading…" : "Save Photo"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
