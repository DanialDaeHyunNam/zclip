import { REFINER_MODEL_ID } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";
import {
  SPEC_VERSION,
  SECTIONS,
  GATES,
  MODEL_PROFILES,
  type SpecGate,
} from "@/lib/video-prompt-spec";
import type { SpecAnswer, SpecVerdict } from "@/lib/spec-check";

/**
 * Video Prompt Spec Gate — a SEPARATE track from /api/refine.
 * refine minimally edits short UGC prompts (≤900 chars); this route deals
 * in full 15-section spec prompts (2–4k chars) and must NEVER clamp them.
 *
 * Provider-aware (docs § Per-model adaptation): both modes consume the
 * selected provider's MODEL_PROFILES entry — the check validates the draft
 * against promptLanguage/maxSeconds/avoid (as warnings) and merges the
 * profile's extraGates; assembly appends the profile's assembleHints.
 *
 * mode:"check"    → {missing, note, warnings} against draft + answers.
 * mode:"assemble" → the full 15-section prompt; the client submits it to
 *                   /api/generate VERBATIM.
 */

/** Critical gates for a provider = shared GATES + its profile extraGates. */
const criticalGatesFor = (provider: string | undefined): SpecGate[] => [
  ...GATES.filter((g) => g.critical),
  ...(provider ? (MODEL_PROFILES[provider]?.extraGates ?? []) : []).filter(
    (g) => g.critical,
  ),
];

const profileBlock = (provider: string | undefined): string => {
  const p = provider ? MODEL_PROFILES[provider] : undefined;
  if (!p) return "";
  return `\n\nTARGET PROVIDER PROFILE (${provider}):
- prompt body language: ${p.promptLanguage === "english-only" ? "STRICTLY English (non-English prompt bodies hard-fail on this provider)" : "English (spoken lines may stay Korean)"}
${p.maxSeconds ? `- hard duration cap: ${p.maxSeconds}s — if the draft or answers ask for longer, add a warning saying the take will be cut to ${p.maxSeconds}s` : ""}
${p.avoid?.length ? `- known-breaking formats on this provider — warn when the draft asks for one:\n${p.avoid.map((a) => `  · ${a}`).join("\n")}` : ""}
- field notes: ${p.notes}`;
};

const checkSystem = (provider: string | undefined): string => {
  const gates = criticalGatesFor(provider);
  return `You are the spec gate of a photoreal video-prompt studio. The user typed a draft request for a short video, possibly followed by answers to earlier gate questions. Decide which CRITICAL decision gates are still unresolved, and whether the draft fits the target provider.

CRITICAL GATES (in priority order):
${gates.map((g) => `- ${g.id}: ${g.question} — why it matters: ${g.why}`).join("\n")}
${profileBlock(provider)}

Rules:
- A gate is RESOLVED when the draft or ANY answer pins it down explicitly or strongly implies it (e.g. "a TikTok clip" resolves 'purpose'; "she reads one line and gasps" implies one-take for 'take-structure').
- 'characters' is resolved by at least one name-able subject with a look; 'cut-board' by any rough per-cut timing/action (the assembler formats it properly). For a one-take clip with ≤2 spoken lines, 'take-structure' being answered resolves 'cut-board' too.
- Do not re-ask gates that already have an answer, even a loose one — the assembler fills craft details.
- "note": ONE short line naming non-critical defaults you will apply (e.g. dialogue language defaulting to English body / Korean lines kept). Empty string if none.
- "warnings": short lines ONLY for real provider-fit problems found in the draft/answers per the provider profile above (duration over the cap, a format the provider is known to break on). Empty array if none.

Return STRICT JSON only: {"missing": ["gateId", ...], "note": "...", "warnings": ["...", ...]} — 'missing' uses only ids from the list above, in the listed order, empty array when all critical gates are resolved.`;
};

