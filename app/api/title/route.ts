import { REFINER_MODEL_ID } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";
import { resolveKey, missingKey } from "@/lib/server-keys";

/**
 * Auto session titles via Gemini Flash (same GEMINI_API_KEY as refine/Veo).
 * Given the recent user prompts of a session, returns a short 2–5 word name
 * so sessions are easy to tell apart in the sidebar. Text-only and near-free
 * (~$0.00002 a call) — gated behind the client's Auto-title toggle.
 */

const SYSTEM = `You name a short-video generation session from the prompts the user has sent in it.

Rules:
- Output a 2–5 word title that captures the concrete subject / scene / action (e.g. "Snowy street reaction", "Grandma phone surprise", "Neon rooftop dance").
- Prefer the through-line across the prompts; if they diverge, name the most recent one.
- If the prompts are written in another language, write the title in that language.
- No quotes, no surrounding punctuation, no trailing period, no emoji, no markdown.
- Under 48 characters.
- Output ONLY the title text.`;

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const key = resolveKey(req, "GEMINI_API_KEY");
  if (!key) return missingKey("GEMINI_API_KEY", "Gemini");

  let messages: unknown;
  try {
    ({ messages } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompts = Array.isArray(messages)
    ? messages
        .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
        .slice(-6)
        .map((m) => m.slice(0, 600))
    : [];
  if (!prompts.length) {
    return Response.json({ error: "No prompts to title" }, { status: 400 });
  }

  const user = `Prompts sent in this session (oldest first):\n${prompts
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n")}\n\nName this session.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${REFINER_MODEL_ID}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 24,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!res.ok) {
    let msg = `Title generator error (HTTP ${res.status})`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    return Response.json({ error: msg }, { status: 502 });
  }

  const data = await res.json();
  const raw: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!raw) {
    return Response.json({ error: "Title generator returned no text" }, {
      status: 502,
    });
  }
  // Strip any stray wrapping quotes/markdown the model might add.
  const title = raw
    .replace(/^["'`*_\s]+|["'`*_\s]+$/g, "")
    .slice(0, 60);
  return Response.json({ title });
}
