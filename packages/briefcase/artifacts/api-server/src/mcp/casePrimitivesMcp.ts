/**
 * Case-primitives MCP server (in-process). Exposes read-only access to
 * the canonical case data — case header, files, parsed pages — so
 * subagents talk to one consistent surface instead of hand-rolling
 * SQL queries each time.
 *
 * Independently versioned (semver) and hot-swappable via the registry
 * in `mcp/registry.ts`. The shape mirrors the MCP "tools" contract so
 * a real transport can be swapped in later without touching callers.
 */
import { db, cases, caseFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { McpServer, McpTool } from "./registry";

export const VERSION = "1.0.0";

const TOOLS: McpTool[] = [
  {
    name: "case.get",
    description: "Fetch a case header by id.",
    invoke: async (args) => {
      const id = String(args.caseId ?? "");
      if (!id) return { ok: false, error: "caseId required" };
      const rows = await db.select().from(cases).where(eq(cases.id, id)).limit(1);
      const row = rows[0];
      if (!row) return { ok: false, error: "not_found" };
      return {
        ok: true,
        result: {
          id: row.id,
          title: row.title,
          rolePack: row.rolePack,
          jurisdictionContext: row.jurisdictionContext,
          status: row.status,
        },
      };
    },
  },
  {
    name: "case.listFiles",
    description: "List the case's ingested files (id + name + mime + size).",
    invoke: async (args) => {
      const id = String(args.caseId ?? "");
      if (!id) return { ok: false, error: "caseId required" };
      const rows = await db
        .select({
          id: caseFiles.id,
          name: caseFiles.name,
          mime: caseFiles.mime,
          sizeBytes: caseFiles.sizeBytes,
        })
        .from(caseFiles)
        .where(eq(caseFiles.caseId, id));
      return { ok: true, result: rows };
    },
  },
];

export const casePrimitivesMcp: McpServer = {
  name: "case-primitives",
  version: VERSION,
  tools: TOOLS,
};
