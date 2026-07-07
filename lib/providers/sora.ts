import { PROVIDERS } from "@/lib/config";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * OpenAI Sora 2. Docs (verified live 2026-07-06):
 *   POST /v1/videos { model, prompt, size, seconds } -> { id: "video_..." }
 *   GET  /v1/videos/{id} -> status: queued|in_progress|completed|failed
 *   GET  /v1/videos/{id}/content -> mp4 (Bearer required -> proxied)
 * Constraints: seconds must be "8"|"16"|"20" (min 8s — longer than Veo's 4s
 * minimum, so any requested duration maps to 8). Output has a watermark.
 */

const BASE = "https://api.openai.com/v1";
const VIDEO_ID = /^video_[\w-]+$/;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set — add it in the UI key panel");
  return key;
}

function modelId(params: SubmitParams): string {
  return params.modelId || PROVIDERS.sora.modelId;
}

function sizeFor(params: SubmitParams): string {
  // Base sora-2 only accepts 720x1280 / 1280x720 (confirmed by API error);
  // the 1080p sizes (1080x1920 / 1920x1080) are sora-2-pro only.
  const pro = modelId(params).includes("pro");
  const hd = pro && params.resolution === "1080p";
  if (params.aspectRatio === "16:9") return hd ? "1920x1080" : "1280x720";
  return hd ? "1080x1920" : "720x1280";
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? `Sora API error (HTTP ${res.status})`;
  } catch {
    return `Sora API error (HTTP ${res.status})`;
  }
}

export const sora: VideoProvider = {
  name: "sora",

  async submit(prompt: string, params: SubmitParams) {
    let res: Response;
    if (params.image) {
      // input_reference must be sent as a file -> multipart. Docs note the
      // image should match the target resolution; mismatches error visibly.
      const fd = new FormData();
      fd.append("model", modelId(params));
      fd.append("prompt", prompt);
      fd.append("size", sizeFor(params));
      fd.append("seconds", "8");
      fd.append(
        "input_reference",
        new Blob([Buffer.from(params.image.base64, "base64")], {
          type: params.image.mimeType,
        }),
        "reference.jpg",
      );
      res = await fetch(`${BASE}/videos`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}` },
        body: fd,
      });
    } else {
      res = await fetch(`${BASE}/videos`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId(params),
          prompt,
          size: sizeFor(params),
          seconds: "8", // minimum Sora duration; UI durations < 8 round up
        }),
      });
    }
    if (!res.ok) throw new Error(await readError(res));
    const { id } = await res.json();
    if (typeof id !== "string" || !id) {
      throw new Error("Sora did not return a video id");
    }
    return { jobId: id };
  },

  async status(jobId: string): Promise<JobStatus> {
    if (!VIDEO_ID.test(jobId)) {
      return { state: "error", error: "Malformed job id" };
    }
    const res = await fetch(`${BASE}/videos/${jobId}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) return { state: "error", error: await readError(res) };

    const job = await res.json();
    if (job.status === "completed") {
      // Content download needs the Bearer key -> same-origin proxy.
      return {
        state: "done",
        videoUrl: `/api/video?provider=sora&ref=${encodeURIComponent(jobId)}`,
      };
    }
    if (job.status === "failed") {
      return {
        state: "error",
        error: job.error?.message ?? "Sora generation failed",
      };
    }
    return { state: "pending" };
  },
};
