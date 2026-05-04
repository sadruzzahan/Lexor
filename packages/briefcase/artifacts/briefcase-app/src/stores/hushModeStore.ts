/**
 * G20 — global "Hush Mode" flag.
 *
 * Courtroom.tsx flips this true while the Hush surface is engaged so
 * the global AmbientReactor can freeze its decay loop and drop the
 * aurora to a low, quiet pulse instead of continuing to react to
 * background activity. Implemented as a zustand slice so it can be
 * subscribed to from any component without prop-drilling.
 */
import { create } from "zustand";

interface HushModeState {
  hush: boolean;
  setHush: (v: boolean) => void;
}

export const useHushModeStore = create<HushModeState>((set) => ({
  hush: false,
  setHush: (v) => set({ hush: v }),
}));
