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
  /** Method the take came from ("Chat" / "Flow" / a preset name / "Reference"). */
  variantLabel: string;
  /** The ACTUAL model's short label (e.g. "Seedance 2.0 Mini"). A provider hosts
   *  several models, so this — not PROVIDERS[provider].label — is the truth. */
  modelLabel?: string;
  createdAt: number;
  status: "done";
  aspectRatio: AspectRatio;
  durationSeconds: number;
  resolution: Resolution;
  videoUrl?: string;
  /** The original provider URL, kept once videoUrl is swapped to the local
   *  clip-vault copy (provenance; the local file is what actually plays). */
  remoteUrl?: string;
  costUsd?: number;
}

/** Local, non-expiring video sources: the clip vault and GRAB files. Anything
 *  else — absolute provider URLs and /api/video proxies of them — dies when
 *  the provider's signed link expires (typically within a day or two). */
export const isLocalVideoUrl = (url?: string) =>
  Boolean(url && (url.startsWith("/api/clips") || url.startsWith("/api/grab")));

/** Storage keys — the `hooklab.*` prefix predates the ZCLIP rename and is kept
 *  so existing browsers don't lose their data. */
export const GALLERY_KEY = "hooklab.gallery";
export const SESSIONS_KEY = "hooklab.sessions";
export const SESSION_ID_KEY = "hooklab.sessionId";
export const PW_KEY = "hooklab.pw";
/** A clip the archive route hands off to the studio composer as a reference. */
export const PENDING_REF_KEY = "hooklab.pendingRef";
/** A depth clip the /depth tool hands off to the studio (plain localStorage,
 *  NOT the file store — a second tab must never write the store cache, its
 *  full-payload flush would clobber the studio tab's writes). The studio tab
 *  adopts it on focus: Library entry + the flow's MOVES reference. */
export const PENDING_DEPTH_KEY = "hooklab.pendingDepthClip";

export const fmtCost = (c?: number) => (c != null ? `$${c.toFixed(2)}` : null);

export const cssAspect = (a: AspectRatio) => (a === "16:9" ? "16 / 9" : "9 / 16");
