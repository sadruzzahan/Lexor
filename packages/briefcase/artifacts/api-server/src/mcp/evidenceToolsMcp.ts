/**
 * Evidence-tools MCP server. Wraps the citation verifier bank + a
 * couple of light evidence helpers (date sanity, transcript timestamp
 * proximity) behind an MCP-shaped surface. Independently versioned so
 * we can ship a new verifier without touching subagent code.
 */
import { verifyWithBank, type SourceType } from "../engine/verifierBank";
import type { McpServer, McpTool } from "./registry";

export const VERSION = "1.0.0";

const TOOLS: McpTool[] = [
  {
    name: "evidence.verifyCitation",
    description:
      "Run the multi-strategy citation verifier (substring → semantic → temporal → image-cropbox).",
    invoke: async (args) => {
      const runId = String(args.runId ?? "");
      const sourceType = String(args.sourceType ?? "url") as SourceType;
      const sourceId = String(args.sourceId ?? "");
      if (!runId || !sourceId) {
        return { ok: false, error: "runId and sourceId are required" };
      }
      const result = await verifyWithBank({
        runId,
        artifactKind: String(args.artifactKind ?? "Unknown"),
        sourceType,
        sourceId,
        quote: typeof args.quote === "string" ? args.quote : undefined,
        date: typeof args.date === "string" ? args.date : undefined,
        bbox:
          args.bbox && typeof args.bbox === "object"
            ? (args.bbox as { x: number; y: number; w: number; h: number })
            : undefined,
      });
      return { ok: true, result };
    },
  },
];

export const evidenceToolsMcp: McpServer = {
  name: "evidence-tools",
  version: VERSION,
  tools: TOOLS,
};
