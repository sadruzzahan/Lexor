/**
 * Jurisdiction-rules MCP server. Reads the static jurisdiction rule
 * pack maintained under `src/lib/jurisdictions.ts` and exposes lookup
 * tools so subagents don't reach into that module directly.
 * Hot-swappable so we can ship a new rule pack without touching
 * subagent code.
 */
import {
  JURISDICTIONS,
  trustedDomainsFor,
  type JurisdictionEntry,
} from "../lib/jurisdictions";
import type { McpServer, McpTool } from "./registry";

export const VERSION = "1.0.0";

const TOOLS: McpTool[] = [
  {
    name: "jurisdiction.lookup",
    description:
      "Return the jurisdiction record for an explicit ISO-2 country code.",
    invoke: async (args) => {
      const iso2 = String(args.iso2 ?? "").toUpperCase();
      if (iso2.length !== 2) return { ok: false, error: "iso2 must be 2 chars" };
      const entry: JurisdictionEntry | undefined = JURISDICTIONS[iso2];
      if (!entry) return { ok: false, error: "unknown jurisdiction" };
      return { ok: true, result: entry };
    },
  },
  {
    name: "jurisdiction.trustedDomains",
    description: "Return the trusted citation domains for an ISO-2 country.",
    invoke: async (args) => {
      const iso2 = String(args.iso2 ?? "");
      return { ok: true, result: trustedDomainsFor(iso2) };
    },
  },
  {
    name: "jurisdiction.list",
    description: "List all known jurisdictions (iso2 + country + legalSystem).",
    invoke: async () => {
      return {
        ok: true,
        result: Object.values(JURISDICTIONS).map((j) => ({
          iso2: j.iso2,
          country: j.country,
          legalSystem: j.legalSystem,
        })),
      };
    },
  },
];

export const jurisdictionRulesMcp: McpServer = {
  name: "jurisdiction-rules",
  version: VERSION,
  tools: TOOLS,
};
