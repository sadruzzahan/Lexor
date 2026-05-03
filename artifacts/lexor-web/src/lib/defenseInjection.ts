/**
 * Per-case "additional defense paragraphs" store. The Adversary tab calls
 * `add()` when the user clicks "Use this defense", and the Defense tab
 * renders the paragraphs as an appended section. Lives in localStorage so
 * the choice persists across reloads.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface InjectedDefense {
  id: string;
  title: string;
  citation: string;
  citationUrl: string;
  bodyParagraph: string;
  fromEntityId: string;
  fromEntityName: string;
}

interface State {
  byCase: Record<string, InjectedDefense[]>;
  add: (caseId: string, def: InjectedDefense) => void;
  remove: (caseId: string, defId: string) => void;
  clear: (caseId: string) => void;
}

// Stable empty-array sentinel. Without this, selectors that fall back to
// `?? []` allocate a fresh array every render, which trips zustand's
// reference-equality check and causes a render loop.
const EMPTY: InjectedDefense[] = [];

export function selectInjectedFor(caseId: string | undefined) {
  return (s: State): InjectedDefense[] =>
    caseId ? s.byCase[caseId] ?? EMPTY : EMPTY;
}

export const useInjectedDefenses = create<State>()(
  persist(
    (set) => ({
      byCase: {},
      add: (caseId, def) =>
        set((s) => {
          const current = s.byCase[caseId] ?? [];
          if (current.some((d) => d.id === def.id)) return s;
          return { byCase: { ...s.byCase, [caseId]: [...current, def] } };
        }),
      remove: (caseId, defId) =>
        set((s) => ({
          byCase: {
            ...s.byCase,
            [caseId]: (s.byCase[caseId] ?? []).filter((d) => d.id !== defId),
          },
        })),
      clear: (caseId) =>
        set((s) => {
          const next = { ...s.byCase };
          delete next[caseId];
          return { byCase: next };
        }),
    }),
    { name: "lexor.injected-defenses.v1" },
  ),
);
