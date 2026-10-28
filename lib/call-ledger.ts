/**
 * The spend ledger for everything that ISN'T a video take — stills (look
 * cards, edits, outfit swaps) and text calls (describe, refine, title,
 * spec-check, CUT scripts) — plus the one fact a video bill needs that only
 * the submit knows (did a reference video ride along to Seedance?).
 *
 * Owner 2026-10-28: "fill every hole in the ledger". Each paid route prices
 * its OWN upstream response — the provider's usage block — and appends one
 * line to .zclip-data/calls.jsonl. Server-side on purpose: every caller
 * (studio, flow, lab, the ones not written yet) is covered without touching
 * call sites, and a failed render can't skip the write. Dev-only like
 * /api/store — a deployment never writes the host's disk, so on hosted the
 * ledger stays video-only.
 *
 * Prices from each provider's official page, read in a browser 2026-10-28:
 *  - xAI: every chat / image / video response carries
 *    usage.cost_in_usd_ticks — the billed amount after discounts
 *    (docs.x.ai/developers/cost-tracking). "billed"
 *  - Gemini: usageMetadata × paid-tier $/1M (ai.google.dev/gemini-api/docs/pricing).
 *    Thinking tokens bill as output. "units"
 *  - OpenAI: usage tokens × $/1M (developers.openai.com model pages). "units"
 *  - ModelArk Seedream: usage.generated_images × $/image — failed images are
 *    not billed (docs.byteplus.com/en/docs/modelark/model-pricing). "units"
 *  - Anthropic: usage tokens × $/1M (platform.claude.com pricing). "units"
 *
 * Server-only (fs).
 */

import { promises as fs } from "fs";
import path from "path";
import type { CostSource } from "@/lib/billing";

export type CallProvider = "xai" | "gemini" | "openai" | "modelark" | "anthropic";

export interface CallEntry {
  at: number;
  /** The ZCLIP route that spent it — "image", "describe", "refine", … */
  route: string;
  kind: "still" | "text";
  provider: CallProvider;
  model: string;
  /** null = the response carried no usage we can price (shown as "+n?"). */
  usd: number | null;
  source: CostSource;
  sessionId?: string;
  /** Why a call cost money but returned nothing, etc. */
  note?: string;
}

/** USD per 1M tokens. `imageOut` = image output tokens (1,290 per 1K image). */
const GEMINI_PRICE: Record<string, { in: number; out: number; imageOut?: number; longIn?: number; longOut?: number }> = {
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  // > 200k-token prompts bill at the long rates
  "gemini-2.5-pro": { in: 1.25, out: 10, longIn: 2.5, longOut: 15 },
  // Deprecated (page: shut down 2026-10-02) but still answering on 10-28.
  "gemini-2.5-flash-image": { in: 0.3, out: 2.5, imageOut: 30 },
};

/** USD per 1M tokens. gpt-image-1 was shut down 2026-10-23 — kept so the
 *  ledger can still price an old line. Chat: completion tokens include
 *  reasoning. */
const OPENAI_PRICE: Record<string, { in: number; cachedIn: number; out: number; imageIn?: number; cachedImageIn?: number }> = {
  "gpt-image-1": { in: 5, cachedIn: 1.25, imageIn: 10, cachedImageIn: 2.5, out: 40 },
  "gpt-5.1": { in: 1.25, cachedIn: 0.125, out: 10 },
  "gpt-5-mini": { in: 0.25, cachedIn: 0.025, out: 2 },
};

/** USD per 1M tokens (base input · output · 5-min cache write · cache read). */
const ANTHROPIC_PRICE: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5": { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** USD per generated image. */
const SEEDREAM_PRICE: Record<string, number> = {
  "seedream-4-0-250828": 0.03,
};

/** Used only when an xAI response lacks its ticks (never seen so far) —
 *  observed bills, marked "est". */
const XAI_FALLBACK: Record<string, number> = {
  "grok-imagine-image-2.0": 0.08, // edit, 800M ticks 2026-10-27
};

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const perM = (tokens: number, usdPerM: number) => (tokens * usdPerM) / 1e6;

