/**
 * ── SINGLE SWITCHBOARD ────────────────────────────────────────────────
 * All four providers are wired. Pick one in the UI; if its key is
 * missing, the UI shows an inline key panel that (in local dev) writes
 * straight into .env.local. On Vercel, set env vars in the dashboard
 * and redeploy.
 */

export type ProviderName =
  | "veo"
  | "sora"
  | "grok"
  | "seedance"
  | "runway"
  | "kling"
  | "lucy";
export type AspectRatio = "9:16" | "16:9";
export type Resolution = "720p" | "1080p";

export interface ProviderInfo {
  label: string;
  modelId: string;
  implemented: boolean;
  envVar: string;
  docsUrl: string;
  keyUrl: string;
  /** The provider's billing/usage console — where the REAL charge shows up.
   *  In-app costs are per-second estimates; no provider reports a live billed
   *  total, so the spend UI links here to verify actual usage. */
  dashboardUrl: string;
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

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  veo: {
    label: "Veo 3.1 Fast",
    // Veo 3.0 was shut down 2026-06-30 — 3.1 is the current family.
    modelId: "veo-3.1-fast-generate-preview",
    implemented: true,
    envVar: "GEMINI_API_KEY",
    docsUrl: "https://ai.google.dev/gemini-api/docs/veo",
    keyUrl: "https://aistudio.google.com/apikey",
    dashboardUrl: "https://aistudio.google.com/usage",
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
    dashboardUrl: "https://platform.openai.com/usage",
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
    dashboardUrl: "https://console.x.ai/",
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
    dashboardUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement",
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
    dashboardUrl: "https://dev.runwayml.com/organization/usage",
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
  kling: {
    label: "Kling 3.0",
    modelId: "kling-v3",
    implemented: true,
    envVar: "KLING_API_KEY", // "ACCESS_KEY:SECRET_KEY" — adapter builds the JWT
    docsUrl: "https://kling.ai/document-api/apiReference/model/imageToVideo",
    keyUrl: "https://kling.ai/dev",
    dashboardUrl: "https://app.klingai.com/global/dev/resource",
    adapterFile: "lib/providers/kling.ts",
    // ~6cr/s 720p, ~8cr/s 1080p at ≈$0.004/credit (2026-07 API pricing) —
    // estimates until a real billed run confirms.
    costPerSecondUsd: { "720p": 0.024, "1080p": 0.032 },
    chartColor: "#9DB13F", // added 2026-07-13 — re-validate the palette set
    short: "Kling 3.0",
    company: "Kuaishou",
    tagline: "Fluid natural motion i2v — the market's 'make it move' step",
    bestFor: "Animating a confirmed still (Flow step 2)",
    tier: "recommended",
    quality: 3,
    speed: 2,
    note: "UNVERIFIED — adapter built from Kling API docs 2026-07-13; verify on first real run. Key format ACCESS_KEY:SECRET_KEY (needs the separate API plan, not the consumer sub). Durations snap to 5/10s.",
  },
  lucy: {
    label: "Lucy Edit Pro",
    // Decart's text-guided VIDEO-TO-VIDEO restyle via fal's queue API — the
    // raw clip drives (motion/camera/timing free), the prompt says what to
    // become. Powers the restyle flow (Video → Image), not i2v.
    modelId: "decart/lucy-edit/pro",
    implemented: true,
    envVar: "FAL_KEY",
    docsUrl: "https://fal.ai/models/decart/lucy-edit/pro",
    keyUrl: "https://fal.ai/dashboard/keys",
    dashboardUrl: "https://fal.ai/dashboard/usage",
    adapterFile: "lib/providers/lucy.ts",
    // fal published pricing 2026-07-19: $0.15/s @720p (Pro is the only
    // active offline endpoint — fast/dev deprecated; Lucy 2.5 $0.04/s is
    // realtime-WebRTC only). Output is 720p regardless of the res knob.
    costPerSecondUsd: { "720p": 0.15, "1080p": 0.15 },
    chartColor: "#3FBFAF", // added 2026-07-19 — re-validate the palette set
    short: "Lucy Edit",
    company: "Decart",
    tagline: "Restyle a real clip in place — motion, camera and timing come free",
    bestFor: "Turning the dancer into your character without rebuilding the scene",
    tier: "recommended",
    quality: 3,
    speed: 2,
    transferOnly: true,
    note: "Video-to-video ONLY (the source clip drives everything). fal queue shapes from docs 2026-07-19 — verify on first real run. The RAW clip is uploaded to a temp host; unlike Seedance there is no real-person filter to dodge.",
  },
};

export const DEFAULT_PROVIDER: ProviderName = "veo";

/* ── MODEL CATALOG ────────────────────────────────────────────────────
 * The picker shops MODELS, not PROVIDERS. Several models can ride ONE
 * adapter (a `provider`) with a different `modelId` — that's how "Google
 * has more than Veo 3.1 Fast" works without a new adapter each time.
 * The 5 real entries reuse their provider's display fields; variants and
 * not-yet-wired models are listed so the picker feels like a marketplace.
 */
export interface ModelEntry {
  key: string; // unique picker id (= ProviderName for each default model)
  short: string;
  company: string;
  provider: ProviderName; // which adapter runs it
  modelId: string; // the id handed to that adapter
  envVar: string;
  pricePerSecUsd: Partial<Record<Resolution, number>> | null;
  quality: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  tagline: string;
  transferOnly?: boolean;
  recommended?: boolean;
  implemented: boolean;
  /** The default/headline model for its company — shown before "All models". */
  primary?: boolean;
}

/** Build a catalog entry for a provider's DEFAULT (headline) model. */
function defaultModel(p: ProviderName): ModelEntry {
  const i = PROVIDERS[p];
  return {
    key: p,
    short: i.short,
    company: i.company,
    provider: p,
    modelId: i.modelId,
    envVar: i.envVar,
    pricePerSecUsd: i.costPerSecondUsd,
    quality: i.quality,
    speed: i.speed,
    tagline: i.tagline,
    transferOnly: i.transferOnly,
    recommended: i.tier === "recommended",
    implemented: i.implemented,
    primary: true,
  };
}

/** A REAL variant that rides the same adapter with a different modelId.
 *  Only wired, working models live here — no placeholders. */
function variant(v: {
  key: string;
  short: string;
  provider: ProviderName;
  modelId: string;
  tagline: string;
  price: Partial<Record<Resolution, number>> | null;
  quality: 1 | 2 | 3;
  speed: 1 | 2 | 3;
}): ModelEntry {
  return {
    key: v.key,
    short: v.short,
    company: PROVIDERS[v.provider].company,
    provider: v.provider,
    modelId: v.modelId,
    envVar: PROVIDERS[v.provider].envVar,
    pricePerSecUsd: v.price,
    quality: v.quality,
    speed: v.speed,
    tagline: v.tagline,
    implemented: true,
  };
}

export const MODELS: ModelEntry[] = [
  // Google — one adapter (veo.ts), three real model ids
  defaultModel("veo"),
  variant({
    key: "veo-3.1",
    short: "Veo 3.1",
    provider: "veo",
    modelId: "veo-3.1-generate-preview",
    tagline: "Higher fidelity, 4K, native audio",
    price: { "720p": 0.2, "1080p": 0.4 }, // premium tier (estimate)
    quality: 3,
    speed: 1,
  }),
  variant({
    key: "veo-3.1-lite",
    short: "Veo 3.1 Lite",
    provider: "veo",
    modelId: "veo-3.1-lite-generate-preview",
    tagline: "Cheapest Veo — high-volume iteration",
    price: { "720p": 0.04 }, // <50% of Fast, per Google
    quality: 2,
    speed: 3,
  }),
  // OpenAI
  defaultModel("sora"),
  variant({
    key: "sora-2-pro",
    short: "Sora 2 Pro",
    provider: "sora",
    modelId: "sora-2-pro",
    tagline: "1080p, higher fidelity",
    price: { "720p": 0.3, "1080p": 0.5 },
    quality: 3,
    speed: 1,
  }),
  // xAI
  defaultModel("grok"),
  // Runway
  defaultModel("runway"),
  // Kuaishou
  defaultModel("kling"),
  // Decart (fal)
  defaultModel("lucy"),
  // ByteDance
  defaultModel("seedance"),
  variant({
    key: "seedance-2",
    short: "Seedance 2.0",
    provider: "seedance",
    modelId: "dreamina-seedance-2-0-260128",
    tagline: "Reads the whole reference video + audio; sound in output",
    // ModelArk token rate (with video input): $2.4/M @720p, $4.7/M @1080p
    // (owner-read pricing 2026-07-15). Per-second is a rough derived est.
    price: { "720p": 0.1, "1080p": 0.22 },
    quality: 3,
    speed: 1,
  }),
  variant({
    key: "seedance-2-fast",
    short: "Seedance 2.0 Fast",
    provider: "seedance",
    modelId: "dreamina-seedance-2-0-fast-260128",
    tagline: "Faster clip-reader for iteration — finish on 2.0",
    // Between mini and standard — token rate unconfirmed, per-second est.
    price: { "720p": 0.09, "1080p": 0.16 },
    quality: 2,
    speed: 2,
  }),
  variant({
    key: "seedance-2-mini",
    short: "Seedance 2.0 Mini",
    provider: "seedance",
    modelId: "dreamina-seedance-2-0-mini-260615",
    tagline: "Cheapest clip-reader — flat token rate, biggest saving at 1080p",
    // ModelArk token rate (with video input): $2.1/M FLAT (owner-read
    // 2026-07-15) — ~12% under standard @720p, ~55% under @1080p.
    price: { "720p": 0.09, "1080p": 0.1 },
    quality: 1,
    speed: 3,
  }),
];

/** Seedance 2.0 family — the models that READ a reference clip
 *  (reference-to-video). Gates transfer flows, SPEC keep/bypass, the
 *  continuity skip, and the reference_image+reference_video pairing. */
export const readsClip = (modelKey: string): boolean =>
  modelKey.startsWith("seedance-2");

/** Lucy-family v2v restylers — the models behind the RESTYLE flow
 *  (Video → Image): the raw clip drives, the prompt says what to become. */
export const restylesClip = (modelKey: string): boolean =>
  modelKey.startsWith("lucy");

/** Company chips, in the order they appear (companies with ≥1 model). */
export const COMPANIES: string[] = MODELS.reduce<string[]>((acc, m) => {
  if (!acc.includes(m.company)) acc.push(m.company);
  return acc;
}, []);

export function resolveModel(key: string): ModelEntry {
  return MODELS.find((m) => m.key === key) ?? defaultModel(DEFAULT_PROVIDER);
}

/** "$0.05/s" from a model's pricing, or "—". */
export function modelPriceLabel(m: ModelEntry): string {
  const c = m.pricePerSecUsd;
  if (!c) return "—";
  const v = c["720p"] ?? c["1080p"];
  return v != null ? `$${v.toFixed(2)}/s` : "—";
}

export const DEFAULT_MODEL_KEY = DEFAULT_PROVIDER;

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
  "KLING_API_KEY",
  "FAL_KEY",
] as const;

/** Whitelists — the API routes validate against these, never raw client input. */
export const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9"];
export const DURATION_MIN = 1;
export const DURATION_MAX = 15;
/** Preset choices shown in the UI (server still accepts 1–15). */
/** All values must be Seedance-2.0-legal (4|5|6|8|10|12|15 — it rejects
 *  in-between lengths); 15 is its single-shot ceiling. */
export const DURATION_CHOICES = [4, 8, 12, 15];
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
  if (provider === "kling") return r <= 7 ? 5 : 10; // API grid: 5s or 10s
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

/** Per-model cost — uses the model's own pricing (a variant can cost more
 *  than its provider's default) but the provider's duration/min rules. */
export function estimateModelCost(
  m: ModelEntry,
  resolution: Resolution,
  durationSeconds: number,
): number | null {
  const rate = m.pricePerSecUsd?.[resolution];
  if (rate == null) return null;
  return (
    rate *
    Math.max(
      effectiveSeconds(m.provider, durationSeconds, resolution),
      PROVIDERS[m.provider].minSeconds ?? 0,
    )
  );
}
