import type { AgentEvent } from "@workspace/api-client-react";

export interface SseStreamOptions {
  url: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onError?: (err: unknown) => void;
}

/**
 * Stream SSE frames from `url` and decode each `data:` payload as an
 * `AgentEvent`. We use `fetch` (not the native `EventSource`) because the
 * dev API requires the `x-demo-user` header, which `EventSource` cannot send.
 *
 * Resumes by re-calling with `?since=<lastIdx>`; the server replays from
 * persisted `run_events` synchronously before live streaming.
 */
export async function streamSse({
  url,
  headers,
  signal,
  onEvent,
  onError,
}: SseStreamOptions): Promise<void> {
  let resumeIdx = -1;

  while (!signal.aborted) {
    const target =
      resumeIdx >= 0
        ? `${url}${url.includes("?") ? "&" : "?"}since=${resumeIdx}`
        : url;

    // Send both `?since=N` (preferred per the OpenAPI spec) and the standard
    // `Last-Event-ID` header so either resumption path on the server picks up
    // the right index.
    const resumeHeaders: Record<string, string> =
      resumeIdx >= 0 ? { "Last-Event-ID": String(resumeIdx) } : {};

    try {
      const res = await fetch(target, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          ...headers,
          ...resumeHeaders,
        },
        signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE stream failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) {
          done = true;
          break;
        }
        buffer += value;

        // SSE messages are separated by a blank line ("\n\n").
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          let dataLine = "";
          for (const raw of frame.split("\n")) {
            const line = raw.trimEnd();
            if (line.startsWith("data:")) {
              dataLine += line.slice(5).trimStart();
            }
          }
          if (!dataLine) continue;

          try {
            const parsed = JSON.parse(dataLine) as AgentEvent;
            if (typeof parsed?.idx === "number") resumeIdx = parsed.idx;
            onEvent(parsed);
            if (parsed.type === "done") {
              done = true;
              return;
            }
          } catch (err) {
            onError?.(err);
          }
        }
      }
      // Stream ended without a `done` event — try to resume.
      if (signal.aborted) return;
    } catch (err) {
      if (signal.aborted) return;
      onError?.(err);
      // Backoff before reconnecting.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
