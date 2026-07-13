import { createHmac } from "node:crypto";
import { PROVIDERS } from "@/lib/config";
import type { VideoProvider, SubmitParams, JobStatus } from "./types";

/**
 * Kling (Kuaishou) video API — UNVERIFIED, built from the public API docs
 * 2026-07-13 (api-singapore.klingai.com, JWT auth, i2v + t2v). Verify on
 * the first real run, like the Seedance precedent.
 *
 * Auth: KLING_API_KEY = "ACCESS_KEY:SECRET_KEY". Each request signs a
 * short-lived HS256 JWT (iss = access key, 30min exp) — Kling has no
 * static bearer tokens. Note: API access is a separate plan from the
 * consumer subscription.
 *
 * jobId format: "<endpoint>:<task_id>" — the status poll must hit the
 * same resource path the task was created on (i2v vs t2v).
 */

const BASE = "https://api-singapore.klingai.com";
const TASK_ID = /^[\w-]+$/;

function jwt(): string {
  const raw = process.env.KLING_API_KEY;
  if (!raw || !raw.includes(":")) {
    throw new Error(
      "KLING_API_KEY is not set (format ACCESS_KEY:SECRET_KEY) — add it in the UI key panel",
    );
  }
  const [ak, sk] = raw.split(":", 2);
  const b64url = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({ iss: ak, exp: now + 1800, nbf: now - 5 });
  const sig = createHmac("sha256", sk)
    .update(`${head}.${payload}`)
    .digest("base64url");
  return `${head}.${payload}.${sig}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.message ?? body?.error ?? `Kling API error (HTTP ${res.status})`;
  } catch {
    return `Kling API error (HTTP ${res.status})`;
  }
}

/** Kling's duration grid is "5" | "10" (strings, per docs). */
const snapSeconds = (s: number): "5" | "10" => (s <= 7 ? "5" : "10");

export const kling: VideoProvider = {
  name: "kling",

  async submit(prompt: string, params: SubmitParams) {
    const headers = {
      authorization: `Bearer ${jwt()}`,
      "content-type": "application/json",
    };
    const modelName = params.modelId || PROVIDERS.kling.modelId;
    const duration = snapSeconds(params.durationSeconds);

    // Image attached ⇒ image2video (the Flow "make it move" step);
    // text-only ⇒ text2video with an explicit aspect ratio.
    const endpoint = params.image ? "image2video" : "text2video";
    const body: Record<string, unknown> = {
      model_name: modelName,
      prompt,
      duration,
      mode: "pro",
    };
    if (params.image) {
      body.image = params.image.base64; // raw base64, no data: prefix (docs)
    } else {
      body.aspect_ratio = params.aspectRatio;
    }

    const res = await fetch(`${BASE}/v1/videos/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    const taskId = data?.data?.task_id;
    if (typeof taskId !== "string" || !TASK_ID.test(taskId)) {
      throw new Error("Kling returned no task id");
    }
    return { jobId: `${endpoint}:${taskId}` };
  },

  async status(jobId: string): Promise<JobStatus> {
    const [endpoint, taskId] = jobId.split(":", 2);
    if (!taskId || !TASK_ID.test(taskId)) {
      return { state: "error", error: "Bad Kling job id" };
    }
    const res = await fetch(`${BASE}/v1/videos/${endpoint}/${taskId}`, {
      headers: { authorization: `Bearer ${jwt()}` },
    });
    if (!res.ok) return { state: "error", error: await readError(res) };
    const data = (await res.json())?.data;
    const s = data?.task_status;
    if (s === "failed") {
      return {
        state: "error",
        error: data?.task_status_msg ?? "Kling render failed",
      };
    }
    const url = data?.task_result?.videos?.[0]?.url;
    if (s === "succeed" && typeof url === "string" && url) {
      // Kling serves public (time-limited) CDN URLs — browser-playable
      // directly, same pattern as Grok/Seedance. Vault promptly.
      return { state: "done", videoUrl: url };
    }
    return { state: "pending" };
  },
};
