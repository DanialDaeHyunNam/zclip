/**
 * ── VIDEO PROMPT SPEC (SSOT) ─────────────────────────────────────────
 * Photoreal video-prompt discipline. THIS FILE IS THE SINGLE SOURCE OF
 * TRUTH — originally ported from the mono repo's skill, but as of
 * 2026-07-12 the owner manages the spec here only (the mono skill is
 * retired; no cross-repo sync).
 *
 * Change contract:
 * - Rule change → edit here → bump SPEC_VERSION (minor; flow/breaking =
 *   major) → add a CHANGELOG line below.
 * - A change ships only when confirmed better than before — a Spec Lab
 *   win (/lab, owner-only A/B arena) or an explicit owner verdict,
 *   never on plausibility alone. Unverified ideas stay in MODEL_PROFILES
 *   `notes` as experimental, not in GATES/SECTIONS.
 *
 * Wired into the product (2026-07-12): /api/spec-check + the studio's
 * SPEC gate cards consume SECTIONS/GATES/MODEL_PROFILES; the preview
 * card runs SELF_CHECKS via lib/spec-check.ts. Docs: docs/VIDEO-PROMPT-SPEC.md.
 */

export const SPEC_VERSION = "1.0.1";
// CHANGELOG
// 1.0.1 (2026-07-13) — Seedance 2.0 profile enriched from the CHASE fan-
//         meeting vlog reference (owner-supplied prompt + frame-verified
//         output): @ image token, image-owns-identity, script-lines-safe.
//         PROFILE-ONLY — GATES/SECTIONS untouched (structural candidates
//         went to /lab/snapshots for A/B per the improvement gate).
// 1.0.0 (2026-07-12) — initial port from mono SKILL.md (supercar 15-section
//         template + RENA multi-cut grammar + model cheatsheet).

// NOTE: spec-version SNAPSHOTS (for the owner-only A/B Spec Lab) do NOT
// live in this file — the Spec Lab feature is owner-internal and the repo
// is going open source, so the entire feature (routes, UI, snapshots,
// verdict ledger) lives in the gitignored `/lab` + `/app/lab` folders.
// This file carries ONLY the live spec that the public product gate uses.
// Import direction is one-way: lab → lib, never lib/app(core) → lab.

/** One of the 15 required sections of a photoreal video prompt. */
export interface SpecSection {
  key: string;
  /** What the section must pin down. */
  requires: string;
  /** Canonical example fragment (from the supercar / RENA references). */
  example?: string;
}

export const SECTIONS: SpecSection[] = [
  { key: "style", requires: "8K photoreal + negatives NAMED AS GENRES (no 3D render / game engine / cutscene / ad-CG / music-video grading)" },
  { key: "format", requires: "anchor to ONE specific real video genre (e.g. 'K-pop idol YouTube behind-the-scenes vlog'); camera gear must never be visible; if one-take: forbid cuts/split-screen/storyboard/on-screen text with a double lock" },
  { key: "lighting", requires: "light source + direction (e.g. vanity bulbs as key, golden hour)" },
  { key: "color", requires: "60:30:10 palette with concrete main/secondary/accent" },
  { key: "lens", requires: "physical lens traits, focal feel, 180-degree shutter motion blur" },
  { key: "skin", requires: "pores, vellus hair, real wrinkles where age-appropriate; forbid plastic skin / beauty filter / smoothing" },
  { key: "acting", requires: "micro-specs: eye-contact beats, breathing (chest rise), tiny laughs, 'never posed-frozen'" },
  { key: "physics", requires: "gravity & inertia: hair bounce, fabric sway, prop weight, contact shadows" },
  { key: "continuity", requires: "named character canon lock — 'Same {NAME}, no identity drift' — plus wardrobe/set constancy" },
  { key: "technical", requires: "24fps, no jitter/glitch" },
  { key: "audio", requires: "no BGM / no subtitles + ambience list + DIALOGUE LAYER (on-camera vs voiceover; mouth closed during VO) + per-character speech-pace contract" },
  { key: "subject", requires: "full character spec (age/build/hair/skin/outfit/accessories); name them" },
  { key: "scene", requires: "location declared as FIXED CANON (not style reference) + named recurring props" },
  { key: "action", requires: "CUT N (0:00–0:02) timecoded board; ≤1 spoken line per ~2s cut; one no-dialogue b-roll cut; ending pose hold ('do not end abruptly')" },
  { key: "camera", requires: "restate viewpoint + forbidden moves (dolly/drone/third-person switch/exterior tracking)" },
];

/** Decision gates to resolve IN CONVERSATION before assembling the prompt.
 *  Mirrors the mono skill's STOP gates (format → characters → cut board). */
export interface SpecGate {
  id: string;
  question: string;
  /** 2–4 quick-reply options; free text always allowed. */
  options: string[];
  critical: boolean;
  why: string;
}

export const GATES: SpecGate[] = [
  {
    id: "purpose",
    question: "What is this clip for — platform과 길이?",
    options: ["TikTok 15s", "Reels 15s", "Shorts 8s", "hook 3–4s"],
    critical: true,
    why: "Length decides cut budget; platform decides aspect.",
  },
  {
    id: "take-structure",
    question: "One-take or multi-cut?",
    options: ["multi-cut (dialogue ≥3 lines)", "one-take (≤2 lines)"],
    critical: true,
    why: "Speech pace is enforced by CUT TIME BUDGET, not by instructions. 5 dialogue lines crammed into a one-take = everyone fast-forwards.",
  },
  {
    id: "genre-anchor",
    question: "Which REAL video genre is this imitating?",
    options: ["idol BTS vlog", "street selfie vlog", "candid fixed-cam sitcom", "supercar owner self-cam"],
    critical: true,
    why: "A specific existing genre imports its whole camera grammar for free.",
  },
  {
    id: "characters",
    question: "Who is on screen? (name + look + speech-pace per person)",
    options: [],
    critical: true,
    why: "Names are the canon lock ('Same RENA, no identity drift'). Speech contract per character (e.g. slow English / explosive Korean slang).",
  },
  {
    id: "cut-board",
    question: "Cut board — per cut: time / camera / action / ONE line",
    options: [],
    critical: true,
    why: "≤2.5 words/sec real budget. Include one no-dialogue b-roll cut and an ending hold.",
  },
  {
    id: "dialogue-language",
    question: "Dialogue language(s)?",
    options: ["English only", "English + Korean words", "Korean only"],
    critical: false,
    why: "Prompt body in English for all providers; spoken lines can stay Korean.",
  },
];

