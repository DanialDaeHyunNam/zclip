export interface SubmitParams {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  /** Specific model id to run (a provider can host several). Defaults to the
   *  adapter's PROVIDERS[...].modelId when absent. */
  modelId?: string;
  /** Optional visual reference (drag-dropped in the UI, downscaled
   *  client-side). Each adapter maps it to its provider's image mode. */
  image?: { base64: string; mimeType: string };
  /** Multiple identity references (Seedance 2.0 reference-to-video: one
   *  per person in a multi-subject reference video). When present with a
   *  drivingVideo, each rides as a role:"reference_image" content item, in
   *  order. Adapters that take a single image ignore this. */
  images?: { base64: string; mimeType: string }[];
  /** Performance-transfer inputs (Runway Act-Two only). `character` is the
   *  face/identity to animate; `drivingVideo` is the motion source whose
   *  performance is mapped onto that face. */
  character?: { base64: string; mimeType: string };
  drivingVideo?: { base64: string; mimeType: string };
}

export type JobState = "pending" | "done" | "error";

export interface JobStatus {
  state: JobState;
  /** Same-origin proxied URL the <video> tag can play directly. */
  videoUrl?: string;
  /** Estimated USD cost of the finished clip, when knowable. */
  costUsd?: number;
  error?: string;
}

export interface VideoProvider {
  name: string;
  /** Kick off generation; must return fast (the job runs async provider-side).
   *  `apiKey` arrives per request (header on hosted, env fallback locally —
   *  lib/server-keys.ts). Adapters never read provider keys from process.env,
   *  and the key must never leak into error messages or logs. */
  submit(prompt: string, params: SubmitParams, apiKey: string): Promise<{ jobId: string }>;
  /** One cheap poll of provider state; never blocks until completion. */
  status(jobId: string, apiKey: string): Promise<JobStatus>;
}
