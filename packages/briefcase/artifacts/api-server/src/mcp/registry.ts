/**
 * In-process MCP server registry — the seam that lets us swap a real
 * MCP transport in later without touching subagent code.
 *
 * Every G23 MCP server registers itself here with a name + semver
 * version + a flat list of `McpTool`s. Subagents call
 * `mcpRegistry.invoke("case-primitives", "case.get", { caseId })`
 * and the registry routes by server name.
 */
import { logger } from "../lib/logger";

export interface McpToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface McpTool {
  name: string;
  description: string;
  invoke: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpServer {
  name: string;
  version: string;
  tools: McpTool[];
}

class McpRegistry {
  private servers = new Map<string, McpServer>();

  register(server: McpServer): void {
    const existing = this.servers.get(server.name);
    if (existing) {
      logger.info(
        { name: server.name, from: existing.version, to: server.version },
        "mcp: hot-swapping server",
      );
    }
    this.servers.set(server.name, server);
  }

  get(name: string): McpServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Shape matches the OpenAPI `McpServerDescriptor` so the route can
   * forward the array verbatim and zod validation passes.
   */
  list(): { id: string; version: string; title: string; tools: string[] }[] {
    return [...this.servers.values()].map((s) => ({
      id: s.name,
      version: s.version,
      title: s.name,
      tools: s.tools.map((t) => t.name),
    }));
  }

  async invoke(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const s = this.servers.get(serverName);
    if (!s) return { ok: false, error: `mcp server not registered: ${serverName}` };
    const t = s.tools.find((tt) => tt.name === toolName);
    if (!t) return { ok: false, error: `tool not found on ${serverName}: ${toolName}` };
    return t.invoke(args);
  }
}

export const mcpRegistry = new McpRegistry();

/**
 * One-call bootstrap: registers the three G23 catalog servers. Called
 * from src/index.ts before the express listener starts.
 */
export async function registerG23McpServers(): Promise<void> {
  const [{ casePrimitivesMcp }, { jurisdictionRulesMcp }, { evidenceToolsMcp }] =
    await Promise.all([
      import("./casePrimitivesMcp"),
      import("./jurisdictionRulesMcp"),
      import("./evidenceToolsMcp"),
    ]);
  mcpRegistry.register(casePrimitivesMcp);
  mcpRegistry.register(jurisdictionRulesMcp);
  mcpRegistry.register(evidenceToolsMcp);
}
