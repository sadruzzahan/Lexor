/**
 * Heuristic language detection — script-class buckets that cover CLDR top-50
 * for the JurisdictionDetector's first pass. Returns a BCP-47-ish 2-letter
 * code or "und" for undetermined. The JurisdictionDetector LLM step refines
 * this further; the heuristic exists so we always have a deterministic
 * fallback even when the LLM is unavailable.
 */
export interface LangDetectResult {
  language: string; // BCP-47-ish 2-letter, "und" if unknown
  script: "Latn" | "Cyrl" | "Hans" | "Hant" | "Jpan" | "Kore" | "Arab" | "Deva" | "Hebr" | "Thai" | "Grek" | "und";
  confidence: number; // 0..1
}

interface ScriptCounts {
  Latn: number;
  Cyrl: number;
  Hans: number;
  Hant: number;
  Jpan: number;
  Kore: number;
  Arab: number;
  Deva: number;
  Hebr: number;
  Thai: number;
  Grek: number;
}

function countScripts(text: string): ScriptCounts {
  const c: ScriptCounts = {
    Latn: 0, Cyrl: 0, Hans: 0, Hant: 0, Jpan: 0, Kore: 0,
    Arab: 0, Deva: 0, Hebr: 0, Thai: 0, Grek: 0,
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x0041 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF)) c.Latn++;
    else if (cp >= 0x0400 && cp <= 0x04FF) c.Cyrl++;
    else if (cp >= 0x3040 && cp <= 0x30FF) c.Jpan++; // hiragana/katakana → Japanese
    else if (cp >= 0xAC00 && cp <= 0xD7AF) c.Kore++;
    else if (cp >= 0x4E00 && cp <= 0x9FFF) c.Hans++; // CJK ideograph (default Simplified)
    else if (cp >= 0x0600 && cp <= 0x06FF) c.Arab++;
    else if (cp >= 0x0900 && cp <= 0x097F) c.Deva++;
    else if (cp >= 0x0590 && cp <= 0x05FF) c.Hebr++;
    else if (cp >= 0x0E00 && cp <= 0x0E7F) c.Thai++;
    else if (cp >= 0x0370 && cp <= 0x03FF) c.Grek++;
  }
  return c;
}

// Tiny stop-word probes for Latin-script languages where the script alone
// doesn't disambiguate. Conservative — false negatives prefer "und".
const LATIN_PROBES: Array<{ lang: string; words: string[] }> = [
  { lang: "en", words: [" the ", " and ", " of ", " to "] },
  { lang: "es", words: [" el ", " la ", " los ", " que ", " del "] },
  { lang: "fr", words: [" le ", " la ", " les ", " des ", " que "] },
  { lang: "de", words: [" der ", " die ", " das ", " und ", " ist "] },
  { lang: "pt", words: [" de ", " da ", " do ", " que ", " uma "] },
  { lang: "it", words: [" il ", " la ", " che ", " di ", " una "] },
  { lang: "nl", words: [" de ", " het ", " een ", " van ", " en "] },
];

const SCRIPT_TO_LANG: Record<string, string> = {
  Cyrl: "ru",
  Hans: "zh",
  Hant: "zh",
  Jpan: "ja",
  Kore: "ko",
  Arab: "ar",
  Deva: "hi",
  Hebr: "he",
  Thai: "th",
  Grek: "el",
};

export function langDetect(text: string): LangDetectResult {
  if (!text || text.trim().length < 4) {
    return { language: "und", script: "und", confidence: 0 };
  }
  const sample = text.slice(0, 4000).toLowerCase();
  const counts = countScripts(sample);
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const dominant = (Object.entries(counts) as [keyof ScriptCounts, number][])
    .sort((a, b) => b[1] - a[1])[0]!;
  const script = dominant[0];
  const scriptShare = dominant[1] / total;

  if (script !== "Latn" && SCRIPT_TO_LANG[script]) {
    return {
      language: SCRIPT_TO_LANG[script]!,
      script,
      confidence: Math.min(0.95, 0.6 + scriptShare * 0.4),
    };
  }

  // Latin script → probe for stop words
  const padded = ` ${sample.replace(/[\n\r\t]+/g, " ")} `;
  let bestLang = "und";
  let bestScore = 0;
  for (const probe of LATIN_PROBES) {
    let hits = 0;
    for (const w of probe.words) {
      const m = padded.split(w).length - 1;
      hits += m;
    }
    if (hits > bestScore) {
      bestScore = hits;
      bestLang = probe.lang;
    }
  }
  if (bestScore === 0) {
    return { language: "und", script: "Latn", confidence: 0.2 };
  }
  return {
    language: bestLang,
    script: "Latn",
    confidence: Math.min(0.9, 0.4 + bestScore * 0.05),
  };
}
