import { PROVIDERS } from "@/lib/config";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * xAI Grok Imagine video. Docs (verified live 2026-07-06):
 * grok-imagine-video-1.5 is IMAGE-to-video only — xAI has no direct
 * text-to-video mode. So submit() runs the same two-step pipeline the
 * Grok Imagine product uses:
 *   1. POST /v1/images/generations { model: grok-imagine-image-quality, prompt }
 *      -> data[0].url  (a still that sets the look)
 *   2. POST /v1/videos/generations { model, prompt, image: { url }, duration }
 *      -> request id   (animates the still, guided by the prompt)
 *   GET  /v1/videos/{request_id} -> status: done|failed|expired, video.url
 * No aspect param is documented — the image follows aspect cues in the
 * prompt text ("Vertical 9:16 …") and the video follows the image.
 */

const BASE = "https://api.x.ai/v1";
const REQUEST_ID = /^[\w-]+$/;
const IMAGE_MODEL = "grok-imagine-image-quality";

function apiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set — add it in the UI key panel");
  return key;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return (
      body?.error?.message ?? body?.error ?? `xAI API error (HTTP ${res.status})`
    );
  } catch {
    return `xAI API error (HTTP ${res.status})`;
  }
}

export const grok: VideoProvider = {
  name: "grok",

  async submit(prompt: string, params: SubmitParams) {
    const headers = {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    };

    // Step 1: a source still. A user-attached reference skips the
    // generated-image step entirely; otherwise text -> still image.
    let imageUrl: string;
    if (params.image) {
      imageUrl = `data:${params.image.mimeType};base64,${params.image.base64}`;
    } else {
      const imgRes = await fetch(`${BASE}/images/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1 }),
      });
      if (!imgRes.ok) throw new Error(`Image step: ${await readError(imgRes)}`);
      const imgBody = await imgRes.json();
      const url = imgBody?.data?.[0]?.url;
      if (typeof url !== "string" || !url) {
        throw new Error("xAI image step returned no image url");
      }
      imageUrl = url;
    }

    // Step 2: image -> video, prompt guides the motion.
    const res = await fetch(`${BASE}/videos/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: PROVIDERS.grok.modelId,
        prompt,
        image: { url: imageUrl },
        duration: params.durationSeconds,
      }),
    });
    if (!res.ok) throw new Error(`Video step: ${await readError(res)}`);
    const body = await res.json();
    const id = body.request_id ?? body.id;
    if (typeof id !== "string" || !id) {
      throw new Error("xAI did not return a request id");
    }
    return { jobId: id };
  },

  async status(jobId: string): Promise<JobStatus> {
    if (!REQUEST_ID.test(jobId)) {
      return { state: "error", error: "Malformed job id" };
    }
    const res = await fetch(`${BASE}/videos/${jobId}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) return { state: "error", error: await readError(res) };

    const job = await res.json();
    if (job.status === "done") {
      const url = job.video?.url;
      if (typeof url !== "string" || !url) {
        return { state: "error", error: "xAI finished without a video url" };
      }
      // xAI's CDN (vidgen.x.ai) sends no CORS headers — proxy it so the
      // player is same-origin and snapshot capture (continuity) works.
      return {
        state: "done",
        videoUrl: `/api/video?remote=${encodeURIComponent(url)}`,
      };
    }
    if (job.status === "failed" || job.status === "expired") {
      return { state: "error", error: `xAI generation ${job.status}` };
    }
    return { state: "pending" };
  },
};
