/**
 * ── SINGLE SWITCHBOARD ────────────────────────────────────────────────
 * All four providers are wired. Pick one in the UI; if its key is
 * missing, the UI shows an inline key panel that (in local dev) writes
 * straight into .env.local. On Vercel, set env vars in the dashboard
 * and redeploy.
 */

export type ProviderName = "veo" | "sora" | "grok" | "seedance" | "runway";
export type AspectRatio = "9:16" | "16:9";
export type Resolution = "720p" | "1080p";

export interface ProviderInfo {
  label: string;
  modelId: string;
  implemented: boolean;
  envVar: string;
  docsUrl: string;
  keyUrl: string;
  adapterFile: string;
  /** USD per second of output by resolution, from the provider's public
   *  pricing page. null = pricing not published clearly (shown as —). */
  costPerSecondUsd: Partial<Record<Resolution, number>> | null;
  /** Provider bills at least this many seconds regardless of request. */
  minSeconds?: number;
  /** Categorical color for the spend chart — set validated as a palette
   *  (OKLCH band, CVD ΔE, contrast on #000); keep the order veo→seedance. */
  chartColor: string;
  /** Short caveat surfaced in the UI. */
  note?: string;

  // ── model-picker display metadata (the rich dropdown) ──
  /** Compact label for the trigger + rows. */
  short: string;
  /** Who makes it — the picker groups nothing by this but shows it inline. */
  company: string;
  /** One line on what it's great at (the pro). */
  tagline: string;
  /** When to reach for it. */
  bestFor: string;
  /** recommended = shown by default; more = behind the "All models" toggle. */
  tier: "recommended" | "more";
  /** 1–3 meters driving the little bars (quality = fidelity, speed = latency). */
  quality: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  /** Act-Two-style models that need a driving video + face, not a prompt. */
  transferOnly?: boolean;
}

/** A not-yet-wired model shown in the picker (disabled) so the landscape and
 *  the "adding one is one file" story are visible. Not a ProviderName. */
export interface ComingSoonModel {
  short: string;
  company: string;
  tagline: string;
  note: string;
}
export const COMING_SOON: ComingSoonModel[] = [
  {
    short: "Kling 2.5",
    company: "Kuaishou",
    tagline: "Strong physical motion, image-to-video",
    note: "Adapter TODO — copy an existing lib/providers/*.ts",
  },
  {
    short: "Luma Ray 3",
    company: "Luma",
    tagline: "Fast, cinematic generation",
    note: "Adapter TODO",
  },
  {
    short: "Hailuo 02",
    company: "MiniMax",
    tagline: "Lifelike i2v, budget-friendly",
    note: "Adapter TODO",
  },
  {
    short: "Pika 2.2",
    company: "Pika",
    tagline: "Effects, transitions, pikaframes",
    note: "Adapter TODO",
  },
];

