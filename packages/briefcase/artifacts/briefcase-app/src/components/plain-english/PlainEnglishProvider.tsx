import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  plainEnglishEnabled as readPref,
  setPlainEnglishEnabled as writePref,
} from "@/lib/firstRun";
import glossaryEn from "@/lib/i18n/glossary.en.json";

export interface GlossaryEntry {
  plain: string;
  definition: string;
}

export type Glossary = Record<string, GlossaryEntry>;

interface PlainEnglishContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
  glossary: Glossary;
  /** Lookup a term (case-insensitive). Returns undefined if not in glossary. */
  lookup: (term: string) => GlossaryEntry | undefined;
}

const Ctx = createContext<PlainEnglishContextValue | null>(null);

const NORMALIZED: Glossary = (() => {
  const out: Glossary = {};
  for (const [k, v] of Object.entries(glossaryEn as Glossary)) {
    out[k.toLowerCase()] = v;
  }
  return out;
})();

export function PlainEnglishProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(false);

  useEffect(() => {
    setEnabledState(readPref());
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    writePref(v);
  }, []);

  const toggle = useCallback(
    () => setEnabled(!readPref()),
    [setEnabled],
  );

  const lookup = useCallback(
    (term: string) => NORMALIZED[term.trim().toLowerCase()],
    [],
  );

  const value = useMemo<PlainEnglishContextValue>(
    () => ({
      enabled,
      setEnabled,
      toggle,
      glossary: NORMALIZED,
      lookup,
    }),
    [enabled, setEnabled, toggle, lookup],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlainEnglish(): PlainEnglishContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "usePlainEnglish must be used within <PlainEnglishProvider>",
    );
  }
  return ctx;
}
