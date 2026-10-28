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
  /** Where costUsd came from: the provider's bill ("billed"), exact units ×
   *  the published price ("units"), or the studio's seconds × rate ("est" /
   *  absent). /api/billing upgrades it after the take finishes. */
  costSource?: "billed" | "units" | "est";
  /** The studio's own estimate, kept once the bill replaces costUsd — the
   *  billed / estimate ratio calibrates the next quote. */
  estUsd?: number;
  /** Billing lookups tried so far (stops at a cap) + why it stopped. */
  billingTries?: number;
  billingNote?: string;
}

/** Local, non-expiring video sources: the clip vault and GRAB files. Anything
 *  else — absolute provider URLs and /api/video proxies of them — dies when
 *  the provider's signed link expires (typically within a day or two). */
export const isLocalVideoUrl = (url?: string) =>
  Boolean(url && (url.startsWith("/api/clips") || url.startsWith("/api/grab")));

/** Storage keys — the `hooklab.*` prefix predates the ZCLIP rename and is kept
 *  so existing browsers don't lose their data. */
export const GALLERY_KEY = "hooklab.gallery";
/** Fired after the flow panel writes the gallery. The studio holds the
 *  gallery in state and rewrites it whole (bills, vault) — without this it
 *  never saw a flow take, so never billed it, and its next write could drop
 *  it (2026-10-28). */
export const GALLERY_EVENT = "zclip:gallery";
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
/** Dashboard "Match again" → the studio re-asks every provider for every
 *  take not yet matched to a bill, whatever its age (plain localStorage for
 *  the same one-writer reason as PENDING_DEPTH_KEY). Value = request time;
 *  REBILL_DONE_KEY = the last request the studio handled. */
export const REBILL_KEY = "zclip.rebillAt";
export const REBILL_DONE_KEY = "zclip.rebillDone";
/** Providers /api/billing can match with a bill (lib/billing.ts). */
export const BILLABLE_PROVIDERS = new Set(["grok", "runway", "seedance", "kling", "kling4", "lucy"]);

export const fmtCost = (c?: number) => (c != null ? `$${c.toFixed(2)}` : null);

export const cssAspect = (a: AspectRatio) => (a === "16:9" ? "16 / 9" : "9 / 16");
