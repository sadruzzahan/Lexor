/**
 * Briefcase / JusticeOS — provider smoke test (G0).
 *
 * Pings every external provider Briefcase depends on and prints OK/FAIL.
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/check-providers.ts
 */

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
  }
}

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

await check("Anthropic (claude-haiku-4-5)", async () => {
  const baseUrl = need("AI_INTEGRATIONS_ANTHROPIC_BASE_URL");
  const apiKey = need("AI_INTEGRATIONS_ANTHROPIC_API_KEY");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "Say hi in one word." }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content?: Array<{ text?: string }> };
  return json.content?.[0]?.text?.trim() ?? "(no text)";
});

await check("Gemini (gemini-2.5-flash)", async () => {
  const baseUrl = need("AI_INTEGRATIONS_GEMINI_BASE_URL");
  const apiKey = need("AI_INTEGRATIONS_GEMINI_API_KEY");
  // Replit Gemini proxy mounts the GenAI API directly under the base URL
  // (no /v1beta prefix). The official SDK uses apiVersion="" with this proxy.
  const url = `${baseUrl.replace(/\/$/, "")}/models/gemini-2.5-flash:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Say hi in one word." }] }],
      generationConfig: { maxOutputTokens: 16 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (
    json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "(no text)"
  );
});

await check("OpenAI (gpt-5-nano)", async () => {
  const baseUrl = need("AI_INTEGRATIONS_OPENAI_BASE_URL");
  const apiKey = need("AI_INTEGRATIONS_OPENAI_API_KEY");
  const res = await fetch(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        max_completion_tokens: 16,
        messages: [{ role: "user", content: "Say hi in one word." }],
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "(no text)";
});

await check("Tavily (search)", async () => {
  const apiKey = need("TAVILY_API_KEY");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: "Miranda v Arizona",
      max_results: 1,
      search_depth: "basic",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { results?: Array<{ title?: string }> };
  return json.results?.[0]?.title ?? "(no results)";
});

await check("E2B (sandbox API)", async () => {
  const apiKey = need("E2B_API_KEY");
  // List sandboxes — cheap auth check that doesn't spawn anything.
  const res = await fetch("https://api.e2b.dev/sandboxes", {
    headers: { "X-API-KEY": apiKey },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as unknown[];
  return `auth ok (${Array.isArray(json) ? json.length : 0} sandboxes)`;
});

await check("Google OAuth (web client)", async () => {
  need("GOOGLE_OAUTH_CLIENT_ID_WEB");
  need("GOOGLE_OAUTH_CLIENT_SECRET");
  return "env present";
});

await check("Google OAuth (iOS / Android client IDs — unused under web-only pivot)", async () => {
  need("GOOGLE_OAUTH_CLIENT_ID_IOS");
  need("GOOGLE_OAUTH_CLIENT_ID_ANDROID");
  return "env present";
});

await check("Session secret", async () => {
  need("SESSION_SECRET");
  return "env present";
});

let failed = 0;
for (const r of results) {
  const tag = r.ok ? "OK  " : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${r.name} — ${r.detail}`);
  if (!r.ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
