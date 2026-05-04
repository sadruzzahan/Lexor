import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, ArrowLeft, Play } from "lucide-react";
import { useCreateCase, getListCasesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/contexts/AuthContext";

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (e: Event) => void;
  start: () => void;
  stop: () => void;
}

export default function NewInvestigation() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { userId } = useCurrentUser();
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [showText, setShowText] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const createCase = useCreateCase();

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    if (!SR) {
      setShowText(true);
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText) {
        setText((prev) => (prev ? prev + " " + finalText : finalText).trim());
      }
      setInterim(interimText);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognition.onerror = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
  }, []);

  function toggleListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      rec.start();
      setListening(true);
    }
  }

  function handleSubmit() {
    if (!text.trim()) return;
    const firstLine = text.split("\n")[0].slice(0, 255) || "New Investigation";
    createCase.mutate(
      {
        data: {
          title: firstLine,
          goal: text,
          rolePack: "detective",
          userId: userId ?? undefined,
        },
      },
      {
        onSuccess: (c) => {
          queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
          navigate(`/investigations/${c.id}`);
        },
      }
    );
  }

  const canSubmit = text.trim().length > 0 && !createCase.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="new-investigation-screen">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate("/investigations")}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-bold tracking-tight text-foreground">New Investigation</h1>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 pt-12 pb-24 max-w-lg mx-auto w-full gap-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-2"
        >
          <h2 className="text-lg font-semibold text-foreground">
            {listening ? "Listening..." : "Describe the incident"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {speechSupported
              ? "Speak to describe what happened, or type below"
              : "Type a description of the incident"}
          </p>
        </motion.div>

        {speechSupported && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={toggleListening}
            className="relative w-24 h-24 rounded-full flex items-center justify-center transition-all"
            style={{
              background: listening ? "rgba(0,255,136,0.12)" : "rgba(0,255,136,0.06)",
              border: `2px solid ${listening ? "#00FF88" : "rgba(0,255,136,0.3)"}`,
              boxShadow: listening ? "0 0 30px rgba(0,255,136,0.3), 0 0 60px rgba(0,255,136,0.1)" : "none",
              animation: listening ? "agent-halo 1.6s infinite ease-in-out" : "none",
            }}
            data-testid="button-mic"
          >
            {listening ? (
              <MicOff className="w-10 h-10 text-primary" />
            ) : (
              <Mic className="w-10 h-10 text-primary" />
            )}
          </motion.button>
        )}

        <AnimatePresence>
          {(interim || text) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full rounded-lg border border-border bg-card p-4"
            >
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {text}
                {interim && (
                  <span className="text-muted-foreground"> {interim}</span>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {speechSupported && !showText && (
          <button
            onClick={() => setShowText(true)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            data-testid="button-type-instead"
          >
            Type instead
          </button>
        )}

        <AnimatePresence>
          {(showText || !speechSupported) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full"
            >
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Describe the incident, location, time, and any relevant details..."
                className="w-full h-32 resize-none bg-card border-border text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
                data-testid="input-description"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full h-12 gap-2 text-sm font-semibold"
          style={
            canSubmit
              ? { background: "#00FF88", color: "#0A0F0C", boxShadow: "0 0 20px rgba(0,255,136,0.25)" }
              : {}
          }
          data-testid="button-start-investigation"
        >
          {createCase.isPending ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Starting...
            </span>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start Investigation
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
