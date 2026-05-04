import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/** Reachability check: any HTTP response (including 4xx) means the proxy is alive */
async function probeUrl(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    // Any response except network error means the proxy process is up
    return res.status < 500 || res.status === 405;
  } catch {
    return false;
  }
}

async function checkAnthropicProxy(): Promise<boolean> {
  const baseUrl = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseUrl || !apiKey) return false;
  // POST /v1/messages — proxy will reject with 4xx if key invalid, but will respond
  return probeUrl(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [] }),
  });
}

async function checkOpenAIProxy(): Promise<boolean> {
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseUrl || !apiKey) return false;
  return probeUrl(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [] }),
  });
}

async function checkGeminiProxy(): Promise<boolean> {
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  if (!baseUrl || !apiKey) return false;
  return probeUrl(`${baseUrl}/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [] }),
  });
}

async function checkE2B(): Promise<boolean> {
  const key = process.env["E2B_API_KEY"];
  if (!key) return false;
  try {
    const res = await fetch("https://api.e2b.dev/health", {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

async function checkTavily(): Promise<boolean> {
  const key = process.env["TAVILY_API_KEY"];
  if (!key) return false;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: "ping", max_results: 1 }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

router.get("/healthz", async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {}

  const [anthropic, gemini, openai, e2b, tavily] = await Promise.all([
    checkAnthropicProxy(),
    checkGeminiProxy(),
    checkOpenAIProxy(),
    checkE2B(),
    checkTavily(),
  ]);

  const allOk = dbOk && anthropic && gemini && openai && e2b && tavily;
  res.json({
    status: allOk ? "ok" : "degraded",
    db: dbOk,
    anthropic,
    gemini,
    openai,
    e2b,
    tavily,
    version: "1.0.0",
  });
});

export default router;
