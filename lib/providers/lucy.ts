import { hostTempRef } from "@/lib/ref-host";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * Decart Lucy Edit (Pro) via fal.ai's queue API — text-guided VIDEO-TO-VIDEO
 * restyling. The opposite philosophy from the depth→Seedance path: the raw
 * clip IS the driver (motion, camera, timing come free) and the prompt says
 * what to change ("turn the dancer into …"). Decart's product openly edits
 * real people (self-transformation is its demo), so no depth pass and no
 * real-person filter dance here — the RAW clip uploads to the temp host.
 *
 * fal queue convention (docs 2026-07-19, shapes UNVERIFIED until the first
 * real run — a reject surfaces loudly and bills nothing):
 *   POST https://queue.fal.run/decart/lucy-edit/pro
 *        { prompt, video_url, resolution:"720p", enhance_prompt:true }
 *        → { request_id }
 *   GET  https://queue.fal.run/decart/lucy-edit/requests/{id}/status
 *        → { status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED" }  (or an error)
 *   GET  https://queue.fal.run/decart/lucy-edit/requests/{id}
 *        → { video: { url } }
 *   Auth: Authorization: Key <FAL_KEY>
 * Note: requests/* paths use the APP base (decart/lucy-edit) WITHOUT the
 * /pro subpath — fal's documented queue convention for nested endpoints.
 * (lucy-edit fast/dev are deprecated on fal; PRO is the active offline
 * v2v. Lucy 2.5's $0.04/s endpoint is realtime-WebRTC only.)
 */

const QUEUE = "https://queue.fal.run";
const APP = "decart/lucy-edit";
const ID = /^[\w-]+$/;

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    const detail = Array.isArray(b?.detail)
      ? b.detail.map((d: { msg?: string }) => d?.msg ?? "").join("; ")
      : (b?.detail ?? b?.error ?? b?.message);
    return detail || `Lucy API error (HTTP ${res.status})`;
  } catch {
    return `Lucy API error (HTTP ${res.status})`;
  }
}

export const lucy: VideoProvider = {
  name: "lucy",

  async submit(prompt: string, params: SubmitParams, apiKey: string) {
    if (!params.drivingVideo) {
      throw new Error("Lucy Edit is video-to-video — pick a source clip first");
    }
    const videoUrl = await hostTempRef(
      Buffer.from(params.drivingVideo.base64, "base64"),
      params.drivingVideo.mimeType,
    );
    const res = await fetch(`${QUEUE}/${params.modelId || `${APP}/pro`}`, {
      method: "POST",
      headers: {
        authorization: `Key ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        video_url: videoUrl,
        resolution: "720p",
        enhance_prompt: true,
        sync_mode: false,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { request_id } = await res.json();
    if (typeof request_id !== "string" || !request_id) {
      throw new Error("Lucy did not return a request id");
    }
    return { jobId: request_id };
  },

  async status(jobId: string, apiKey: string): Promise<JobStatus> {
    if (!ID.test(jobId)) return { state: "error", error: "Malformed job id" };
    const headers = { authorization: `Key ${apiKey}` };
    const st = await fetch(`${QUEUE}/${APP}/requests/${jobId}/status`, { headers });
    if (!st.ok) return { state: "error", error: await readError(st) };
    const s = await st.json();
    if (s.status === "COMPLETED") {
      const rs = await fetch(`${QUEUE}/${APP}/requests/${jobId}`, { headers });
      if (!rs.ok) return { state: "error", error: await readError(rs) };
      const body = await rs.json();
      const url = body?.video?.url;
      if (typeof url !== "string" || !url) {
        return { state: "error", error: "Lucy finished without a video url" };
      }
      return { state: "done", videoUrl: url };
    }
    if (s.status === "IN_QUEUE" || s.status === "IN_PROGRESS") {
      return { state: "pending" };
    }
    return {
      state: "error",
      error: typeof s.error === "string" ? s.error : `Lucy status: ${s.status ?? "unknown"}`,
    };
  },
};
