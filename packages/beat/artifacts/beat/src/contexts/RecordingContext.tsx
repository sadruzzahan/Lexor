import { createContext, useContext, useState, useCallback } from "react";

interface RecordingContextValue {
  isRecording: boolean;
  setRecording: (v: boolean) => void;
}

const RecordingContext = createContext<RecordingContextValue>({
  isRecording: false,
  setRecording: () => {},
});

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [isRecording, setIsRecordingState] = useState(false);
  const setRecording = useCallback((v: boolean) => setIsRecordingState(v), []);
  return (
    <RecordingContext.Provider value={{ isRecording, setRecording }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  return useContext(RecordingContext);
}
