/**
 * ConstitutionalGate (G22 spec §9.7.B NFR-E-007) — values check that
 * runs over every subagent artifact BEFORE it is rendered to the user.
 * Drops anything that violates the active role-pack's rules:
 *
 *   defender:
 *     - any field literally named "citations" must contain only entries
 *       with `verified === true`. Unverified citations are stripped (and
 *       the artifact is dropped if doing so empties a required field).
 *     - artifact-level `jurisdiction` (when present) must match the
 *       run's detected jurisdiction iso2.
 *     - no PII export — summary fields cannot contain raw email / phone
 *       / SSN sequences (privacy by default; the user already has the
 *       source documents).
 *
 * On a drop we:
 *   1. Persist a row in `policy_drops` with the rule + a *redacted*
 *      preview (never the raw payload — the whole point is to avoid
 *      leaking the offending content into the audit log).
 *   2. Emit a `policy_drop` SubagentEmitEvent so Glass Box / SSE
 *      observers see the gate fire in real time.
 *
 * The gate is intentionally side-effect-free on the artifact: callers
 * receive a new redacted artifact when allowed, or `null` when dropped
 * outright. Persistence + emit happen inside the gate, so call sites
 * stay one-liners.
 */
import { db, policyDrops } from "@workspace/db";
import { logger } from "../lib/logger";
import type { SubagentEmit } from "../agents/shared";

const log = logger.child({ component: "constitutionalGate" });

export type RolePack = "defender" | "detective";

export interface GateContext {
  runId: string;
  rolePack: RolePack;
  subagent: string;
  /**
   * Detected jurisdiction iso2 — when set, artifacts that declare a
   * jurisdiction field must match.
   */
  jurisdictionIso2?: string;
  emit?: SubagentEmit | undefined;
}

export interface GateAllow<T> {
  allowed: true;
  artifact: T;
  /**
   * True when the gate stripped sub-fields (e.g. unverified citations)
   * even though the artifact itself was kept. The dashboard can show a
   * subtle "filtered" badge in this case.
   */
  redacted: boolean;
}

export interface GateDrop {
  allowed: false;
  rule: string;
  preview: string;
}

export type GateResult<T> = GateAllow<T> | GateDrop;

const PII_PATTERNS: Array<{ rule: string; rx: RegExp }> = [
  { rule: "no-pii-email", rx: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  // simple US/EU phone heuristic — 10-15 digits with optional separators
  { rule: "no-pii-phone", rx: /(?:\+?\d[\d\s().-]{8,14}\d)/ },
  { rule: "no-pii-ssn", rx: /\b\d{3}-\d{2}-\d{4}\b/ },
];

/**
 * Walk the artifact and (a) strip unverified citations from any
 * `citations: []` field, (b) flag jurisdiction mismatch, (c) flag PII
 * in `summary` / `notes` / `text` string fields. Returns either a
 * possibly-redacted artifact or a drop verdict.
 */
export function evaluateDefenderArtifact<T extends Record<string, unknown>>(
  artifact: T,
  ctx: GateContext,
): GateResult<T> {
  let redacted = false;
  // Shallow copy so we never mutate the subagent's returned object.
  const out: Record<string, unknown> = { ...artifact };

  // --- Rule 1: verified citations only (drop on any unverified) ------
  // Per G22 NFR-E-007: artifacts containing ANY unverified citation are
  // dropped outright — we never silently ship the verified-only subset
  // because the surrounding reasoning was built against the full list
  // and may rely on the dropped sources.
  if (Array.isArray(out["citations"])) {
    const list = out["citations"] as Array<Record<string, unknown>>;
    const unverified = list.filter((c) => c["verified"] !== true);
    if (unverified.length > 0) {
      return {
        allowed: false,
        rule: "unverified-citations",
        preview: `field=citations unverified=${unverified.length} total=${list.length}`,
      };
    }
  }
  // Some artifacts nest citations one level deep (e.g. precedents[i].citation).
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (!Array.isArray(v)) continue;
    for (let i = 0; i < v.length; i++) {
      const entry = v[i];
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (!Array.isArray(e["citations"])) continue;
      const list = e["citations"] as Array<Record<string, unknown>>;
      const unverified = list.filter((c) => c["verified"] !== true);
      if (unverified.length > 0) {
        return {
          allowed: false,
          rule: "unverified-citations",
          preview: `field=${key}[${i}].citations unverified=${unverified.length} total=${list.length}`,
        };
      }
    }
  }

  // --- Rule 2: jurisdiction match ------------------------------------
  if (ctx.jurisdictionIso2 && typeof out["jurisdiction"] === "string") {
    const declared = String(out["jurisdiction"]).toLowerCase();
    const expected = ctx.jurisdictionIso2.toLowerCase();
    // Allow either a bare iso2 or "US-CA" style — match the prefix.
    if (
      declared !== expected &&
      !declared.startsWith(`${expected}-`) &&
      !declared.startsWith(`${expected} `)
    ) {
      return {
        allowed: false,
        rule: "jurisdiction-mismatch",
        preview: `declared=${declared} expected=${expected}`,
      };
    }
  }

  // --- Rule 3: no PII in summary fields ------------------------------
  for (const field of ["summary", "notes", "text"]) {
    const v = out[field];
    if (typeof v !== "string" || v.length === 0) continue;
    for (const { rule, rx } of PII_PATTERNS) {
      if (rx.test(v)) {
        return {
          allowed: false,
          rule,
          preview: `field=${field} length=${v.length}`,
        };
      }
    }
  }

  return { allowed: true, artifact: out as T, redacted };
}

/**
 * One-call entry: run the gate, persist + emit on drop, return a
 * narrow result the orchestrator can switch on. Side-effects are
 * best-effort; a DB or emit failure never derails the run.
 */
export async function applyGate<T extends Record<string, unknown>>(
  artifact: T,
  ctx: GateContext,
): Promise<GateResult<T>> {
  const verdict =
    ctx.rolePack === "defender"
      ? evaluateDefenderArtifact(artifact, ctx)
      : ({ allowed: true, artifact, redacted: false } as GateAllow<T>);

  if (!verdict.allowed) {
    try {
      await db.insert(policyDrops).values({
        runId: ctx.runId,
        subagent: ctx.subagent,
        rule: verdict.rule,
        // Redacted preview only — never the raw artifact.
        droppedPayload: { preview: verdict.preview },
      });
    } catch (err) {
      log.warn({ err, runId: ctx.runId }, "policy_drops persist failed (continuing)");
    }
    if (ctx.emit) {
      try {
        await ctx.emit({
          type: "policy_drop",
          subagent: ctx.subagent,
          rule: verdict.rule,
          droppedPayloadPreview: verdict.preview,
        });
      } catch (err) {
        log.warn({ err }, "policy_drop emit failed (continuing)");
      }
    }
  }
  return verdict;
}
