/**
 * Reference carry-over mix — the checkboxes on a video-reference chip that
 * say which aspects of the reference the next take should copy and which it
 * must explicitly drop. Unchecked ≠ "unspecified": every choice becomes a
 * labeled hard rule for the prompt refiner (video models otherwise happily
 * reproduce burned-in subtitles as gibberish glyphs).
 */

export interface RefMix {
  motion: boolean;
  camera: boolean;
  background: boolean;
  look: boolean;
  text: boolean;
  audio: boolean;
}

/** Burned-in captions are the one thing nobody wants copied (models can't
 *  render real glyphs, especially Korean) — everything else carries over. */
export const DEFAULT_REF_MIX: RefMix = {
  motion: true,
  camera: true,
  background: true,
  look: true,
  text: false,
  audio: true,
};

/** Saved as the sticky default for future references (hooklab.* prefix kept
 *  for consistency with the other store keys). */
export const REF_MIX_KEY = "hooklab.refMix";

export const REF_MIX_FIELDS: {
  key: keyof RefMix;
  label: string;
  desc: string;
}[] = [
  { key: "motion", label: "Motion & timing", desc: "gestures, expression beats, pacing" },
  { key: "camera", label: "Camera framing", desc: "shot distance, angle, handheld drift" },
  { key: "background", label: "Background & location", desc: "the reference's room / scene" },
  { key: "look", label: "Wardrobe & look", desc: "the performer's outfit and styling" },
  { key: "text", label: "On-screen text & captions", desc: "subtitles / titles burned into the frame" },
  { key: "audio", label: "Speech & sound", desc: "talking, tone — only models with audio output (Veo, Sora)" },
];

export function loadRefMix(raw: string | null | undefined): RefMix {
  try {
    return { ...DEFAULT_REF_MIX, ...JSON.parse(raw ?? "") };
  } catch {
    return DEFAULT_REF_MIX;
  }
}

/** One labeled instruction per aspect — sent to /api/refine as `rules` and
 *  injected verbatim, so keep each line self-contained and imperative. */
export function refMixRules(mix: RefMix): string[] {
  const rules: string[] = [];
  rules.push(
    mix.motion
      ? "Motion & timing: copy the reference's movement, gestures and beat timing."
      : "Motion & timing: do NOT copy the reference's movement — motion comes from the written prompt only.",
  );
  rules.push(
    mix.camera
      ? "Camera framing: copy the reference's shot distance, angle and handheld feel."
      : "Camera framing: do NOT copy the reference's camera — frame the shot per the written prompt.",
  );
  rules.push(
    mix.background
      ? "Background & location: keep the reference's setting."
      : "Background & location: do NOT copy the reference's setting — use the background from the base prompt / attached context instead.",
  );
  rules.push(
    mix.look
      ? "Wardrobe & look: keep the reference performer's outfit and styling."
      : "Wardrobe & look: do NOT copy the reference's outfit or styling — take them from the character / base prompt.",
  );
  // Checked = leave text alone (say nothing); unchecked = scrub it, hard.
  // The video model SEES the reference frames (subtitles included), so the
  // negative must survive into the final prompt text, not just guide the
  // rewrite — hence the explicit carry instruction.
  if (!mix.text) {
    rules.push(
      'On-screen text & captions: REMOVE — the reference\'s subtitles/captions/titles must NOT appear. Write this exact negative into the final prompt: "completely clean frame, no on-screen text, no subtitles, no captions, no titles, no watermarks" (captions are added in post).',
    );
  }
  rules.push(
    mix.audio
      ? "Speech & sound: the subject talks naturally like the reference (models with audio output should render natural speech)."
      : "Speech & sound: silent performance — no talking, mouth stays natural but no speech.",
  );
  return rules;
}

/** Short chip/manifest summary, e.g. "drops: on-screen text". */
export function refMixSummary(mix: RefMix): string {
  const dropped = REF_MIX_FIELDS.filter((f) => !mix[f.key]).map((f) =>
    f.label.toLowerCase(),
  );
  return dropped.length ? `drops: ${dropped.join(" · ")}` : "carries everything";
}
