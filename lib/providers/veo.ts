import { PROVIDERS, effectiveSeconds } from "@/lib/config";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * Google Veo via the Gemini API (Google AI Studio key).
 * Docs: https://ai.google.dev/gemini-api/docs/veo
 *
 * Flow (verified against live docs 2026-07-06):
 *   POST /v1beta/models/{model}:predictLongRunning  -> { name }   (the jobId)
 *   GET  /v1beta/{name}                             -> { done, response|error }
 *   video URI at response.generateVideoResponse.generatedSamples[0].video.uri,
 *   downloadable only with the x-goog-api-key header -> proxied via /api/video.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Operation names look like "models/veo-3.1-.../operations/abc123".
const OPERATION_NAME = /^models\/[\w.-]+\/operations\/[\w-]+$/;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — see README.md");
  return key;
}

async function readError(res: Response): Promise<string> {
  let message = `Veo API error (HTTP ${res.status})`;
  try {
    const body = await res.json();
    message = body?.error?.message ?? message;
  } catch {
    /* non-JSON error body */
  }
  // Veo has NO free-tier quota — a fresh AI Studio key 429s until the
  // key's Google Cloud project has billing enabled. Say so, actionably.
  if (res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return (
      "Quota exceeded — Veo has no free-tier quota. Enable billing on this " +
      "API key's project (aistudio.google.com/apikey → your key's project → " +
      `Set up billing), then retry. Provider said: ${message}`
    );
  }
  return message;
}

export const veo: VideoProvider = {
  name: "veo",

  async submit(prompt: string, params: SubmitParams) {
    const res = await fetch(
      `${BASE}/models/${params.modelId || PROVIDERS.veo.modelId}:predictLongRunning`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instances: [
            {
              prompt,
              // Image-to-video: the reference becomes the first frame.
              ...(params.image && {
                image: {
                  bytesBase64Encoded: params.image.base64,
                  mimeType: params.image.mimeType,
                },
              }),
            },
          ],
          parameters: {
            aspectRatio: params.aspectRatio,
            durationSeconds: effectiveSeconds("veo", params.durationSeconds, params.resolution as "720p" | "1080p"),
            resolution: params.resolution,
            // Docs: image-based modes only allow "allow_adult".
            personGeneration: params.image ? "allow_adult" : "allow_all",
          },
        }),
      },
    );
    if (!res.ok) throw new Error(await readError(res));

    const { name } = await res.json();
    if (typeof name !== "string" || !name) {
      throw new Error("Veo did not return an operation name");
    }
    return { jobId: name };
  },

  async status(jobId: string): Promise<JobStatus> {
    if (!OPERATION_NAME.test(jobId)) {
      return { state: "error", error: "Malformed job id" };
    }

    const res = await fetch(`${BASE}/${jobId}`, {
      headers: { "x-goog-api-key": apiKey() },
    });
    if (!res.ok) return { state: "error", error: await readError(res) };

    const op = await res.json();
    if (!op.done) return { state: "pending" };

    if (op.error) {
      return {
        state: "error",
        error: op.error.message ?? "Generation failed provider-side",
      };
    }

    const gvr = op.response?.generateVideoResponse;
    const uri: string | undefined = gvr?.generatedSamples?.[0]?.video?.uri;
    if (!uri) {
      // Most common cause: responsible-AI media filter ate the output.
      const reasons = gvr?.raiMediaFilteredReasons?.join("; ");
      return {
        state: "error",
        error: reasons
          ? `Blocked by content policy: ${reasons}`
          : "Finished without a video — likely filtered by content policy. Soften the prompt and retry.",
      };
    }

    return {
      state: "done",
      // The raw URI needs our API key to download, so hand the client a
      // same-origin proxy URL instead (see app/api/video/route.ts).
      videoUrl: `/api/video?uri=${encodeURIComponent(uri)}`,
    };
  },
};
