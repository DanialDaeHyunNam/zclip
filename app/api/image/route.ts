import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";
import { logCall, type CallProvider } from "@/lib/call-ledger";

/**
 * Still-image generation for the Flow method's stage 1 (the "who/look"
 * step — stage 2 animates the confirmed still via /api/generate).
 * Three engines, all riding keys the app already manages:
 *   grok   — xAI grok-imagine-image-quality (~$0.05, verified pattern:
 *            the grok video adapter uses the same call internally)
 *   gpt    — OpenAI gpt-image-1 (~$0.06 portrait medium; returns b64)
 *   gemini — Gemini 2.5 Flash Image (~$0.04; returns inline_data)
 * EDIT mode (a reference still rides along) has two engines: Gemini (default)
 * and Grok Imagine edit (`/v1/images/edits`, ~$0.08 — observed usage
 * 800M ticks 2026-10-27). Both take EXTRA references beside the look being
 * edited ("image 2 = pose/framing only") — owner ask 2026-10-27: put a character's
 * card and a frame of the owner's own acting into ONE edit.
 * Provider URLs expire, so everything is returned as base64 — the client
 * keeps it for confirm/iterate and hands it to any i2v provider later.
 * Every engine bills the ledger the moment its provider answers 200
 * (lib/call-ledger.ts) — an answer without an image is still charged.
 */

const MAX_B64 = 4_000_000; // matches /api/generate's reference-image cap

type Img = { base64: string; mimeType: string };
type Bill = (provider: CallProvider, model: string, body: unknown, note?: string) => Promise<unknown>;

async function fromUrl(url: string): Promise<Img> {
  const img = await fetch(url);
  if (!img.ok) throw new Error(`Image download failed (HTTP ${img.status})`);
  const mimeType = img.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const base64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  return { base64, mimeType };
}

async function readErr(res: Response, label: string): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? b?.error ?? `${label} error (HTTP ${res.status})`;
  } catch {
    return `${label} error (HTTP ${res.status})`;
  }
}

async function grokImage(prompt: string, key: string, bill: Bill): Promise<Img> {
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "grok-imagine-image-quality", prompt, n: 1 }),
  });
  if (!res.ok) throw new Error(await readErr(res, "xAI image"));
  const j = await res.json();
  await bill("xai", "grok-imagine-image-quality", j);
  const url = j?.data?.[0]?.url;
  if (typeof url !== "string" || !url.startsWith("https://"))
    throw new Error("xAI returned no image url");
  return fromUrl(url);
}

/** Grok Imagine EDIT — docs.x.ai /developers/model-capabilities/images/editing
 *  (+ multi-image-editing: up to 5 sources, ordered, base64 data URIs OK, the
 *  output follows the FIRST image's aspect ratio). One source rides as
 *  `image`, several as `images` — the multi shape verified live 2026-10-27. */
async function grokEdit(prompt: string, key: string, refs: Img[], bill: Bill): Promise<Img> {
  const src = refs.map((r) => ({
    url: `data:${r.mimeType};base64,${r.base64}`,
    type: "image_url",
  }));
  const res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "grok-imagine-image-2.0",
      prompt,
      ...(src.length === 1 ? { image: src[0] } : { images: src }),
      response_format: "b64_json",
    }),
  });
  if (!res.ok) throw new Error(await readErr(res, "xAI image edit"));
  const j = await res.json();
  await bill("xai", "grok-imagine-image-2.0", j, `edit · ${refs.length} image${refs.length > 1 ? "s" : ""}`);
  const d = j?.data?.[0];
  if (typeof d?.b64_json === "string" && d.b64_json) {
    return { base64: d.b64_json, mimeType: d.mime_type ?? "image/jpeg" };
  }
  if (typeof d?.url === "string" && d.url.startsWith("https://")) return fromUrl(d.url);
  throw new Error("xAI returned no edited image");
}

async function gptImage(prompt: string, portrait: boolean, key: string, bill: Bill): Promise<Img> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      n: 1,
      size: portrait ? "1024x1536" : "1536x1024",
      quality: "medium",
    }),
  });
  if (!res.ok) throw new Error(await readErr(res, "OpenAI image"));
  const j = await res.json();
  await bill("openai", "gpt-image-1", j);
  const b64 = j?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new Error("OpenAI returned no image");
  return { base64: b64, mimeType: "image/png" };
}

