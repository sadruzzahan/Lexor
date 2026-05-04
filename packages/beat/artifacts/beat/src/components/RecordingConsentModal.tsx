import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

/**
 * Build a sessionStorage key scoped to a jurisdiction signature.
 * When jurisdiction changes (new country/region detected), the key changes,
 * so the consent notice re-prompts for the new jurisdiction.
 */
function consentKey(jurisdictionSig?: string): string {
  return jurisdictionSig
    ? `beat_recording_consent_${jurisdictionSig}`
    : "beat_recording_consent_default";
}

interface RecordingConsentModalProps {
  onConsent: () => void;
  onDecline: () => void;
  /** ISO country code + optional region, e.g. "US-CA". Keyed per-jurisdiction. */
  jurisdictionSig?: string;
}

export function RecordingConsentModal({
  onConsent,
  onDecline,
  jurisdictionSig,
}: RecordingConsentModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = consentKey(jurisdictionSig);
    const given = sessionStorage.getItem(key);
    if (!given) setOpen(true);
    else onConsent();
  }, [jurisdictionSig]);

  function handleConsent() {
    sessionStorage.setItem(consentKey(jurisdictionSig), "1");
    setOpen(false);
    onConsent();
  }

  function handleDecline() {
    setOpen(false);
    onDecline();
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDecline(); }}>
      <DialogContent
        className="max-w-sm"
        style={{ background: "#121814", border: "1px solid rgba(0,255,136,0.2)" }}
        data-testid="modal-recording-consent"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldAlert className="w-4 h-4 text-yellow-400" />
            Recording Consent Notice
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            Beat records audio <strong className="text-foreground">only when you tap Record</strong>.
            You are responsible for ensuring that audio recording is lawful in your jurisdiction
            and that all parties have been informed as required by applicable law.
            {jurisdictionSig && (
              <>
                <br />
                <span className="font-mono text-primary/70">
                  Detected jurisdiction: {jurisdictionSig}
                </span>
              </>
            )}
            <br /><br />
            This notice will not appear again unless your detected jurisdiction changes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleConsent}
            className="flex-1 h-9 text-xs font-semibold"
            style={{ background: "#00FF88", color: "#0A0F0C" }}
            data-testid="button-consent-accept"
          >
            I Understand
          </Button>
          <Button
            variant="outline"
            onClick={handleDecline}
            className="h-9 text-xs border-border text-muted-foreground"
            data-testid="button-consent-decline"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Call before starting a MediaRecorder — shows consent once per jurisdiction per session */
export function useRecordingConsent(jurisdictionSig?: string) {
  function needsConsent(): boolean {
    return !sessionStorage.getItem(consentKey(jurisdictionSig));
  }
  function grantConsent() {
    sessionStorage.setItem(consentKey(jurisdictionSig), "1");
  }
  return { needsConsent, grantConsent };
}
