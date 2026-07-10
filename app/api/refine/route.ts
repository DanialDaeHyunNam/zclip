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

  let base: unknown, message: unknown, images: unknown, history: unknown, contexts: unknown, mode: unknown, targetSeconds: unknown, rules: unknown;
  try {
    ({ base, message, images, history, contexts, mode, targetSeconds, rules } = await req.json());
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
      ? `PERFORMANCE TRANSFER MODE — the attached frames sample a reference video IN TIME ORDER. Produce a MOTION-FAITHFUL transcription: the output take must move exactly like the reference; the ONLY things that change are WHO performs it and WHERE.

Transcribe interval by interval (frames are evenly spaced across the source — map them linearly onto ${secs} seconds):
- facial expression and intensity, brow/blink timing
- gaze direction and every gaze shift
- head angle and turns
- mouth shape (talking / open / pressed / smile width)
- BOTH hands: position, gesture, when they enter or leave frame
- body lean and shoulder movement
- camera: shot distance, framing, handheld drift, any push-in or pan — copy it

HARD RULES:
- Do NOT invent, reorder, drop, merge or embellish beats. If the reference holds still, the output holds still. Same beat order, same relative timing.
- Keep the reference's shot type and camera distance for the whole take.
- REPLACE ONLY the performer's identity/appearance (use the BASE PROMPT's subject wording verbatim) and the location (use the BASE PROMPT's setting wording verbatim). Never describe the source person's face, hair, clothing, or room.
- Output shape: one line of subject + setting from the base prompt, then a timestamped beat map "(0-1.5s) ..." covering all ${secs} seconds with no gaps, then the realism clauses.\n\n`
      : "";
  // The reference-mix checkboxes — the user's explicit per-aspect choices
  // about the attached reference. Placed AFTER the transfer block so they
  // override its blanket copy-everything instructions where they conflict.
  let rulesBlock = "";
  if (Array.isArray(rules)) {
    const lines = rules
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .slice(0, 12)
      .map((r) => `- ${r.slice(0, 300)}`);
    if (lines.length) {
      rulesBlock = `REFERENCE CARRY-OVER SETTINGS (the user's explicit checkbox choices for the attached reference — apply STRICTLY; where these conflict with anything above, THESE win):\n${lines.join("\n")}\n\n`;
    }
  }

  const user =
    typeof base === "string" && base.trim()
      ? `${transferBlock}${rulesBlock}${ctxBlock}${historyBlock}BASE PROMPT (latest take — edit this one):\n${base}\n\nREQUESTED CHANGE:\n${message}`
      : `${transferBlock}${rulesBlock}${ctxBlock}${historyBlock}Write a complete video prompt from this description:\n${message}`;

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
        generationConfig: {
          temperature: 0.4,
          // Cap output and DISABLE thinking. Gemini 2.5 Flash otherwise
          // spends output tokens on internal thinking; with ~10 real video
          // frames to analyze it can exhaust the budget and finish with
          // finishReason MAX_TOKENS and an EMPTY text part — the "no text"
          // failure. thinkingBudget:0 sends all tokens to the answer.
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
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
    // Say WHY the text is missing so it's not a mystery. The two real
    // causes with video references: a safety block (real people + a
    // face-replace ask reads as deepfake) or a truncated generation.
    const block = data?.promptFeedback?.blockReason;
    const finish = data?.candidates?.[0]?.finishReason;
    let error = "Refiner returned no text — try rephrasing.";
    if (block || finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
      error =
        "Gemini blocked this reference as sensitive content — a real face + a 'replace the face' ask can read as deepfake. Try a shorter/less explicit instruction (e.g. \"same performance, new person\"), fewer frames, or a different clip.";
    } else if (finish === "MAX_TOKENS") {
      error = "Refiner hit its length limit before finishing — try a shorter clip or fewer context takes.";
    } else if (finish === "RECITATION") {
      error = "Gemini stopped on a recitation check — reword the instruction and retry.";
    }
    return Response.json({ error, finishReason: finish ?? block ?? null }, { status: 502 });
  }
  return Response.json({ prompt });
}
