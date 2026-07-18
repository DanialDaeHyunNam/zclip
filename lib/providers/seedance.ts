import { PROVIDERS } from "@/lib/config";
import { hostTempRef } from "@/lib/ref-host";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * ByteDance Seedance via BytePlus ModelArk. Two models ride this adapter:
 *   - seedance-1-0-pro: text + first-frame image (endpoint verified live 2026-07-09)
 *   - dreamina-seedance-2-0: multimodal — additionally takes a REFERENCE VIDEO
 *     (motion + audio read directly) via a video_url content item. ModelArk
 *     REQUIRES a public web url here (data: URLs rejected at submit —
 *     verified live 2026-07-18), and Vercel Blob is retired (owner call,
 *     same day), so the clip parks on a free auto-expiring temp host
 *     (lib/ref-host: uguu.se → litterbox) just long enough for the fetch.
 *   POST /api/v3/contents/generations/tasks
 *        { model, content: [{ type:"text", text: "<prompt> --ratio 9:16 --duration 4 --resolution 720p" },
 *                           { type:"video_url", video_url:{url}, role:"reference_video" }?] }
 *   GET  /api/v3/contents/generations/tasks/{id}
 *        -> status: queued|running|succeeded|failed, content.video_url
 */

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const TASK_ID = /^[\w-]+$/;

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

  async submit(prompt: string, params: SubmitParams, apiKey: string) {
    const text = `${prompt} --ratio ${params.aspectRatio} --duration ${params.durationSeconds} --resolution ${params.resolution}`;
    const content: Array<Record<string, unknown>> = [{ type: "text", text }];
    // Image handling depends on what rides along:
    //  - image alone → FIRST-FRAME reference (no role), the classic i2v path.
    //  - image + reference video → the image goes as role "reference_image"
    //    (identity lock) next to the reference_video (motion). Sending it
    //    role-less alongside a video is what the API rejects ("first/last
    //    frame content cannot be mixed with reference media content",
    //    verified live 2026-07-10). Role-tagged mixing is the documented
    //    reference-to-video pattern (@Image + @Video) — UNVERIFIED on
    //    ModelArk until a first real run; if it errors, the message
    //    surfaces loudly in the take like any provider error.
    // Identity references. With a driving video they're reference_image
    // items (multi-subject r2v: one per person, in order — the prompt
    // refers to them as "first/second reference person"). Without a video,
    // a single image is the classic first-frame reference.
    const refImages =
      params.images?.length ? params.images : params.image ? [params.image] : [];
    if (refImages.length && !params.drivingVideo) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${refImages[0].mimeType};base64,${refImages[0].base64}`,
        },
      });
    } else if (refImages.length && params.drivingVideo) {
      for (const img of refImages) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          role: "reference_image",
        });
      }
    }
    if (params.drivingVideo) {
      // Seedance 2.0 reads the WHOLE reference clip (motion + audio) —
      // by public URL only, so park it on a free temp host for the job.
      const url = await hostTempRef(
        Buffer.from(params.drivingVideo.base64, "base64"),
        params.drivingVideo.mimeType,
      );
      content.push({
        type: "video_url",
        video_url: { url },
        role: "reference_video",
      });
    }
    const res = await fetch(`${BASE}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId || PROVIDERS.seedance.modelId,
        content,
      }),
    });
    if (!res.ok) {
      throw new Error(await readError(res));
    }
    const { id } = await res.json();
    if (typeof id !== "string" || !id) {
      throw new Error("Seedance did not return a task id");
    }
    return { jobId: id };
  },

  async status(jobId: string, apiKey: string): Promise<JobStatus> {
    if (!TASK_ID.test(jobId)) {
      return { state: "error", error: "Malformed job id" };
    }
    const res = await fetch(`${BASE}/contents/generations/tasks/${jobId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
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
