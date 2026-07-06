import { REFINER_MODEL_ID } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * Conversational prompt refinement via Gemini Flash (same API key as Veo).
 * Given an optional base prompt and the user's requested change, returns a
 * complete rewritten video prompt. Text-only and near-free — the expensive
 * step (video) happens separately in /api/generate.
 */

const SYSTEM = `You write prompts for a text-to-video model that generates short vertical UGC-style clips (amateur selfie look, single subtle held reaction).

Rules:
- If a BASE PROMPT is given, apply the REQUESTED CHANGE with minimal edits — preserve everything not mentioned.
- EARLIER TAKES may be listed for context. When the request references one (e.g. "use take 1's background", "blend with take 1"), pull those concrete details out of that take's prompt into the rewrite. Blending happens at the prompt level — you cannot mix actual video pixels.
- If there is no base, compose a complete video prompt from the description, following UGC best practice: handheld phone look, natural skin texture, no cinematic grading.
- Keep any reaction to ONE single held beat; keep explicit negatives like "no gasping, no panting, no hand movements, slow and natural".
- If images are attached, they are the visual reference — ground the subject, styling and scene in what they actually show, then apply the requested change. Multiple frames come from a reference video (beginning/middle/end): infer the subject, scene and motion arc across them.
- Always write the prompt in English (video models follow English best), regardless of the request's language.
- Under 900 characters.
- Output ONLY the final prompt text. No quotes, no markdown, no explanation.`;

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set — see README.md" },
      { status: 500 },
    );
  }

  let base: unknown, message: unknown, images: unknown, history: unknown;
  try {
    ({ base, message, images, history } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "Message is empty" }, { status: 400 });
  }

  // Session context so "take 1's background" resolves to something real.
  let historyBlock = "";
  if (Array.isArray(history)) {
    const entries = history
      .slice(-8)
      .filter(
        (h): h is { take: number; request: string; prompt: string } =>
          h &&
          typeof h === "object" &&
          typeof h.take === "number" &&
          typeof h.request === "string" &&
          typeof h.prompt === "string",
      )
      .map(
        (h) =>
          `Take ${h.take} — request: ${h.request.slice(0, 500)}\nprompt used: ${h.prompt.slice(0, 1200)}`,
      );
    if (entries.length) {
      historyBlock = `EARLIER TAKES IN THIS SESSION:\n${entries.join("\n\n")}\n\n`;
    }
  }

  const user =
    typeof base === "string" && base.trim()
      ? `${historyBlock}BASE PROMPT (latest take — edit this one):\n${base}\n\nREQUESTED CHANGE:\n${message}`
      : `${historyBlock}Write a complete video prompt from this description:\n${message}`;

  // Gemini Flash is multimodal — pass attached reference frames inline so
  // the rewrite can describe what's actually in them. A video reference
  // arrives as several extracted frames.
  const parts: Array<Record<string, unknown>> = [{ text: user }];
  if (Array.isArray(images)) {
    for (const im of images.slice(0, 4)) {
      if (
        im &&
        typeof im === "object" &&
        typeof (im as Record<string, unknown>).base64 === "string" &&
        typeof (im as Record<string, unknown>).mimeType === "string" &&
        (im as { base64: string }).base64.length <= 4_000_000
      ) {
        const { base64, mimeType } = im as { base64: string; mimeType: string };
        parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
      }
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${REFINER_MODEL_ID}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4 },
      }),
    },
  );
  if (!res.ok) {
    let msg = `Prompt refiner error (HTTP ${res.status})`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    return Response.json({ error: msg }, { status: 502 });
  }

  const data = await res.json();
  const prompt: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!prompt) {
    return Response.json(
      { error: "Refiner returned no text — try rephrasing." },
      { status: 502 },
    );
  }
  return Response.json({ prompt });
}
