import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SourceViewer } from "@/components/SourceViewer";

interface CitationChipProps {
  sourceId: string;
  caseId: string;
  highlightText?: string;
}

export function CitationChip({ sourceId, caseId, highlightText }: CitationChipProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 mx-0.5"
        data-testid={`citation-chip-${sourceId}`}
      >
        <Badge
          variant="outline"
          className="text-[10px] font-mono px-1.5 py-0 cursor-pointer border-primary/40 text-primary hover:bg-primary/10 transition-colors"
        >
          [{sourceId}]
        </Badge>
      </button>
      <SourceViewer
        open={open}
        onClose={() => setOpen(false)}
        caseId={caseId}
        fileId={sourceId}
        highlightText={highlightText}
      />
    </>
  );
}

/**
 * Parse `[cite:sourceId]` markers in text and return React nodes.
 * The fragment of text immediately before each citation (up to 120 chars,
 * last sentence boundary) is extracted as `highlightText` so the SourceViewer
 * can scroll to and highlight the referenced span in audio transcripts.
 */
export function parseCitationsInText(text: string, caseId: string): React.ReactNode[] {
  const parts = text.split(/(\[cite:[^\]]+\])/g);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const match = part.match(/^\[cite:([^\]]+)\]$/);
    if (match) {
      // Extract the preceding text fragment as highlight context.
      // Walk back through previous plain-text segments to build a snippet.
      let preceding = "";
      for (let j = i - 1; j >= 0; j--) {
        const seg = parts[j];
        if (seg.match(/^\[cite:[^\]]+\]$/)) break; // stop at prior citation
        preceding = seg + preceding;
        if (preceding.length >= 120) break;
      }
      // Take up to 120 chars from the end, trimmed to sentence/clause boundary.
      const raw = preceding.slice(-120).trim();
      // Find last sentence boundary (. ? ! ;) or clause boundary (, —) to get a clean phrase.
      const sentenceBreak = Math.max(
        raw.lastIndexOf(". "),
        raw.lastIndexOf("? "),
        raw.lastIndexOf("! "),
        raw.lastIndexOf("; "),
      );
      const highlightText = sentenceBreak >= 0 ? raw.slice(sentenceBreak + 2).trim() : raw;

      nodes.push(
        <CitationChip
          key={i}
          sourceId={match[1]}
          caseId={caseId}
          highlightText={highlightText || undefined}
        />,
      );
    } else {
      nodes.push(<span key={i}>{part}</span>);
    }
  }

  return nodes;
}
