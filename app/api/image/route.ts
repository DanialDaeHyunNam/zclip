import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";

/**
 * Still-image generation for the Flow method's stage 1 (the "who/look"
 * step — stage 2 animates the confirmed still via /api/generate).
 * Three engines, all riding keys the app already manages:
 *   grok   — xAI grok-imagine-image-quality (~$0.05, verified pattern:
 *            the grok video adapter uses the same call internally)
 *   gpt    — OpenAI gpt-image-1 (~$0.06 portrait medium; returns b64)
 *   gemini — Gemini 2.5 Flash Image (~$0.04; returns inline_data)
 * Provider URLs expire, so everything is returned as base64 — the client
 * keeps it for confirm/iterate and hands it to any i2v provider later.
 */

const MAX_B64 = 4_000_000; // matches /api/generate's reference-image cap

type Img = { base64: string; mimeType: string };

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

async function grokImage(prompt: string, key: string): Promise<Img> {
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "grok-imagine-image-quality", prompt, n: 1 }),
  });
  if (!res.ok) throw new Error(await readErr(res, "xAI image"));
  const url = (await res.json())?.data?.[0]?.url;
  if (typeof url !== "string" || !url.startsWith("https://"))
    throw new Error("xAI returned no image url");
  return fromUrl(url);
}

async function gptImage(prompt: string, portrait: boolean, key: string): Promise<Img> {
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
  const b64 = (await res.json())?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new Error("OpenAI returned no image");
  return { base64: b64, mimeType: "image/png" };
}

async function seedreamImage(prompt: string, portrait: boolean, key: string): Promise<Img> {
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
  const d = (await res.json())?.data?.[0];
  if (typeof d?.b64_json === "string" && d.b64_json) {
    return { base64: d.b64_json, mimeType: "image/png" };
  }
  if (typeof d?.url === "string" && d.url.startsWith("https://")) {
    return fromUrl(d.url);
  }
  throw new Error("Seedream returned no image");
}

async function geminiImage(prompt: string, key: string, ref?: Img): Promise<Img> {
  // With a reference image this becomes an EDIT: same subject, apply the
  // described change (Gemini 2.5 Flash Image is natively multimodal).
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (ref) {
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
  const outParts: Array<Record<string, unknown>> =
    (await res.json())?.candidates?.[0]?.content?.parts ?? [];
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

  let prompt: unknown, engine: unknown, aspect: unknown, image: unknown;
  try {
    ({ prompt, engine, aspect, image } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Prompt is empty" }, { status: 400 });
  }
  const p = prompt.slice(0, 4000);
  const portrait = aspect !== "16:9";
  // Optional reference still ⇒ EDIT mode. Gemini is the only wired engine
  // with native image editing, so a reference forces the gemini path.
  let ref: Img | undefined;
  if (image && typeof image === "object") {
    const { base64, mimeType } = image as Record<string, unknown>;
    if (
      typeof base64 === "string" &&
      typeof mimeType === "string" &&
      base64.length <= MAX_B64 &&
      /^image\//.test(mimeType)
    ) {
      ref = { base64, mimeType };
    }
  }

  // A reference forces the Gemini edit path, so the key follows the engine
  // that will actually run — not the one the picker shows.
  const envVar = ref
    ? "GEMINI_API_KEY"
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

  try {
    const img = ref
      ? await geminiImage(p, key, ref)
      : engine === "gpt"
        ? await gptImage(p, portrait, key)
        : engine === "gemini"
          ? await geminiImage(p, key)
          : engine === "seedream"
            ? await seedreamImage(p, portrait, key)
            : await grokImage(p, key);
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