const assembleSystem = (
  provider: string | undefined,
  targetSeconds: number,
  aspect: string,
): string => {
  const p = provider ? MODEL_PROFILES[provider] : undefined;
  const hints = [
    ...(p?.assembleHints ?? []),
    ...(p?.promptLanguage === "english-only"
      ? ["EVERYTHING including spoken lines must be English on this provider — translate Korean lines, keep their energy."]
      : []),
    ...(p?.avoid?.length
      ? [`Never steer the output toward these known-breaking patterns for this provider: ${p.avoid.join("; ")}.`]
      : []),
  ];
  return `You assemble photoreal video-generation prompts following a strict 15-section discipline (spec v${SPEC_VERSION}). The prompt body is ALWAYS English${p?.promptLanguage === "english-only" ? "" : "; spoken dialogue lines may stay Korean when the user wrote them in Korean"}.

THE 15 SECTIONS — every one must appear, in this order, as a labeled block ("STYLE:", "FORMAT:", …):
${SECTIONS.map((s, i) => `${i + 1}. ${s.key.toUpperCase()} — ${s.requires}`).join("\n")}

Hard rules:
- Target: a ${targetSeconds}s clip, aspect ${aspect}.
- ACTION is a timecoded cut board: "CUT N (0:00–0:02): camera / action / ONE spoken line in quotes". Total quoted dialogue ≤ ${Math.floor(targetSeconds * 2.5)} words (2.5 words/sec budget, respect per-character pace contracts). Include one no-dialogue b-roll cut. End on a held pose — write "do not end abruptly".
- Double-lock every fragile state (one-take, held expression, open-top, wardrobe): "from first frame to last" AND "in no cut".
- Never write the prompt as a bare "NAME: line" script — dialogue lives inside described cuts (screenplay-only formatting makes models render burned subtitles).
- Name the character(s) and lock them: "Same {NAME}, no identity drift", wardrobe/set constancy.
${hints.map((h) => `- PROVIDER (${provider}): ${h}`).join("\n")}
- Quality bar: the two canonical references (supercar owner vlog / RENA idol BTS vlog) — the assembled prompt must read at that level of specificity regardless of how terse the draft was.
- 2000–4000 characters total. Output ONLY the finished prompt text — no quotes around it, no markdown fences, no commentary.`;
};

interface GeminiBody {
  system: string;
  user: string;
  json: boolean;
  maxTokens: number;
  imageParts?: Array<Record<string, unknown>>;
}

