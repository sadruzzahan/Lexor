/**
 * monteCarlo — Monte Carlo resampling over a discrete outcome distribution
 * for the PleaOutcomeSimulator (G13). Returns mean, percentile band, and a
 * 24-bin histogram for the UI.
 *
 * Engine selection (spec §9.5):
 *   - Production path: E2B sandbox running Python + NumPy. We submit a small
 *     deterministic script seeded by `seed` and parse the JSON it prints.
 *   - Fallback path: an equivalent in-process TS resampler. Used when E2B
 *     is unavailable (no key, network error, sandbox cold-start failure).
 *     Both engines return the SAME schema; only `engine` distinguishes them.
 *
 * Determinism: a `seed` is required so re-runs of the same case produce
 * stable charts (PleaOutcomeSimulator threads the runId in).
 */
import { createHash } from "node:crypto";
import { logger } from "../lib/logger.js";
import { runWithProgress } from "../engine";
import type { SubagentEmit } from "../agents/shared";

export interface OutcomeOption {
  /** Short label, e.g. "Acquittal", "Convicted — 24-36 mo", "Hung jury". */
  label: string;
  /** Relative weight (un-normalized; resampler normalizes). */
  weight: number;
  /** Expected sentence in months (0 for acquittal/hung). */
  sentenceMonthsLow: number;
  sentenceMonthsHigh: number;
}

export interface MonteCarloResult {
  iterations: number;
  /** P(label) sorted descending. */
  outcomes: Array<{ label: string; probability: number }>;
  sentenceMonths: {
    mean: number;
    p10: number;
    p50: number;
    p90: number;
  };
  /** 24-bin histogram of sampled sentence-months for the chart. */
  histogram: Array<{ binStart: number; binEnd: number; count: number }>;
  engine: "in-process-ts" | "e2b-numpy";
}

const log = logger.child({ tool: "monteCarlo" });

