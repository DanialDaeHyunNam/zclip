/**
 * ── SINGLE SWITCHBOARD ────────────────────────────────────────────────
 * All four providers are wired. Pick one in the UI; if its key is
 * missing, the UI shows an inline key panel that (in local dev) writes
 * straight into .env.local. On Vercel, set env vars in the dashboard
 * and redeploy.
 */

export type ProviderName = "veo" | "sora" | "grok" | "seedance";
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
    note: "Output carries a visible watermark. Minimum 8s per clip; 720p only (1080p needs sora-2-pro in lib/config.ts).",
  },
  grok: {
    label: "Grok Imagine",
    modelId: "grok-imagine-video-1.5",
    implemented: true,
    envVar: "XAI_API_KEY",
    docsUrl: "https://docs.x.ai/docs/guides/video-generations",
    keyUrl: "https://console.x.ai/",
    adapterFile: "lib/providers/grok.ts",
    costPerSecondUsd: null,
    chartColor: "#BF7A22",
    note: "xAI has no direct text-to-video — runs text→image→video (two billed steps). Aspect follows the prompt text.",
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
    note: "Endpoint/model id built from BytePlus ModelArk docs — verify on first run.",
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
