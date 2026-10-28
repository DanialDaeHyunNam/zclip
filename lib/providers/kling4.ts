import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * Kling 4.0 via fal's queue API (released 2026-10-15; fal API public
 * 2026-10-23). Two endpoints, picked by what's attached:
 *   - image only        → kling/v4/image-to-video  { start_image_url, prompt, duration, resolution }
 *   - image + clip      → kling/v4/reference-to-video
 *                         { prompt, image_urls, video_urls, duration, resolution, aspect_ratio }
 * Schema from fal.ai/models/kling/v4/{image,reference}-to-video/api (read
 * 2026-10-27). Base64 data URIs are accepted for file inputs ("You can pass
 * a Base64 data URI as a file input") — so the owner's raw acting clip goes
 * to fal only, never through the public temp host the Lucy path uses.
 *
 * Why Kling 4.0 for hyperreal UGC (research 2026-10-27, lab/HYPERREAL.md):
 * best micro-expressions in one Oct-20 head-to-head, takes AI photoreal
 * portraits, and reference-to-video treats a clip as a REFERENCE — "Reference
 * @Video1" generates (the character's own face/mouth) vs "Edit @Video1"
 * edits. Owner direction after Act-Two's "monster" run: the acting is a
 * reference for timing/head turns/emotion, never a face/mouth transfer.
 *
 * Pricing (fal page): 720p $0.157/s, 1080p $0.235/s (default 1080p — we
 * always send the UI's resolution). A video reference bills $0.094/s (720p)
 * on input + output length instead — the UI estimate uses $0.157/s × output.
 *
 * Queue (fal convention, as lucy.ts): POST queue.fal.run/<endpoint> →
 * { request_id }; status/result live under the APP base `kling/v4`.
 */

const QUEUE = "https://queue.fal.run";
const APP = "kling/v4";
const ID = /^[\w-]+$/;

const dataUri = (f: { base64: string; mimeType: string }) =>
  `data:${f.mimeType};base64,${f.base64}`;

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    const detail = Array.isArray(b?.detail)
      ? b.detail
          .map((d: { msg?: string; loc?: unknown[] }) =>
            [Array.isArray(d?.loc) ? d.loc.join(".") : "", d?.msg ?? ""].filter(Boolean).join(": "),
          )
          .join("; ")
      : (b?.detail ?? b?.error ?? b?.message);
    return detail || `Kling 4.0 (fal) error (HTTP ${res.status})`;
  } catch {
    return `Kling 4.0 (fal) error (HTTP ${res.status})`;
  }
}

/** The clip is a REFERENCE for timing / head movement / emotion only — the
 *  face, mouth and expressions are generated for the person in @Image1. */
const referencePrompt = (prompt: string) =>
  "@Image1 is the person to show: keep their face, hair, makeup, outfit and setting exactly as in @Image1. " +
  "Reference @Video1 only for timing, head movement, gaze and the emotion of the performance. " +
  "Do not copy the person in @Video1; generate this person's own natural mouth movements and facial expressions. " +
  prompt;

export const kling4: VideoProvider = {
  name: "kling4",

  async submit(prompt: string, params: SubmitParams, apiKey: string) {
    const face = params.image ?? params.character;
    if (!face) {
      throw new Error(
        "Kling 4.0 here animates a look — pick a Character card (or attach an image) first.",
      );
    }
    const duration = Math.min(15, Math.max(3, Math.round(params.durationSeconds || 5)));
    const resolution = params.resolution === "1080p" ? "1080p" : "720p";
    const ref = params.drivingVideo;
    const endpoint = ref ? `${APP}/reference-to-video` : `${APP}/image-to-video`;
    const body = ref
      ? {
          prompt: referencePrompt(prompt),
          image_urls: [dataUri(face)],
          video_urls: [dataUri(ref)],
          duration,
          resolution,
          aspect_ratio: params.aspectRatio === "16:9" ? "16:9" : "9:16",
        }
      : {
          prompt,
          start_image_url: dataUri(face),
          duration,
          resolution,
        };
    const res = await fetch(`${QUEUE}/${endpoint}`, {
      method: "POST",
      headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { request_id } = await res.json();
    if (typeof request_id !== "string" || !request_id) {
      throw new Error("Kling 4.0 (fal) did not return a request id");
    }
    return { jobId: request_id };
  },

  async status(jobId: string, apiKey: string): Promise<JobStatus> {
    if (!ID.test(jobId)) return { state: "error", error: "Malformed job id" };
    const headers = { authorization: `Key ${apiKey}` };
    const st = await fetch(`${QUEUE}/${APP}/requests/${jobId}/status`, { headers });
    if (!st.ok) return { state: "error", error: await readError(st) };
    const s = await st.json();
    if (s.status === "IN_QUEUE" || s.status === "IN_PROGRESS") return { state: "pending" };
    if (s.status === "COMPLETED") {
      const rs = await fetch(`${QUEUE}/${APP}/requests/${jobId}`, { headers });
      if (!rs.ok) return { state: "error", error: await readError(rs) };
      const out = await rs.json();
      const url = out?.video?.url;
      if (typeof url !== "string" || !url) {
        return { state: "error", error: "Kling 4.0 finished without a video url" };
      }
      return { state: "done", videoUrl: url };
    }
    return {
      state: "error",
      error: typeof s.error === "string" ? s.error : `Kling 4.0 status: ${s.status ?? "unknown"}`,
    };
  },
};
