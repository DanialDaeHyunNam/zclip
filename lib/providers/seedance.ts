import { PROVIDERS } from "@/lib/config";
import { deleteBlobs, putTempBlob } from "@/lib/blob";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * ByteDance Seedance via BytePlus ModelArk. Two models ride this adapter:
 *   - seedance-1-0-pro: text + first-frame image (endpoint verified live 2026-07-09)
 *   - dreamina-seedance-2-0: multimodal — additionally takes a REFERENCE VIDEO
 *     (motion + audio read directly) via a video_url content item. Video
 *     inputs are URL-only, so the driving clip is parked on Vercel Blob for
 *     the job and deleted at terminal state. 2.0 shape from the ModelArk
 *     docs/tutorials — verify on first real run.
 *   POST /api/v3/contents/generations/tasks
 *        { model, content: [{ type:"text", text: "<prompt> --ratio 9:16 --duration 4 --resolution 720p" },
 *                           { type:"video_url", video_url:{url}, role:"reference_video" }?] }
 *   GET  /api/v3/contents/generations/tasks/{id}
 *        -> status: queued|running|succeeded|failed, content.video_url
 */

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const TASK_ID = /^[\w-]+$/;

/** taskId → temp blob URL, so status() can clean up when the job ends.
 *  In-memory is fine for a local dev tool: a restart mid-job merely orphans
 *  one small blob (deletable from the Vercel dashboard). */
const taskBlobs = new Map<string, string>();

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
    // Seedance rejects mixing first/last-frame content with reference media
    // ("first/last frame content cannot be mixed with reference media
    // content", verified live 2026-07-10) — so a first-frame image only goes
    // when NO reference video rides along. With a video reference, subject
    // and scene live in the prompt text; the video carries the rest.
    if (params.image && !params.drivingVideo) {
      // First-frame reference, ModelArk image_url content item.
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${params.image.mimeType};base64,${params.image.base64}`,
        },
      });
    }
    let blobUrl: string | undefined;
    if (params.drivingVideo) {
      // Seedance 2.0 reads the WHOLE reference clip (motion + audio) — but
      // only by public URL, so park it on Vercel Blob for the job.
      const bytes = Buffer.from(params.drivingVideo.base64, "base64");
      const ext = params.drivingVideo.mimeType.includes("webm") ? "webm" : "mp4";
      blobUrl = await putTempBlob(
        bytes,
        params.drivingVideo.mimeType,
        `zclip-ref/ref.${ext}`,
      );
      content.push({
        type: "video_url",
        video_url: { url: blobUrl },
        role: "reference_video",
      });
    }
    const res = await fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId || PROVIDERS.seedance.modelId,
        content,
      }),
    });
    if (!res.ok) {
      if (blobUrl) void deleteBlobs([blobUrl]);
      throw new Error(await readError(res));
    }
    const { id } = await res.json();
    if (typeof id !== "string" || !id) {
      if (blobUrl) void deleteBlobs([blobUrl]);
      throw new Error("Seedance did not return a task id");
    }
    if (blobUrl) taskBlobs.set(id, blobUrl);
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
    // Terminal state → the temp reference blob (if any) is no longer needed.
    if (task.status === "succeeded" || task.status === "failed") {
      const blob = taskBlobs.get(jobId);
      if (blob) {
        taskBlobs.delete(jobId);
        void deleteBlobs([blob]);
      }
    }
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
