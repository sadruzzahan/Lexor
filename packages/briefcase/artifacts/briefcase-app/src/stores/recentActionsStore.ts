import { create } from "zustand";

/**
 * G19 / B10 — Universal Undo / Recent Actions.
 *
 * Session-scoped log of destructive actions and their undo callbacks. Each
 * `<UndoToast>` wires through here so the Settings → Recent Actions screen
 * can replay the same Undo affordance for ~5 minutes after the action.
 */

export interface RecentAction {
  id: string;
  /** Short human label, e.g. "Deleted case 'State v. Sample'". */
  label: string;
  timestamp: number;
  /** Calling this restores the side effect. Cleared once invoked. */
  undo?: () => void;
  undone: boolean;
}

interface RecentActionsState {
  actions: RecentAction[];
  push: (a: Omit<RecentAction, "timestamp" | "undone">) => void;
  performUndo: (id: string) => void;
  clear: () => void;
}

const MAX = 25;

export const useRecentActionsStore = create<RecentActionsState>((set, get) => ({
  actions: [],
  push: (a) =>
    set((s) => ({
      actions: [
        { ...a, timestamp: Date.now(), undone: false },
        ...s.actions,
      ].slice(0, MAX),
    })),
  performUndo: (id) => {
    const action = get().actions.find((a) => a.id === id);
    if (!action || action.undone) return;
    try {
      action.undo?.();
    } finally {
      set((s) => ({
        actions: s.actions.map((a) =>
          a.id === id ? { ...a, undone: true, undo: undefined } : a,
        ),
      }));
    }
  },
  clear: () => set({ actions: [] }),
}));
