import type { AgentContext, SceneTagResult } from "./types.js";
import type { IEventSink } from "../lib/eventSink.js";
import type { CostTracker } from "../lib/costTracker.js";
import { getGeminiClient } from "../lib/aiClients.js";
import { toJsonb } from "../lib/toJsonb.js";
import { db } from "@workspace/db";
import { artifactsTable } from "@workspace/db/schema";
import fs from "node:fs/promises";
import path from "node:path";

const SYSTEM_PROMPT = `You are a forensic scene analysis AI for law enforcement.
Analyze the incident description and any attached photo evidence.
Return a JSON object:
{
  "tags": ["array of specific forensic scene tags, e.g. forced-entry, blood-trace"],
  "summary": "2-3 sentence scene analysis narrative",
  "confidence": 0.0-1.0
}
Tags: specific, lowercase, hyphenated, 5-10 items. Respond with JSON only, no code fences.`;

const FALLBACK: SceneTagResult = {
  tags: ["scene-unanalyzed"],
  summary: "Scene analysis unavailable.",
  confidence: 0,
};

async function readPhotoAsBase64(
  storageUrl: string,
  mimeType: string,
): Promise<{ inlineData: { data: string; mimeType: string } } | null> {
  try {
    const filePath = storageUrl.startsWith("/") ? storageUrl : path.resolve(storageUrl);
    const buffer = await fs.readFile(filePath);
    return { inlineData: { data: buffer.toString("base64"), mimeType } };
  } catch {
    return null;
  }
}

export async function runSceneCaptureTagger(
  ctx: AgentContext,
  sink: IEventSink,
  costTracker?: CostTracker,
): Promise<SceneTagResult> {
  try {
    const ai = getGeminiClient();

    const photoFiles = ctx.caseFiles.filter(
      (f) => f.sourceType === "photo" || f.mimeType.startsWith("image/"),
    );

    const allTags: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const photo of photoFiles.slice(0, 5)) {
      if (ctx.signal.aborted) break;

      const photoDesc = photo.caption ?? photo.filename;

      sink.emit("tool_call", {
        subagent: "SceneCaptureTagger",
        tool: { name: "visionTagPhoto", args: { fileId: photo.id, filename: photoDesc } },
      });

      try {
        const inlinePart = await readPhotoAsBase64(photo.storageUrl, photo.mimeType);
        const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
          { text: `Incident: ${ctx.goal}\n\nAnalyze photo: ${photoDesc}` },
        ];
        if (inlinePart) parts.splice(1, 0, inlinePart);

        const responsePromise = ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            maxOutputTokens: 256,
          },
        });

        const response = await Promise.race([
          responsePromise,
          new Promise<never>((_, reject) => {
            if (ctx.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
            ctx.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
        ]);

        if (response.usageMetadata) {
          totalInputTokens += response.usageMetadata.promptTokenCount ?? 0;
          totalOutputTokens += response.usageMetadata.candidatesTokenCount ?? 0;
        }

        const cleaned = (response.text ?? "{}").replace(/```(?:json)?\n?/g, "").trim();
        const parsed = JSON.parse(cleaned) as Partial<SceneTagResult>;
        const photoTags = Array.isArray(parsed.tags) ? parsed.tags : [];

        for (const tag of photoTags) {
          if (!allTags.includes(tag)) allTags.push(tag);
        }

        sink.emit("tool_result", {
          subagent: "SceneCaptureTagger",
          tool: { name: "visionTagPhoto", result: { fileId: photo.id, tags: photoTags } },
        });

        if (photoTags.length > 0) {
          sink.emit("partial_result", {
            subagent: "SceneCaptureTagger",
            data: { text: `[photo: ${photoDesc}] tags: ${photoTags.join(", ")}` },
          });
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") break;
        console.error("[SceneCaptureTagger] photo error:", err);
        sink.emit("tool_result", {
          subagent: "SceneCaptureTagger",
          tool: { name: "visionTagPhoto", result: { fileId: photo.id, error: true } },
        });
      }
    }

    if (ctx.signal.aborted) {
      sink.emit("subagent_completed", { name: "SceneCaptureTagger", data: toJsonb(FALLBACK) });
      return FALLBACK;
    }

    const jurisdictionCtx = ctx.jurisdiction
      ? ` Jurisdiction: ${ctx.jurisdiction.country}/${ctx.jurisdiction.region} (${ctx.jurisdiction.legalSystem}).`
      : "";

    const aggregateParts: Array<{ text: string }> = [
      {
        text:
          photoFiles.length > 0
            ? `Incident: ${ctx.goal}${jurisdictionCtx}\n\nPhoto-derived tags: ${allTags.join(", ")}\n\nProvide comprehensive scene analysis:`
            : `Incident description: ${ctx.goal}${jurisdictionCtx}`,
      },
    ];

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: aggregateParts }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 1024,
      },
    });

    let fullText = "";
    for await (const chunk of stream) {
      if (ctx.signal.aborted) break;
      const text = chunk.text;
      if (text) {
        fullText += text;
        sink.emit("partial_result", { subagent: "SceneCaptureTagger", data: { text } });
      }
      if (chunk.usageMetadata) {
        totalInputTokens += chunk.usageMetadata.promptTokenCount ?? 0;
        totalOutputTokens += chunk.usageMetadata.candidatesTokenCount ?? 0;
      }
    }

    if (costTracker && (totalInputTokens > 0 || totalOutputTokens > 0)) {
      costTracker.record("gemini-2.5-flash", {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      });
    }

    let result: SceneTagResult;
    try {
      const cleaned = fullText.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as SceneTagResult;
      if (Array.isArray(parsed.tags)) {
        for (const tag of allTags) {
          if (!parsed.tags.includes(tag)) parsed.tags.push(tag);
        }
        result = parsed;
      } else {
        result = FALLBACK;
      }
    } catch {
      result =
        allTags.length > 0
          ? { tags: allTags, summary: "Scene tags extracted from photos.", confidence: 0.7 }
          : FALLBACK;
    }

    await db
      .insert(artifactsTable)
      .values({
        runId: ctx.runId,
        subagent: "SceneCaptureTagger",
        kind: "scene_tags",
        data: toJsonb(result),
      })
      .catch((err) => console.error("[SceneCaptureTagger] db:", err));

    sink.emit("subagent_completed", { name: "SceneCaptureTagger", data: toJsonb(result) });
    return result;
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!isAbort) {
      console.error("[SceneCaptureTagger] error:", err);
      sink.emit("error", {
        subagent: "SceneCaptureTagger",
        message: `SceneCaptureTagger failed: ${String(err).slice(0, 200)}`,
      });
    }
    sink.emit("subagent_completed", { name: "SceneCaptureTagger", data: toJsonb(FALLBACK) });
    return FALLBACK;
  }
}
