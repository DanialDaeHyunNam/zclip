import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * DRESS — composite a chosen outfit onto a character image with the Gemini
 * image model, keeping the same face/identity/hair/pose. The result becomes
 * Act-Two's `character` so the animated person wears the picked garment.
 * Act-Two itself has no wardrobe input; this is the pre-step that adds one.
 */

const MODEL = "gemini-2.5-flash-image";
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_B64 = 4_000_000;

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY ?? null;
}

function parseImage(raw: unknown): { base64: string; mimeType: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { base64, mimeType } = raw as Record<string, unknown>;
  if (typeof base64 !== "string" || typeof mimeType !== "string") return null;
  if (!IMAGE_MIMES.includes(mimeType) || base64.length > MAX_B64) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  return { base64, mimeType };
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const key = apiKey();
  if (!key) {
    return Response.json({ error: "GEMINI_API_KEY is not set" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const character = parseImage(body.character);
  const outfit = parseImage(body.outfit);
  if (!character || !outfit) {
    return Response.json({ error: "character and outfit images are required" }, { status: 400 });
  }

  const instruction =
    "Image 1 is a person. Image 2 is a clothing item. Redraw Image 1 so the SAME person — identical face, hair, skin, expression, pose, camera angle and background — is now wearing the outfit from Image 2 instead of their current top. Keep the face and identity EXACTLY the same. Photorealistic, natural fabric drape and lighting consistent with the original photo. Output only the edited photo.";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: instruction },
              { inline_data: { mime_type: character.mimeType, data: character.base64 } },
              { inline_data: { mime_type: outfit.mimeType, data: outfit.base64 } },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    let msg = `Dress step failed (HTTP ${res.status})`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* non-JSON */
    }
    return Response.json({ error: msg }, { status: 502 });
  }

  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find(
    (p: Record<string, unknown>) => p.inlineData ?? p.inline_data,
  );
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline?.data) {
    const reason =
      data?.promptFeedback?.blockReason ??
      data?.candidates?.[0]?.finishReason ??
      "no image returned";
    return Response.json(
      { error: `Dress step produced no image (${reason}) — try a different outfit or character.` },
      { status: 502 },
    );
  }
  return Response.json({
    base64: inline.data,
    mimeType: inline.mimeType ?? inline.mime_type ?? "image/jpeg",
  });
}
