import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * Runway Act-Two (character performance) — the only real performance
 * transfer in the app. Docs: https://docs.dev.runwayml.com
 *
 * Unlike first-frame i2v (Veo/Sora/Grok), Act-Two takes TWO inputs:
 *   - character:  the face/identity to animate (our cast card, an image)
 *   - reference:  a driving video whose motion + expression is transferred
 * The output moves like the reference but wears the character's face — which
 * is exactly "keep the video's performance, swap in this person."
 *
 * Flow (verified against live docs 2026-07-07):
 *   POST /v1/character_performance -> { id }
 *   GET  /v1/tasks/{id} -> { status, output: [url], failure? }
 * Inputs are passed as data: URIs (local dev has no public URL to hand
 * Runway). Runway caps a data URI at 5MB (live error 2026-10-27: "Data URI
 * is too large: 7.2MB exceeds the 5MB limit. Upload the file and pass the
 * returned URI instead") — base64 inflates 4/3, so the FILE must be ≲3.7MB.
 * Act-Two renders 720p anyway: a 720×1280 re-encode of a few seconds fits.
 */

const BASE = "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";
const TASK_ID = /^[\w-]+$/;
const MAX_URI_BYTES = 5_000_000; // data-URI cap, measured on the base64 string

function headers(apiKey: string, json = true): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "x-runway-version": VERSION,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const head = body?.error ?? body?.message ?? `Runway API error (HTTP ${res.status})`;
    // "Validation of body failed" alone is useless — Runway lists the failing
    // fields in `issues` ({path, message}); surface them (2026-10-27).
    const issues = Array.isArray(body?.issues)
      ? body.issues
          .map((i: { path?: unknown; message?: unknown }) =>
            [Array.isArray(i?.path) ? i.path.join(".") : i?.path, i?.message]
              .filter(Boolean)
              .join(": "),
          )
          .filter(Boolean)
          .slice(0, 4)
      : [];
    return issues.length ? `${head} — ${issues.join(" · ")}` : head;
  } catch {
    return `Runway API error (HTTP ${res.status})`;
  }
}

/** base64 length → decoded byte count (4 b64 chars = 3 bytes). */
const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4);

export const runway: VideoProvider = {
  name: "runway",

  async submit(_prompt: string, params: SubmitParams, apiKey: string) {
    if (!params.character || !params.drivingVideo) {
      throw new Error(
        "Act-Two needs both a character (a cast card) and a driving video (attach a reference clip). Pick a face card and attach a video, then send.",
      );
    }
    if (params.drivingVideo.base64.length > MAX_URI_BYTES) {
      throw new Error(
        `Driving video is ${(decodedBytes(params.drivingVideo.base64) / 1e6).toFixed(1)}MB — Runway takes ≲3.7MB inline (5MB data-URI cap). Re-encode to 720×1280 or trim it shorter, then retry.`,
      );
    }

    const ratio = params.aspectRatio === "16:9" ? "1280:720" : "720:1280";
    const res = await fetch(`${BASE}/character_performance`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model: params.modelId || "act_two",
        character: {
          type: "image",
          uri: `data:${params.character.mimeType};base64,${params.character.base64}`,
        },
        reference: {
          type: "video",
          uri: `data:${params.drivingVideo.mimeType};base64,${params.drivingVideo.base64}`,
        },
        ratio,
        bodyControl: true,
        expressionIntensity: 3,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));

    const body = await res.json();
    const id = body?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("Runway did not return a task id");
    }
    return { jobId: id };
  },

  async status(jobId: string, apiKey: string): Promise<JobStatus> {
    if (!TASK_ID.test(jobId)) {
      return { state: "error", error: "Malformed task id" };
    }
    const res = await fetch(`${BASE}/tasks/${jobId}`, {
      headers: headers(apiKey, false),
    });
    if (!res.ok) return { state: "error", error: await readError(res) };

    const task = await res.json();
    const s = task?.status;
    if (s === "SUCCEEDED") {
      const url = Array.isArray(task.output) ? task.output[0] : task.output;
      if (typeof url !== "string" || !url) {
        return { state: "error", error: "Runway finished without an output url" };
      }
      // Runway's CDN output — proxy it so the player is same-origin and
      // snapshot capture works (same treatment as Grok's CDN).
      return {
        state: "done",
        videoUrl: `/api/video?remote=${encodeURIComponent(url)}`,
      };
    }
    if (s === "FAILED") {
      return {
        state: "error",
        error: task.failure ?? task.failureCode ?? "Runway generation failed",
      };
    }
    // PENDING | THROTTLED | RUNNING
    return { state: "pending" };
  },
};
