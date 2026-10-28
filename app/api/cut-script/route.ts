import { REFINER_MODEL_ID } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";
import { logCall, type CallProvider } from "@/lib/call-ledger";

/**
 * CUT pipeline script writer (docs/CUT-FLOW.md) — Gemini, same key/route
 * pattern as /api/refine. Two modes in one endpoint:
 *   { topic, language?, sceneCount? }  → write a narration script as scenes
 *   { script }                         → keep the given paragraphs verbatim,
 *                                        only add stock-search terms
 * → { scenes: [{ text, terms: [".."] }] }
 * Terms are chronological per scene (MPT's match_script_order idea, but
 * per-scene instead of a global list).
 */

const SYSTEM = `You prepare narration scripts for short vertical videos assembled from stock footage.

Return STRICT JSON only: {"scenes":[{"text":"...","terms":["...","..."]}]}

Rules:
- Each scene's "text" is 1–3 short spoken sentences of plain narration. No markdown, no emojis, no stage directions, no scene numbers, no "Narrator:" prefixes.
- Each scene's "terms" is exactly 2 short ENGLISH stock-video search phrases (2–4 words each) describing what should be ON SCREEN during that scene. Concrete and generic enough to match stock libraries (no brand names, no celebrities, no text overlays).
- Terms follow the narration chronologically: scene 1's terms describe the opening visual, the last scene's the closing visual.
- If a SCRIPT is provided: split it into scenes at blank lines and keep each paragraph's text VERBATIM (do not rewrite, do not merge, do not reorder) — only add terms.
- If a TOPIC is provided: write the script yourself in the requested language, hook-first (the first sentence must earn the next 3 seconds), 3–6 scenes unless a scene count is given.`;

/** Script-writer models — every provider the user may already hold a key
 *  for (owner call 2026-08-03: "if the key is there, the model shows").
 *  Whitelisted server-side like every param (never trust the UI). Keys ride
 *  per request via resolveKey (header on hosted, env fallback local-only).
 *  ARK (ModelArk LLMs) deliberately absent until its chat shape is verified. */
const SCRIPT_MODELS: Record<
  string,
  { envVar: string; api: "gemini" | "openai-compat" | "anthropic"; url?: string }
> = {
  "claude-opus-5": { envVar: "ANTHROPIC_API_KEY", api: "anthropic" },
  "claude-sonnet-5": { envVar: "ANTHROPIC_API_KEY", api: "anthropic" },
  "claude-haiku-4-5": { envVar: "ANTHROPIC_API_KEY", api: "anthropic" },
  "gemini-2.5-flash": { envVar: "GEMINI_API_KEY", api: "gemini" },
  "gemini-2.5-pro": { envVar: "GEMINI_API_KEY", api: "gemini" },
  "gemini-2.5-flash-lite": { envVar: "GEMINI_API_KEY", api: "gemini" },
  "gpt-5.1": {
    envVar: "OPENAI_API_KEY",
    api: "openai-compat",
    url: "https://api.openai.com/v1/chat/completions",
  },
  "gpt-5-mini": {
    envVar: "OPENAI_API_KEY",
    api: "openai-compat",
    url: "https://api.openai.com/v1/chat/completions",
  },
  "grok-4-fast-non-reasoning": {
    envVar: "XAI_API_KEY",
    api: "openai-compat",
    url: "https://api.x.ai/v1/chat/completions",
  },
};

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  let topic: unknown, script: unknown, language: unknown, sceneCount: unknown, model: unknown;
  try {
    ({ topic, script, language, sceneCount, model } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const modelId =
    typeof model === "string" && SCRIPT_MODELS[model] ? model : REFINER_MODEL_ID;
  const entry = SCRIPT_MODELS[modelId];

  const key = resolveKey(req, entry.envVar);
  if (!key) return missingKey(entry.envVar, modelId);
  const hasTopic = typeof topic === "string" && topic.trim();
  const hasScript = typeof script === "string" && script.trim();
  if (!hasTopic && !hasScript) {
    return Response.json({ error: "Need a topic or a script" }, { status: 400 });
  }

  const user = hasScript
    ? `SCRIPT (split at blank lines, keep text verbatim, add terms):\n\n${(script as string).trim().slice(0, 6000)}`
    : `TOPIC: ${(topic as string).trim().slice(0, 500)}\n` +
      (typeof language === "string" && language.trim()
        ? `LANGUAGE: ${language.trim().slice(0, 40)}\n`
        : "") +
      (typeof sceneCount === "number" && sceneCount >= 2 && sceneCount <= 10
        ? `SCENES: ${Math.round(sceneCount)}\n`
        : "");

  let res: Response;
  if (entry.api === "gemini") {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
          },
        }),
      },
    );
  } else if (entry.api === "anthropic") {
    // Raw Messages API (repo convention: no SDKs, key rides per request).
    // No temperature (Claude 5-class rejects it); thinking is on by default
    // on Opus 5 so max_tokens covers thinking + text. effort=low keeps the
    // call fast/cheap — but Haiku 4.5 rejects the effort param, so omit it.
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 8192,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        ...(modelId === "claude-haiku-4-5"
          ? {}
          : { output_config: { effort: "low" } }),
      }),
    });
  } else {
    // OpenAI-compatible chat completions (OpenAI, xAI). No temperature —
    // GPT-5-class models only accept their default. json_object mode is
    // honored because SYSTEM says "JSON".
    res = await fetch(entry.url!, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `${modelId} error ${res.status}: ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }
  const data = await res.json();
  // Billed even when Claude refuses below — record first.
  const LEDGER: Record<typeof entry.api, CallProvider> = { gemini: "gemini", anthropic: "anthropic", "openai-compat": "openai" };
  await logCall(req, {
    route: "cut-script",
    kind: "text",
    // xAI rides the OpenAI-compatible shape but bills in ticks
    provider: entry.envVar === "XAI_API_KEY" ? "xai" : LEDGER[entry.api],
    model: modelId,
    body: data,
  });
  // Claude can decline via safety classifiers with a NORMAL 200 — check
  // stop_reason before reading content (claude-api skill guidance).
  if (entry.api === "anthropic" && data?.stop_reason === "refusal") {
    return Response.json(
      { error: `${modelId} declined this topic — rephrase or pick another model` },
      { status: 502 },
    );
  }
  let textOut: string =
    entry.api === "gemini"
      ? (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      : entry.api === "anthropic"
        ? (
            (data?.content as { type?: string; text?: string }[] | undefined)?.find(
              (b) => b.type === "text",
            )?.text ?? ""
          )
        : (data?.choices?.[0]?.message?.content ?? "");
  // Non-JSON-mode fallbacks still love ```json fences (MPT lesson) — strip.
  textOut = textOut.trim().replace(/^```[a-zA-Z0-9]*\s*/, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(textOut) as {
      scenes?: { text?: unknown; terms?: unknown }[];
    };
    const scenes = (parsed.scenes ?? [])
      .map((s) => ({
        text: typeof s.text === "string" ? s.text.trim() : "",
        terms: Array.isArray(s.terms)
          ? s.terms.filter((t): t is string => typeof t === "string").slice(0, 3)
          : [],
      }))
      .filter((s) => s.text);
    if (!scenes.length) throw new Error("no scenes");
    return Response.json({ scenes });
  } catch {
    return Response.json(
      { error: "Gemini returned unparseable scenes — try again" },
      { status: 502 },
    );
  }
}