/** "$0.05/s" style label from the pricing table, or "—". */
export function priceLabel(p: ProviderName): string {
  const c = PROVIDERS[p].costPerSecondUsd;
  if (!c) return "—";
  const v = c["720p"] ?? c["1080p"];
  return v != null ? `$${v.toFixed(2)}/s` : "—";
}

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  veo: {
    label: "Veo 3.1 Fast",
    // Veo 3.0 was shut down 2026-06-30 — 3.1 is the current family.
    modelId: "veo-3.1-fast-generate-preview",
    implemented: true,
    envVar: "GEMINI_API_KEY",
    docsUrl: "https://ai.google.dev/gemini-api/docs/veo",
    keyUrl: "https://aistudio.google.com/apikey",
    adapterFile: "lib/providers/veo.ts",
    costPerSecondUsd: { "720p": 0.1, "1080p": 0.12 },
    chartColor: "#1E9CC9",
    short: "Veo 3.1 Fast",
    company: "Google",
    tagline: "Sharpest realism + native audio",
    bestFor: "Generating a fresh take from a card or text",
    tier: "recommended",
    quality: 3,
    speed: 2,
    note: "No free tier — the API key's project needs billing. Durations 4/6/8s (1080p ⇒ 8s).",
  },
  sora: {
    label: "Sora 2",
    modelId: "sora-2",
    implemented: true,
    envVar: "OPENAI_API_KEY",
    docsUrl: "https://developers.openai.com/api/docs/guides/video-generation",
    keyUrl: "https://platform.openai.com/api-keys",
    adapterFile: "lib/providers/sora.ts",
    costPerSecondUsd: { "720p": 0.1 }, // launch pricing — verify on your account
    minSeconds: 8, // Sora bills 8s even when a shorter take is requested
    chartColor: "#8465DE",
    short: "Sora 2",
    company: "OpenAI",
    tagline: "Cinematic motion & coherence",
    bestFor: "Longer, story-like takes",
    tier: "more",
    quality: 3,
    speed: 1,
    note: "Visible watermark. Minimum 8s per clip; 720p only (1080p needs sora-2-pro).",
  },
  grok: {
    label: "Grok Imagine",
    modelId: "grok-imagine-video-1.5",
    implemented: true,
    envVar: "XAI_API_KEY",
    docsUrl: "https://docs.x.ai/docs/guides/video-generations",
    keyUrl: "https://console.x.ai/",
    adapterFile: "lib/providers/grok.ts",
    costPerSecondUsd: { "720p": 0.08, "1080p": 0.08 }, // $0.08/s flat (docs.x.ai pricing)
    chartColor: "#BF7A22",
    short: "Grok Imagine",
    company: "xAI",
    tagline: "Cheapest, fast, flexible 1–15s",
    bestFor: "Quick iterations & cheap A/B",
    tier: "recommended",
    quality: 2,
    speed: 3,
    note: "First-frame i2v — animates a still, does NOT follow a source video's motion. Text-only adds a $0.05 image step.",
  },
  seedance: {
    label: "Seedance 1.0 Pro",
    modelId: "seedance-1-0-pro-250528",
    implemented: true,
    envVar: "ARK_API_KEY",
    docsUrl: "https://docs.byteplus.com/en/docs/ModelArk/",
    keyUrl: "https://console.byteplus.com/",
    adapterFile: "lib/providers/seedance.ts",
    costPerSecondUsd: null,
    chartColor: "#3AA468",
    short: "Seedance Pro",
    company: "ByteDance",
    tagline: "Budget i2v (unverified)",
    bestFor: "Experimenting once wired",
    tier: "more",
    quality: 2,
    speed: 2,
    note: "Endpoint/model id built from BytePlus ModelArk docs — verify on first run.",
  },
  runway: {
    label: "Runway Act-Two",
    // True performance transfer: a driving video's motion+expression is
    // mapped onto a character image. The ONLY model here that actually
    // follows a reference video's movement (the others are first-frame i2v).
    modelId: "act_two",
    implemented: true,
    envVar: "RUNWAYML_API_SECRET",
    docsUrl: "https://docs.dev.runwayml.com/guides/generate-video/",
    keyUrl: "https://dev.runwayml.com/",
    adapterFile: "lib/providers/runway.ts",
    costPerSecondUsd: { "720p": 0.05, "1080p": 0.05 }, // 5 credits/s × $0.01
    chartColor: "#C2477E",
    short: "Act-Two",
    company: "Runway",
    tagline: "TRUE performance transfer — motion from a video onto your face",
    bestFor: "Reaction hooks driven by a reference clip",
    tier: "recommended",
    quality: 3,
    speed: 2,
    transferOnly: true,
    note: "TRANSFER-ONLY: needs a driving video (the motion) + a character card (the face). No text prompt. Needs a Runway key (Standard plan+).",
  },
};

export const DEFAULT_PROVIDER: ProviderName = "veo";

/** Text model used by /api/refine to rewrite prompts conversationally.
 *  Uses the same GEMINI_API_KEY; flash-tier text is near-free. */
export const REFINER_MODEL_ID = "gemini-2.5-flash";

/** Env vars the in-UI key panel may write (local dev only). */
export const KEY_ENV_VARS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "ARK_API_KEY",
  "RUNWAYML_API_SECRET",
] as const;

/** Whitelists — the API routes validate against these, never raw client input. */
export const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9"];
export const DURATION_MIN = 1;
export const DURATION_MAX = 15;
/** Preset choices shown in the UI (server still accepts 1–15). */
export const DURATION_CHOICES = [4, 8, 12];
export const RESOLUTIONS: Resolution[] = ["720p", "1080p"];

/** The slider is a REQUEST; providers only bill/support certain lengths.
 *  Veo: 4|6|8 (1080p ⇒ 8) · Sora: 8 minimum (we send 8) · Grok/Seedance:
 *  free 1–15. This is the single source of truth for snap + billing. */
export function effectiveSeconds(
  provider: ProviderName,
  requested: number,
  resolution: Resolution,
): number {
  const r = Math.round(Math.min(DURATION_MAX, Math.max(DURATION_MIN, requested)));
  if (provider === "veo") {
    if (resolution !== "720p") return 8;
    return r <= 5 ? 4 : r <= 7 ? 6 : 8;
  }
  if (provider === "sora") return 8;
  // Act-Two's output length = the driving video's length; the caller passes
  // the reference clip's duration through as `requested`.
  return r;
}

export const DEFAULTS = {
  aspectRatio: "9:16" as AspectRatio,
  durationSeconds: 4, // UI targets a 3s beat; Veo's minimum is 4s
  resolution: "720p" as Resolution,
};

export function estimateCostUsd(
  provider: ProviderName,
  resolution: Resolution,
  durationSeconds: number,
): number | null {
  const info = PROVIDERS[provider];
  const rate = info.costPerSecondUsd?.[resolution];
  if (rate == null) return null;
  // Billed at what the provider actually renders, not the raw request.
  return (
    rate *
    Math.max(
      effectiveSeconds(provider, durationSeconds, resolution),
      info.minSeconds ?? 0,
    )
  );
}
