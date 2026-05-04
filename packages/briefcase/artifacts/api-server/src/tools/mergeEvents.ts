/**
 * mergeEvents — in-process merge + dedup over events extracted from multiple
 * documents. Sorts ascending by date and folds duplicate events that share
 * a normalized title within a 1-hour bucket.
 */
import type { ExtractedEvent } from "./extractEntities";

export interface TimelineEventMerged {
  date: string; // ISO
  title: string;
  sources: { fileId: string; fileName: string; page?: number; quote: string }[];
  confidence: number;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function bucketKey(iso: string): string {
  // Hour bucket so "2024-08-12T22:14" and "2024-08-12T22:18" merge.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

export function mergeEvents(
  inputs: Array<{
    fileId: string;
    fileName: string;
    events: ExtractedEvent[];
  }>,
): TimelineEventMerged[] {
  const buckets = new Map<string, TimelineEventMerged>();
  for (const { fileId, fileName, events } of inputs) {
    for (const ev of events) {
      const norm = normalizeTitle(ev.title);
      const key = `${bucketKey(ev.date)}::${norm.slice(0, 40)}`;
      const existing = buckets.get(key);
      const source = {
        fileId,
        fileName,
        page: ev.page,
        quote: ev.sourceQuote,
      };
      if (existing) {
        existing.sources.push(source);
        existing.confidence = Math.max(existing.confidence, ev.confidence);
      } else {
        buckets.set(key, {
          date: ev.date,
          title: ev.title,
          sources: [source],
          confidence: ev.confidence,
        });
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