/** Price one upstream response body. Never throws. */
export function priceCall(
  provider: CallProvider,
  model: string,
  body: unknown,
): { usd: number | null; source: CostSource } {
  const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (provider) {
    case "xai": {
      const ticks = Number(b.usage?.cost_in_usd_ticks);
      if (Number.isFinite(ticks)) return { usd: ticks / 1e10, source: "billed" };
      const fb = XAI_FALLBACK[model];
      return fb != null ? { usd: fb, source: "est" } : { usd: null, source: "est" };
    }
    case "gemini": {
      const p = GEMINI_PRICE[model];
      const m = b.usageMetadata;
      if (!p || !m) return { usd: null, source: "est" };
      const prompt = n(m.promptTokenCount);
      const long = prompt > 200_000 && p.longIn != null;
      const details: { modality?: string; tokenCount?: number }[] = Array.isArray(m.candidatesTokensDetails)
        ? m.candidatesTokensDetails
        : [];
      const cand = n(m.candidatesTokenCount);
      // Without a modality split, an image model's candidates are its image.
      const imageTok = p.imageOut
        ? details.length
          ? details.filter((d) => d.modality === "IMAGE").reduce((s, d) => s + n(d.tokenCount), 0)
          : cand
        : 0;
      const textTok = cand - imageTok + n(m.thoughtsTokenCount);
      const usd =
        perM(prompt, long ? p.longIn! : p.in) +
        perM(textTok, long ? p.longOut! : p.out) +
        perM(imageTok, p.imageOut ?? 0);
      return { usd, source: "units" };
    }
    case "openai": {
      const p = OPENAI_PRICE[model];
      const u = b.usage;
      if (!p || !u) return { usd: null, source: "est" };
      if (u.input_tokens_details) {
        // Images API: text vs image input tokens, image output tokens.
        const d = u.input_tokens_details;
        const cached = n(d.cached_tokens);
        const imgIn = n(d.image_tokens);
        const txtIn = d.text_tokens != null ? n(d.text_tokens) : n(u.input_tokens) - imgIn;
        return {
          usd:
            perM(Math.max(0, txtIn - cached), p.in) +
            perM(cached, p.cachedIn) +
            perM(imgIn, p.imageIn ?? p.in) +
            perM(n(u.output_tokens), p.out),
          source: "units",
        };
      }
      const cached = n(u.prompt_tokens_details?.cached_tokens);
      return {
        usd:
          perM(n(u.prompt_tokens) - cached, p.in) +
          perM(cached, p.cachedIn) +
          perM(n(u.completion_tokens), p.out),
        source: "units",
      };
    }
    case "anthropic": {
      const p = ANTHROPIC_PRICE[model];
      const u = b.usage;
      if (!p || !u) return { usd: null, source: "est" };
      return {
        usd:
          perM(n(u.input_tokens), p.in) +
          perM(n(u.output_tokens), p.out) +
          perM(n(u.cache_creation_input_tokens), p.cacheWrite) +
          perM(n(u.cache_read_input_tokens), p.cacheRead),
        source: "units",
      };
    }
    case "modelark": {
      const each = SEEDREAM_PRICE[model];
      const imgs = Number(b.usage?.generated_images);
      if (each == null || !Number.isFinite(imgs)) return { usd: null, source: "est" };
      return { usd: imgs * each, source: "units" };
    }
  }
}

const isDev = () => process.env.NODE_ENV === "development";
const DIR = path.join(process.cwd(), ".zclip-data");
const CALLS = path.join(DIR, "calls.jsonl");
const JOBS = path.join(DIR, "jobs.jsonl");

/** The studio tags every keyed request with its session (lib/client-keys). */
export const SESSION_HEADER = "x-zclip-session";
const sessionOf = (req: Request): string | undefined => {
  const s = req.headers.get(SESSION_HEADER);
  return s && /^[\w-]{1,80}$/.test(s) ? s : undefined;
};

async function append(file: string, row: object): Promise<void> {
  if (!isDev()) return;
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.appendFile(file, JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* the ledger must never fail the request it records */
  }
}

/** Price an upstream response and append it to the ledger. Call it as soon
 *  as the provider answered 200 — tokens are billed even when the answer
 *  turns out unusable (no image, bad JSON). */
export async function logCall(
  req: Request,
  call: { route: string; kind: CallEntry["kind"]; provider: CallProvider; model: string; body: unknown; note?: string },
): Promise<CallEntry> {
  const { usd, source } = priceCall(call.provider, call.model, call.body);
  const entry: CallEntry = {
    at: Date.now(),
    route: call.route,
    kind: call.kind,
    provider: call.provider,
    model: call.model,
    usd,
    source,
    sessionId: sessionOf(req),
    ...(call.note ? { note: call.note } : {}),
  };
  await append(CALLS, entry);
  return entry;
}

/** Ledger lines since `sinceMs` (all when omitted). */
export async function readCalls(sinceMs = 0): Promise<CallEntry[]> {
  if (!isDev()) return [];
  try {
    const raw = await fs.readFile(CALLS, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as CallEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is CallEntry => Boolean(e) && e!.at >= sinceMs);
  } catch {
    return [];
  }
}

/** Remember that a video job was submitted WITH a reference video —
 *  Seedance bills those tokens at a different rate (lib/billing.ts). */
export async function logJobVideoInput(jobId: string, provider: string): Promise<void> {
  await append(JOBS, { at: Date.now(), jobId, provider, videoInput: true });
}

export async function jobHadVideoInput(jobId: string): Promise<boolean> {
  if (!isDev()) return false;
  try {
    const raw = await fs.readFile(JOBS, "utf8");
    return raw.includes(`"jobId":${JSON.stringify(jobId)}`);
  } catch {
    return false;
  }
}