async function seedreamImage(prompt: string, portrait: boolean, key: string, bill: Bill): Promise<Img> {
  // ByteDance Seedream 4.0 via ModelArk — SAME account/key as Seedance, so
  // the look card is drawn by the family that will render the video (in
  // text-identity mode the card is a preview of the prompt; same-family
  // previews predict the render). OpenAI-style images API per the ModelArk
  // docs — exact size enum UNVERIFIED until the first real run; a reject
  // surfaces loudly and bills nothing.
  const res = await fetch(
    "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations",
    {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "seedream-4-0-250828",
        prompt,
        size: portrait ? "1080x1920" : "1920x1080",
        watermark: false,
      }),
    },
  );
  if (!res.ok) throw new Error(await readErr(res, "Seedream"));
  const j = await res.json();
  await bill("modelark", "seedream-4-0-250828", j);
  const d = j?.data?.[0];
  if (typeof d?.b64_json === "string" && d.b64_json) {
    return { base64: d.b64_json, mimeType: "image/png" };
  }
  if (typeof d?.url === "string" && d.url.startsWith("https://")) {
    return fromUrl(d.url);
  }
  throw new Error("Seedream returned no image");
}

async function geminiImage(prompt: string, key: string, bill: Bill, refs: Img[] = []): Promise<Img> {
  // With reference images this becomes an EDIT: same subject, apply the
  // described change (Gemini 2.5 Flash Image is natively multimodal). Images
  // ride in order — the prompt can say "image 1 / image 2".
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const ref of refs) {
    parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.base64 } });
  }
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
  );
  if (!res.ok) throw new Error(await readErr(res, "Gemini image"));
  const j = await res.json();
  await bill("gemini", "gemini-2.5-flash-image", j, refs.length ? `edit · ${refs.length} image${refs.length > 1 ? "s" : ""}` : undefined);
  const outParts: Array<Record<string, unknown>> = j?.candidates?.[0]?.content?.parts ?? [];
  for (const p of outParts) {
    const d = (p?.inlineData ?? p?.inline_data) as
      | { data?: string; mimeType?: string; mime_type?: string }
      | undefined;
    if (d?.data) {
      return {
        base64: d.data,
        mimeType: d.mimeType ?? d.mime_type ?? "image/png",
      };
    }
  }
  throw new Error("Gemini returned no image — try rephrasing");
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  let prompt: unknown, engine: unknown, aspect: unknown, image: unknown, images: unknown;
  try {
    ({ prompt, engine, aspect, image, images } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Prompt is empty" }, { status: 400 });
  }
  const p = prompt.slice(0, 4000);
  const portrait = aspect !== "16:9";
  // Optional reference stills ⇒ EDIT mode. `image` = the look being edited
  // (image 1), `images` = extra references after it (pose/framing etc.).
  const asImg = (v: unknown): Img | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const { base64, mimeType } = v as Record<string, unknown>;
    return typeof base64 === "string" &&
      typeof mimeType === "string" &&
      base64.length <= MAX_B64 &&
      /^image\//.test(mimeType)
      ? { base64, mimeType }
      : undefined;
  };
  const ref = asImg(image);
  const extras = ref && Array.isArray(images)
    ? images.slice(0, 4).map(asImg).filter((x): x is Img => Boolean(x))
    : [];
  const refs = ref ? [ref, ...extras] : [];
  // Edits run on Gemini unless Grok is explicitly picked — the key follows
  // the engine that will actually run, not the one the look picker shows.
  const editOnGrok = Boolean(ref) && engine === "grok";

  const envVar = ref
    ? editOnGrok
      ? "XAI_API_KEY"
      : "GEMINI_API_KEY"
    : engine === "gpt"
      ? "OPENAI_API_KEY"
      : engine === "gemini"
        ? "GEMINI_API_KEY"
        : engine === "seedream"
          ? "ARK_API_KEY"
          : "XAI_API_KEY";
  const label =
    envVar === "GEMINI_API_KEY"
      ? "Gemini"
      : envVar === "OPENAI_API_KEY"
        ? "OpenAI"
        : envVar === "ARK_API_KEY"
          ? "ModelArk"
          : "xAI";
  const key = resolveKey(req, envVar);
  if (!key) return missingKey(envVar, label);
  const bill: Bill = (provider, model, body, note) =>
    logCall(req, { route: "image", kind: "still", provider, model, body, note });

  try {
    const img = ref
      ? editOnGrok
        ? await grokEdit(p, key, refs, bill)
        : await geminiImage(p, key, bill, refs)
      : engine === "gpt"
        ? await gptImage(p, portrait, key, bill)
        : engine === "gemini"
          ? await geminiImage(p, key, bill)
          : engine === "seedream"
            ? await seedreamImage(p, portrait, key, bill)
            : await grokImage(p, key, bill);
    if (img.base64.length > MAX_B64) {
      return Response.json(
        { error: "Generated image unexpectedly large — try again" },
        { status: 502 },
      );
    }
    return Response.json(img);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 502 },
    );
  }
}
