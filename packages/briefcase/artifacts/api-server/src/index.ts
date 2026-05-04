import app from "./app";
import { logger } from "./lib/logger";
import { initOtelExporter } from "./engine";
import { registerG23McpServers } from "./mcp/registry";

// G22 NFR-E-009: register the OTLP exporter (no-op when
// OTEL_EXPORTER_OTLP_ENDPOINT is unset) before the server starts so
// the very first model/tool/agent span has a place to land.
void initOtelExporter();

// G23 — register the in-process MCP catalog (case-primitives,
// jurisdiction-rules, evidence-tools) so subagents have a stable
// hot-swappable surface for case data + verification.
void registerG23McpServers().catch((err) =>
  logger.error({ err }, "Failed to register G23 MCP servers"),
);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
