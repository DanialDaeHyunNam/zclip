import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * Still-image generation for the Flow method's step 1 (the "who/look"
 * step — step 2 animates the confirmed still via /api/generate).
 * Engine: xAI Grok Imagine image (same key + model the grok video
 * adapter's text mode uses internally; ~$0.05/image). The provider URL
 * expires, so the image is downloaded server-side and returned as
 * base64 — the client keeps it for confirm/iterate and hands it to any
 * i2v provider later.
 */

const BASE = "https://api.x.ai/v1";
const IMAGE_MODEL = "grok-imagine-image-quality";
const MAX_B64 = 4_000_000; // matches /api/generate's reference-image cap

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const key = process.env.XAI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "XAI_API_KEY is not set — add it in the key panel (Grok)" },
      { status: 500 },
    );
  }

  let prompt: unknown;
  try {
    ({ prompt } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "Prompt is empty" }, { status: 400 });
  }

  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: prompt.slice(0, 4000), n: 1 }),
  });
  if (!res.ok) {
    let msg = `xAI image error (HTTP ${res.status})`;
    try {
      const b = await res.json();
      msg = b?.error?.message ?? b?.error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    return Response.json({ error: msg }, { status: 502 });
  }
  const body = await res.json();
  const url = body?.data?.[0]?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return Response.json({ error: "xAI returned no image url" }, { status: 502 });
  }

  // Fetch the (expiring) provider URL now; hand back durable bytes.
  const img = await fetch(url);
  if (!img.ok) {
    return Response.json(
      { error: `Image download failed (HTTP ${img.status})` },
      { status: 502 },
    );
  }
  const mimeType = img.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  if (b64.length > MAX_B64) {
    return Response.json(
      { error: "Generated image unexpectedly large — try again" },
      { status: 502 },
    );
  }
  return Response.json({ base64: b64, mimeType });
}
