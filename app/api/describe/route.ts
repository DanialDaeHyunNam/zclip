import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";
import { logCall } from "@/lib/call-ledger";

/**
 * DESCRIBE — turn a look card into an IDENTITY TEXT for the transfer
 * flow's text-mode casting. Text identities are what actually ride to
 * Seedance (photoreal images trip its filter), and a look's generation
 * prompt is usually a photo-composition brief, not a face description —
 * so both dancers converge on the same face. Gemini looks at the CARD
 * and writes the contrastable description the prompt never was.
 */

const MODEL = "gemini-2.5-flash";
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_B64 = 4_000_000;

const INSTRUCTION =
  "Describe the person in this image for a video-generation cast sheet. " +
  "2–3 dense sentences, distinctive features first: face shape, jawline, eyes, nose, lips, " +
  "hair color + style + length, skin tone, build, overall vibe, then the outfit. " +
  "Be specific enough that a different artist would draw the SAME person and could tell them apart from a similar-looking one. " +
  "This is a fictional character — no names, no locations, no camera or photography terms. Output ONLY the description.";

/** mode "pose" — the FRAME's camera + performance only, for re-shooting it
 *  with a different person (owner 2026-10-27: a pose image riding as
 *  "image 2" is ignored by both edit engines; words describing the shot
 *  work — this writes those words from the frame instead of a human). */
const POSE_INSTRUCTION =
  "Describe ONLY the camera and the performance in this frame, so the shot can be re-created with a DIFFERENT person. " +
  "One paragraph, 3–4 sentences. Use directions relative to the FRAME (left/right edge of the image). Cover: " +
  "camera distance and crop (e.g. extreme close-up, top of the head cropped, chin near the bottom edge), camera height and angle, " +
  "head turn (which frame edge the nose points to and how far — frontal, three-quarter, near-profile), head tilt, " +
  "gaze direction, eyelids, eyebrows, mouth (open or closed, its shape) and the emotion being shown. " +
  "Do NOT describe identity: no gender, age, ethnicity, face shape, hair, skin, glasses, clothing, background or room. " +
  "Output ONLY the description.";

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const key = resolveKey(req, "GEMINI_API_KEY");
  if (!key) return missingKey("GEMINI_API_KEY", "Gemini");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const pose = body.mode === "pose";
  const img = body.image as Record<string, unknown> | undefined;
  const base64 = typeof img?.base64 === "string" ? img.base64 : "";
  const mimeType = typeof img?.mimeType === "string" ? img.mimeType : "";
  if (!base64 || !IMAGE_MIMES.includes(mimeType) || base64.length > MAX_B64) {
    return Response.json({ error: "A jpeg/png/webp image is required" }, { status: 400 });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: pose ? POSE_INSTRUCTION : INSTRUCTION },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    let msg = `Describe failed (HTTP ${res.status})`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* non-JSON */
    }
    return Response.json({ error: msg }, { status: 502 });
  }
  const data = await res.json();
  await logCall(req, { route: "describe", kind: "text", provider: "gemini", model: MODEL, body: data, note: pose ? "pose" : undefined });
  const text: unknown = data?.candidates?.[0]?.content?.parts
    ?.map((p: Record<string, unknown>) => p?.text ?? "")
    .join(" ")
    .trim();
  if (typeof text !== "string" || !text) {
    return Response.json({ error: "Gemini returned no description" }, { status: 502 });
  }
  return Response.json({ text: text.slice(0, 1200) });
}
