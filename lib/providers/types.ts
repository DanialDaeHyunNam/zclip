export interface SubmitParams {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  /** Optional visual reference (drag-dropped in the UI, downscaled
   *  client-side). Each adapter maps it to its provider's image mode. */
  image?: { base64: string; mimeType: string };
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
  /** Kick off generation; must return fast (the job runs async provider-side). */
  submit(prompt: string, params: SubmitParams): Promise<{ jobId: string }>;
  /** One cheap poll of provider state; never blocks until completion. */
  status(jobId: string): Promise<JobStatus>;
}
