import { PROVIDERS } from "@/lib/config";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * ByteDance Seedance via BytePlus ModelArk.
 * NOTE: built from BytePlus ModelArk docs, which are JS-rendered and could
 * not be live-verified like the others — double-check endpoint/model id on
 * first run: https://docs.byteplus.com/en/docs/ModelArk/
 *   POST /api/v3/contents/generations/tasks
 *        { model, content: [{ type:"text", text: "<prompt> --ratio 9:16 --duration 4 --resolution 720p" }] }
 *   GET  /api/v3/contents/generations/tasks/{id}
 *        -> status: queued|running|succeeded|failed, content.video_url
 */

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const TASK_ID = /^[\w-]+$/;

function apiKey(): string {
  const key = process.env.ARK_API_KEY;
  if (!key) throw new Error("ARK_API_KEY is not set — add it in the UI key panel");
  return key;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? `Seedance API error (HTTP ${res.status})`;
  } catch {
    return `Seedance API error (HTTP ${res.status})`;
  }
}

export const seedance: VideoProvider = {
  name: "seedance",

  async submit(prompt: string, params: SubmitParams) {
    const text = `${prompt} --ratio ${params.aspectRatio} --duration ${params.durationSeconds} --resolution ${params.resolution}`;
    const content: Array<Record<string, unknown>> = [{ type: "text", text }];
    if (params.image) {
      // First-frame reference, ModelArk image_url content item.
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${params.image.mimeType};base64,${params.image.base64}`,
        },
      });
    }
    const res = await fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: PROVIDERS.seedance.modelId,
        content,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { id } = await res.json();
    if (typeof id !== "string" || !id) {
      throw new Error("Seedance did not return a task id");
    }
    return { jobId: id };
  },

  async status(jobId: string): Promise<JobStatus> {
    if (!TASK_ID.test(jobId)) {
      return { state: "error", error: "Malformed job id" };
    }
    const res = await fetch(`${BASE}/contents/generations/tasks/${jobId}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) return { state: "error", error: await readError(res) };

    const task = await res.json();
    if (task.status === "succeeded") {
      const url = task.content?.video_url;
      if (typeof url !== "string" || !url) {
        return { state: "error", error: "Seedance finished without a video url" };
      }
      // ModelArk returns a presigned URL playable directly in the browser.
      return { state: "done", videoUrl: url };
    }
    if (task.status === "failed") {
      return {
        state: "error",
        error: task.error?.message ?? "Seedance generation failed",
      };
    }
    return { state: "pending" };
  },
};
