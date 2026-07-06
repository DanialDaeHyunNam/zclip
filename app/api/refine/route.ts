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
- PINNED CONTEXT TAKES are takes the user explicitly attached — treat them as primary source material: draw their subjects, settings and details directly into the rewrite (blending happens at the prompt level).
- EARLIER TAKES may be listed for context. When the request references one (e.g. "use take 1's background", "blend with take 1"), pull those concrete details out of that take's prompt into the rewrite. Blending happens at the prompt level — you cannot mix actual video pixels.
- If there is no base, compose a complete video prompt from the description, following UGC best practice: handheld phone look, natural skin texture, no cinematic grading.
- Reaction pacing by length: for takes of 4s or less keep ONE single held beat. For 6–8s takes, write a TIMESTAMPED beat map (e.g. "(0–1.5s) … (1.5–2.5s) …"), one beat per 1.5–2s. The canonical natural surprise arc: mid-sentence talking to camera → eyes flick to the phone → brows lift as it registers → eyes widen while one hand rises → hand covers mouth at the peak → quick glance aside to double-check → eyes soften into delighted disbelief. Include natural blinks and slight handheld drift between beats.
- Keep explicit negatives like "no gasping, no panting, no frantic gestures, slow and natural" (a slow hand-to-mouth IS allowed in the long arc).
- When the user wants the reaction/expression KEPT while changing scene, people or wardrobe: copy the action sentence VERBATIM, do not give background characters emotional actions that could bleed onto the subject (no "friends laughing"), and add explicit counters ("she does not smile", "holds this expression from first frame to last") — scene mood otherwise overrides a kept expression.
- NEVER remove the realism clauses (hyper-realistic, visible pores, no beauty filter, no airbrushed smoothing, real found-footage look) or the natural-motion language — carry them into every rewrite; add them if missing.
- If images are attached, they are the visual reference — ground the subject, styling and scene in what they actually show, then apply the requested change. Multiple frames come from a reference video and are IN TIME ORDER — read them as a performance timeline (expression by expression), not just a look.
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

  let base: unknown, message: unknown, images: unknown, history: unknown, contexts: unknown, mode: unknown, targetSeconds: unknown;
  try {
    ({ base, message, images, history, contexts, mode, targetSeconds } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "Message is empty" }, { status: 400 });
  }

  // Takes the user explicitly pinned as context — highest-priority material.
  let ctxBlock = "";
  if (Array.isArray(contexts)) {
    const entries = contexts
      .slice(0, 6)
      .filter(
        (c): c is { take: number; prompt: string } =>
          c &&
          typeof c === "object" &&
          typeof c.take === "number" &&
          typeof c.prompt === "string",
      )
      .map((c) => `Take ${c.take} prompt: ${c.prompt.slice(0, 1200)}`);
    if (entries.length) {
      ctxBlock = `PINNED CONTEXT TAKES (user attached these — draw from them directly):\n${entries.join("\n\n")}\n\n`;
    }
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

  const secs =
    typeof targetSeconds === "number" && targetSeconds >= 1 ? targetSeconds : 8;
  const transferBlock =
    mode === "transfer"
      ? `PERFORMANCE TRANSFER MODE: the attached frames sample a reference video IN TIME ORDER. Transcribe its performance precisely — per-segment facial expression, gaze direction, head angle, mouth shape, hand positions and camera drift — as a timestamped beat map scaled to ${secs} seconds. Do NOT carry over the source person's identity, face, hair, clothing or room; the subject and setting come from the BASE PROMPT. Output the final prompt as: base subject + setting, performing exactly this transcribed choreography, plus the usual realism clauses.\n\n`
      : "";
  const user =
    typeof base === "string" && base.trim()
      ? `${transferBlock}${ctxBlock}${historyBlock}BASE PROMPT (latest take — edit this one):\n${base}\n\nREQUESTED CHANGE:\n${message}`
      : `${transferBlock}${ctxBlock}${historyBlock}Write a complete video prompt from this description:\n${message}`;

  // Gemini Flash is multimodal — pass attached reference frames inline so
  // the rewrite can describe what's actually in them. A video reference
  // arrives as several extracted frames.
  const parts: Array<Record<string, unknown>> = [{ text: user }];
  if (Array.isArray(images)) {
    for (const im of images.slice(0, 12)) {
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