/** Pre-submit self-checks (mechanical — run on the assembled prompt). */
export const SELF_CHECKS: string[] = [
  "Subtitle/split-screen/storyboard/gear bans present",
  "Total dialogue words ≤ seconds × 2.5 (respect per-character pace contracts)",
  "Fragile states (one-take, open-top, held expression) double-locked: 'from first frame to last' + 'in no cut'",
  "Ending hold present ('do not end abruptly')",
  "Screenplay-format-only prompt? NO — bare 'A: … / B: …' scripts make some models render burned subtitles/storyboards",
  "Named character + 'no identity drift' clause present",
];

/**
 * ── PER-MODEL PROFILES (structural, not just notes) ──────────────────
 * The gate flow consumes these: the spec check validates against the
 * SELECTED provider, gate questions adapt (extraGates / duration bounds),
 * and prompt assembly appends assembleHints for that provider. Switching
 * the model re-runs the check against the new profile.
 * Keys match ProviderName in lib/config.ts. Field-test learnings go here
 * (date-stamped in `notes`); structural learnings get their own field so
 * the machine can act on them.
 */
export interface ModelProfile {
  /** Prompt body language. Spoken lines may still be Korean either way. */
  promptLanguage: "english-only" | "any";
  /** Hard duration cap the purpose/cut-board gates must respect (sec). */
  maxSeconds?: number;
  /** Formats that break this provider — spec check must flag them. */
  avoid?: string[];
  /** Lines appended to the assembly system prompt for this provider. */
  assembleHints?: string[];
  /** Extra gate questions to ask ONLY for this provider. */
  extraGates?: SpecGate[];
  /** Free-text, date-stamped field-test log (human-readable history). */
  notes: string;
}

export const MODEL_PROFILES: Record<string, ModelProfile> = {
  veo: {
    promptLanguage: "any",
    maxSeconds: 8,
    avoid: ["selfie compositions relying on visible extended arm (double-arm anatomy artifacts on fast/basic tiers)"],
    assembleHints: [
      "Keep the cut list explicit and short; Veo's pipeline may rewrite prompts (enhance_prompt), so front-load hard bans in the first lines.",
    ],
    notes:
      "2026-07-12 — Veo 3.1 fast: followed cut structure + props well at 22cr/8s (Higgsfield). Selfie-arm anatomy artifact observed (double arm, 2026-07-11); reroll or raise quality tier.",
  },
  sora: {
    promptLanguage: "any",
    notes: "untested with this spec — first candidate to calibrate in ZCLIP.",
  },
  grok: {
    promptLanguage: "english-only",
    avoid: [
      "screenplay-format dialogue lists (renders burned subtitles + storyboard panels)",
      "dialogue-heavy comedy (acting/voice quality below bar, 2026-07-11)",
    ],
    assembleHints: [
      "Prompt body strictly English (Korean-language prompts failed outright).",
      "Fold dialogue into prose action descriptions rather than 'A:'/'B:' script lines.",
    ],
    notes:
      "2026-07-11 — obeys structure once genre anchor + bans are set, but acting/voice below bar for dialogue comedy. Korean prompt body = hard fail.",
  },
  seedance: {
    promptLanguage: "any",
    assembleHints: [
      "Seedance 2.0 with an attached image reference: reference it INLINE as '@ image' where the subject first appears (e.g. 'a female idol @ image'), and let the IMAGE own identity — describe wardrobe/energy/vibe in text, never fight the image on face or hair (frame-verified: text hair description lost to the image).",
      "Seedance 2.0 tolerates script-style dialogue lines inside cut descriptions ('NAME: \"line\"' + parenthetical voice direction, incl. off-screen) without rendering burned subtitles — keep the lines inside described cuts anyway.",
    ],
    notes:
      "ZCLIP has Seedance 1.0 Pro — UNVERIFIED; reference-grade results are Seedance 2.0 (RENA repro; CHASE fan-meeting vlog 2026-07-13, 15s/1080p/24fps, frame-verified). EXPERIMENTAL from the CHASE reference, pending Spec Lab A/B (candidate snapshot 1.1.0-storyboard): narrative logline → beat-rhythm arrow line → Characters → Storyboard structure WITHOUT labeled 15-section blocks or negative bans hit reference grade on 2.0; per-cut '(Cut N · ~2 sec · shot type)' headers instead of absolute timecodes; camera-relative spatial blocking ('on camera left… behind… on the right') made a whip pan hit its exact targets and locked prop continuity (mid-video hairpin persisted); 'camera lingers half a beat' works as the ending hold; bubbly-vlog pacing survived ~2.9 words/sec (over the 2.5 budget). None of this is proven on Veo/Grok — Grok verifiedly NEEDS the bans.",
  },
  runway: {
    promptLanguage: "any",
    notes: "untested with this spec.",
  },
};

/** @deprecated kept briefly for docs references — use MODEL_PROFILES. */
export const MODEL_NOTES: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_PROFILES).map(([k, v]) => [k, v.notes]),
);
