import { AnimatePresence, motion } from "framer-motion";
import { useRecording } from "@/contexts/RecordingContext";

export function RecordingIndicator() {
  const { isRecording } = useRecording();
  return (
    <AnimatePresence>
      {isRecording && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="fixed top-3 left-3 z-[9999] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.5)",
            color: "#ef4444",
            backdropFilter: "blur(8px)",
          }}
          role="status"
          aria-label="Recording in progress"
          data-testid="recording-indicator"
        >
          <span
            className="w-2 h-2 rounded-full bg-red-500 animate-pulse"
            aria-hidden="true"
          />
          Recording
        </motion.div>
      )}
    </AnimatePresence>
  );
}
