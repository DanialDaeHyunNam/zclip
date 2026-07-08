import type { ProviderName, AspectRatio, Resolution } from "@/lib/config";

/**
 * One archived clip — a finished take or a GRABbed reference video. The
 * archive (`hooklab.gallery`) is the append-only ledger; this shape is shared
 * by the studio, the archive route, and the shared card component.
 */
export interface Clip {
  jobId: string;
  sessionId?: string;
  /** "grab" marks a reference video pulled with the GRAB tool — archived
   *  alongside takes but excluded from the spend ledger. */
  provider: ProviderName | "grab";
  prompt: string;
  note?: string;
  variantLabel: string;
  createdAt: number;
  status: "done";
  aspectRatio: AspectRatio;
  durationSeconds: number;
  resolution: Resolution;
  videoUrl?: string;
  costUsd?: number;
}

/** Storage keys — the `hooklab.*` prefix predates the ZCLIP rename and is kept
 *  so existing browsers don't lose their data. */
export const GALLERY_KEY = "hooklab.gallery";
export const SESSIONS_KEY = "hooklab.sessions";
export const SESSION_ID_KEY = "hooklab.sessionId";
export const PW_KEY = "hooklab.pw";
/** A clip the archive route hands off to the studio composer as a reference. */
export const PENDING_REF_KEY = "hooklab.pendingRef";

export const fmtCost = (c?: number) => (c != null ? `$${c.toFixed(2)}` : null);

export const cssAspect = (a: AspectRatio) => (a === "16:9" ? "16 / 9" : "9 / 16");