function seededRng(seed: string): () => number {
  const h = createHash("sha256").update(seed).digest();
  let s = h.readUInt32BE(0) || 1;
  return function rand() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOutcome(
  options: OutcomeOption[],
  cumulative: number[],
  rand: () => number,
): OutcomeOption {
  const r = rand();
  for (let i = 0; i < cumulative.length; i++) {
    if (r <= cumulative[i]!) return options[i]!;
  }
  return options[options.length - 1]!;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

function inProcessMonteCarlo(args: {
  options: OutcomeOption[];
  iterations?: number;
  seed: string;
}): MonteCarloResult {
  const opts = args.options.filter((o) => o.weight > 0);
  if (opts.length === 0) {
    return {
      iterations: 0,
      outcomes: [],
      sentenceMonths: { mean: 0, p10: 0, p50: 0, p90: 0 },
      histogram: [],
      engine: "in-process-ts",
    };
  }
  const N = Math.min(Math.max(args.iterations ?? 10_000, 100), 50_000);

  const total = opts.reduce((s, o) => s + o.weight, 0);
  let acc = 0;
  const cumulative = opts.map((o) => {
    acc += o.weight / total;
    return acc;
  });

  const rand = seededRng(args.seed);
  const counts = new Map<string, number>();
  const samples = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const o = pickOutcome(opts, cumulative, rand);
    counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
    const span = Math.max(0, o.sentenceMonthsHigh - o.sentenceMonthsLow);
    samples[i] = o.sentenceMonthsLow + rand() * span;
  }

  const outcomes = Array.from(counts.entries())
    .map(([label, c]) => ({ label, probability: c / N }))
    .sort((a, b) => b.probability - a.probability);

  const sortedSamples = Array.from(samples).sort((a, b) => a - b);
  const mean = sortedSamples.reduce((s, v) => s + v, 0) / N;

  const p99 = percentile(sortedSamples, 99);
  const upper = Math.max(12, Math.ceil((p99 + 6) / 6) * 6);
  const bins = 24;
  const binSize = upper / bins;
  const histogram: MonteCarloResult["histogram"] = [];
  for (let i = 0; i < bins; i++) {
    histogram.push({
      binStart: +(i * binSize).toFixed(2),
      binEnd: +((i + 1) * binSize).toFixed(2),
      count: 0,
    });
  }
  for (const v of sortedSamples) {
    const b = Math.min(bins - 1, Math.floor(v / binSize));
    histogram[b]!.count += 1;
  }

  return {
    iterations: N,
    outcomes,
    sentenceMonths: {
      mean: +mean.toFixed(2),
      p10: +percentile(sortedSamples, 10).toFixed(2),
      p50: +percentile(sortedSamples, 50).toFixed(2),
      p90: +percentile(sortedSamples, 90).toFixed(2),
    },
    histogram,
    engine: "in-process-ts",
  };
}

/**
 * Run the same resample inside an E2B Python sandbox using NumPy. Seeded
 * by hashing `seed` to a uint32, so re-runs of the same case produce
 * identical charts. Returns null on any failure so the caller can fall
 * back to in-process.
 */
async function e2bNumpyMonteCarlo(args: {
  options: OutcomeOption[];
  iterations?: number;
  seed: string;
}): Promise<MonteCarloResult | null> {
  if (!process.env.E2B_API_KEY) return null;
  const opts = args.options.filter((o) => o.weight > 0);
  if (opts.length === 0) return null;
  const N = Math.min(Math.max(args.iterations ?? 10_000, 100), 50_000);
  const seedInt = createHash("sha256").update(args.seed).digest().readUInt32BE(0) || 1;

  let Sandbox: typeof import("@e2b/code-interpreter").Sandbox;
  try {
    ({ Sandbox } = await import("@e2b/code-interpreter"));
  } catch (err) {
    log.warn({ err }, "@e2b/code-interpreter unavailable; falling back");
    return null;
  }

  const payload = JSON.stringify({ options: opts, iterations: N, seed: seedInt });
  const code = `
import json, numpy as np
cfg = json.loads(${JSON.stringify(payload)})
opts = cfg["options"]
N = int(cfg["iterations"])
rng = np.random.default_rng(int(cfg["seed"]))
labels = [o["label"] for o in opts]
weights = np.array([o["weight"] for o in opts], dtype=float)
weights = weights / weights.sum()
lows = np.array([o["sentenceMonthsLow"] for o in opts], dtype=float)
highs = np.array([o["sentenceMonthsHigh"] for o in opts], dtype=float)
idx = rng.choice(len(opts), size=N, p=weights)
spans = np.maximum(0.0, highs[idx] - lows[idx])
samples = lows[idx] + rng.random(N) * spans
counts = {labels[i]: int((idx == i).sum()) for i in range(len(opts))}
outcomes = sorted(
    [{"label": k, "probability": v / N} for k, v in counts.items()],
    key=lambda r: -r["probability"],
)
mean = float(samples.mean())
p10, p50, p90, p99 = [float(np.percentile(samples, q)) for q in (10, 50, 90, 99)]
upper = max(12.0, float(np.ceil((p99 + 6) / 6) * 6))
bins = 24
edges = np.linspace(0, upper, bins + 1)
hist, _ = np.histogram(samples, bins=edges)
histogram = [
    {"binStart": round(float(edges[i]), 2),
     "binEnd": round(float(edges[i + 1]), 2),
     "count": int(hist[i])}
    for i in range(bins)
]
print(json.dumps({
    "iterations": N,
    "outcomes": [{"label": o["label"], "probability": round(o["probability"], 6)} for o in outcomes],
    "sentenceMonths": {
        "mean": round(mean, 2),
        "p10": round(p10, 2),
        "p50": round(p50, 2),
        "p90": round(p90, 2),
    },
    "histogram": histogram,
}))
`;

  let sandbox: InstanceType<typeof Sandbox> | undefined;
  try {
    sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY, timeoutMs: 30_000 });
    const exec = await sandbox.runCode(code, { timeoutMs: 25_000 });
    const stdout = exec.logs?.stdout?.join("") ?? "";
    if (!stdout.trim()) {
      log.warn({ stderr: exec.logs?.stderr?.join("") }, "E2B returned no stdout");
      return null;
    }
    const parsed = JSON.parse(stdout) as Omit<MonteCarloResult, "engine">;
    return { ...parsed, engine: "e2b-numpy" };
  } catch (err) {
    log.warn({ err }, "E2B numpy run failed; falling back to in-process");
    return null;
  } finally {
    try {
      await sandbox?.kill();
    } catch {
      /* ignore */
    }
  }
}

export async function monteCarlo(args: {
  options: OutcomeOption[];
  iterations?: number;
  seed: string;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<MonteCarloResult> {
  return runWithProgress({
    tool: "monteCarlo",
    emit: args.emit,
    subagent: args.subagent,
    runId: args.runId,
    meta: { iterations: args.iterations ?? 10_000 },
    fn: async () => {
      const e2b = await e2bNumpyMonteCarlo(args);
      if (e2b) return e2b;
      return inProcessMonteCarlo(args);
    },
  });
}
