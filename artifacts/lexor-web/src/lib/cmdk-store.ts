import { create } from "zustand";

interface CmdState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useCmdK = create<CmdState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