async function gemini(key: string, b: GeminiBody): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${REFINER_MODEL_ID}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: b.system }] },
        contents: [
          { role: "user", parts: [{ text: b.user }, ...(b.imageParts ?? [])] },
        ],
        generationConfig: {
          temperature: b.json ? 0.1 : 0.4,
          // Full token budget goes to the answer (same MAX_TOKENS-empty
          // failure mode as /api/refine — see the comment there).
          maxOutputTokens: b.maxTokens,
          thinkingConfig: { thinkingBudget: 0 },
          ...(b.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
}

const textOf = (data: unknown): string | undefined =>
  (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set — see README.md" },
      { status: 500 },
    );
  }

  let mode: unknown, draft: unknown, answers: unknown, provider: unknown;
  let targetSeconds: unknown, aspect: unknown, context: unknown, images: unknown;
  try {
    ({ mode, draft, answers, provider, targetSeconds, aspect, context, images } =
      await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (mode !== "check" && mode !== "assemble") {
    return Response.json(
      { error: 'mode must be "check" or "assemble"' },
      { status: 400 },
    );
  }
  if (typeof draft !== "string" || !draft.trim()) {
    return Response.json({ error: "Draft is empty" }, { status: 400 });
  }
  const answerList: SpecAnswer[] = Array.isArray(answers)
    ? answers
        .filter(
          (a): a is SpecAnswer =>
            a &&
            typeof a === "object" &&
            typeof a.id === "string" &&
            typeof a.answer === "string" &&
            a.answer.trim().length > 0,
        )
        .slice(0, 20)
    : [];
  const prov = typeof provider === "string" ? provider : undefined;
  const profile = prov ? MODEL_PROFILES[prov] : undefined;
  const secs = Math.min(
    profile?.maxSeconds ?? 60,
    typeof targetSeconds === "number" && targetSeconds >= 1
      ? Math.min(60, Math.round(targetSeconds))
      : 8,
  );
  const ratio = typeof aspect === "string" && aspect ? aspect : "9:16";

  const gates = criticalGatesFor(prov);
  const gateById = new Map(gates.map((g) => [g.id, g]));
  const answerBlock = answerList.length
    ? `\n\nGATE ANSWERS SO FAR:\n${answerList
        .map((a) => {
          const q = gateById.get(a.id)?.question ?? a.id;
          return `- ${a.id} ("${q}"): ${a.answer.slice(0, 500)}`;
        })
        .join("\n")}`
    : "";
  // Attached-reference context (card prompts, pinned-take prompts…) — lets
  // the checker resolve gates an attachment already answers (a character
  // card IS the 'characters' answer) and grounds the assembler.
  const ctxBlock =
    typeof context === "string" && context.trim()
      ? `\n\nATTACHED REFERENCES (already provided by the user — treat gates they answer as RESOLVED; ground the prompt in them):\n${context.slice(0, 6000)}`
      : "";
  // Spec prompts are 2–4k chars; drafts can be long too. NO 900-char clamp
  // on this track — only a sanity ceiling far above real use.
  const user = `DRAFT (the user's request, verbatim):\n${draft.slice(0, 8000)}${ctxBlock}${answerBlock}\n\nTarget: ${secs}s, aspect ${ratio}.`;

  // Reference frames, same shape/caps as /api/refine — Gemini is
  // multimodal; the video model itself never sees these here.
  const imageParts: Array<Record<string, unknown>> = [];
  if (Array.isArray(images)) {
    for (const im of images.slice(0, 8)) {
      if (
        im &&
        typeof im === "object" &&
        typeof (im as Record<string, unknown>).base64 === "string" &&
        typeof (im as Record<string, unknown>).mimeType === "string" &&
        (im as { base64: string }).base64.length <= 4_000_000
      ) {
        const { base64, mimeType } = im as { base64: string; mimeType: string };
        imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
      }
    }
  }

  const res = await gemini(
    key,
    mode === "check"
      ? { system: checkSystem(prov), user, json: true, maxTokens: 1024, imageParts }
      : {
          system: assembleSystem(prov, secs, ratio),
          user,
          json: false,
          maxTokens: 4096,
          imageParts,
        },
  );
  if (!res.ok) {
    let msg = `Spec ${mode} error (HTTP ${res.status})`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    return Response.json({ error: msg }, { status: 502 });
  }

  const data = await res.json();
  const text = textOf(data);
  if (!text) {
    const finish = (data as { candidates?: { finishReason?: string }[] })
      ?.candidates?.[0]?.finishReason;
    return Response.json(
      {
        error: `Spec ${mode} returned no text — try rephrasing the draft.`,
        finishReason: finish ?? null,
      },
      { status: 502 },
    );
  }

  if (mode === "assemble") {
    return Response.json({ prompt: text, specVersion: SPEC_VERSION });
  }

  // check — validate the model's JSON against the real gate ids so a
  // hallucinated id can never wedge the interview loop.
  let verdict: SpecVerdict;
  try {
    const parsed = JSON.parse(text) as {
      missing?: unknown;
      note?: unknown;
      warnings?: unknown;
    };
    const answered = new Set(answerList.map((a) => a.id));
    // One-take (≤2 lines) resolves the cut board BY DEFINITION (the mono
    // rule) — enforce deterministically; the LLM sometimes misses it.
    const oneTake = answerList.some(
      (a) => a.id === "take-structure" && /one.?take/i.test(a.answer),
    );
    const missing = (Array.isArray(parsed.missing) ? parsed.missing : [])
      .filter(
        (id): id is string =>
          typeof id === "string" &&
          gateById.has(id) &&
          !answered.has(id) &&
          !(oneTake && id === "cut-board"),
      )
      .slice(0, gates.length);
    verdict = {
      missing,
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 300) : "",
      warnings: (Array.isArray(parsed.warnings) ? parsed.warnings : [])
        .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        .slice(0, 6)
        .map((w) => w.slice(0, 300)),
    };
  } catch {
    return Response.json(
      { error: "Spec check returned malformed JSON — try again." },
      { status: 502 },
    );
  }
  return Response.json({ ...verdict, specVersion: SPEC_VERSION });
}
