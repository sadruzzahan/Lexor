/**
 * OpenTelemetry exporter bootstrap (G22 NFR-E-009 — configurable
 * exporter wiring).
 *
 * The engine emits spans through the @opentelemetry/api global tracer.
 * In dev that tracer is a no-op (NonRecordingSpan), which is fine for
 * unit tests and local work. In production we want those spans pushed
 * to a real collector (Honeycomb / Tempo / OTel Collector / etc) so
 * the R-22 in-memory snapshot is backed by durable storage.
 *
 * This module is intentionally split out of `tracing.ts` so the hot
 * path stays dependency-light. The SDK packages
 * (`@opentelemetry/sdk-trace-node`, `exporter-trace-otlp-http`,
 * `resources`, `semantic-conventions`) are dynamically imported only
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so a fresh checkout
 * doesn't have to install ~5MB of OTel SDKs to boot.
 *
 * Env contract (matches OTel spec):
 *   OTEL_EXPORTER_OTLP_ENDPOINT — collector URL, e.g.
 *     https://api.honeycomb.io/v1/traces. When unset this module is
 *     a no-op (the global tracer stays no-op).
 *   OTEL_EXPORTER_OTLP_HEADERS — optional comma-separated header pairs
 *     (e.g. "x-honeycomb-team=abc123"). Forwarded to the OTLP exporter.
 *   OTEL_SERVICE_NAME — defaults to "briefcase-engine".
 */
import { logger } from "../lib/logger";

const log = logger.child({ component: "otelInit" });

let initialized = false;

export async function initOtelExporter(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint) {
    log.info("OTel exporter disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
    return;
  }

  try {
    // Dynamic import so the SDK packages are only required when the
    // operator actually configures an exporter. If they're missing we
    // log + degrade — the global tracer falls back to no-op and the
    // R-22 in-memory buffer keeps working.
    const [{ NodeTracerProvider }, { BatchSpanProcessor }, otlp, resources, semconv] =
      await Promise.all([
        import("@opentelemetry/sdk-trace-node" as string),
        import("@opentelemetry/sdk-trace-base" as string),
        import("@opentelemetry/exporter-trace-otlp-http" as string),
        import("@opentelemetry/resources" as string),
        import("@opentelemetry/semantic-conventions" as string),
      ]);

    const headers = parseHeaders(process.env["OTEL_EXPORTER_OTLP_HEADERS"]);
    const exporter = new (otlp as { OTLPTraceExporter: new (cfg: unknown) => unknown })
      .OTLPTraceExporter({ url: endpoint, headers });

    const Resource = (resources as { Resource: new (attrs: Record<string, string>) => unknown })
      .Resource;
    const ATTR = (semconv as { SemanticResourceAttributes: { SERVICE_NAME: string } })
      .SemanticResourceAttributes;
    const provider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR.SERVICE_NAME]: process.env["OTEL_SERVICE_NAME"] ?? "briefcase-engine",
      }),
    });
    (provider as { addSpanProcessor: (p: unknown) => void }).addSpanProcessor(
      new BatchSpanProcessor(exporter),
    );
    (provider as { register: () => void }).register();

    log.info({ endpoint }, "OTel OTLP exporter initialised");
  } catch (err) {
    log.warn(
      { err, endpoint },
      "OTel SDK packages missing — exporter not initialised. Install @opentelemetry/sdk-trace-node + exporter-trace-otlp-http to enable.",
    );
  }
}

function parseHeaders(s: string | undefined): Record<string, string> | undefined {
  if (!s) return undefined;
  const out: Record<string, string> = {};
  for (const pair of s.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}
