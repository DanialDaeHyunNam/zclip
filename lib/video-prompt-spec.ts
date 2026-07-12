/**
 * ── VIDEO PROMPT SPEC (versioned mirror) ─────────────────────────────
 * Photoreal video-prompt discipline ported from the mono skill:
 *   SSOT  : mono/.claude/skills/mkt-make-video-prompt/SKILL.md
 *   Mirror: this file. Bump SPEC_VERSION when porting SSOT changes.
 *
 * Sync contract (both repos' Claude sessions follow this):
 * - mono SKILL.md is the source of truth for RULES; this file is the
 *   machine-usable mirror for the ZCLIP gate flow.
 * - Any rule change lands in mono first → port here → bump minor.
 *   Flow/breaking change → bump major. Record a line in CHANGELOG below.
 * - An improvement discovered HERE (real takes, user feedback) flows
 *   back to mono SKILL.md before or together with the bump — a change
 *   ships only when confirmed better than before (A/B take or owner
 *   verdict), never on plausibility alone.
 *
 * Not wired into the UI yet — see docs/VIDEO-PROMPT-SPEC.md for the
 * intended gate UX and API design.
 */

export const SPEC_VERSION = "1.0.0";
// CHANGELOG
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

/** Per-provider field notes. Date-stamped; update on every real test. */
export const MODEL_NOTES: Record<string, string> = {
  veo: "2026-07-12 — Veo 3.1 fast: followed cut structure + props well at 22cr/8s (Higgsfield). Watch for selfie-arm anatomy artifacts (double arm, 2026-07-11 take); reroll or raise quality tier. Pipeline force-rewrites prompts (enhance_prompt).",
  sora: "untested with this spec — first candidate to calibrate in ZCLIP.",
  grok: "2026-07-11 — structure obeys the spec (no storyboard once genre+bans set), but acting/voice quality below bar for dialogue comedy. English prompts only (Korean prompt failed).",
  seedance: "ZCLIP has Seedance 1.0 Pro — UNVERIFIED. The reference-grade results (RENA reproduction) were Seedance 2.0 (Higgsfield, 135cr/15s/1080p). Do not assume parity.",
  runway: "untested with this spec.",
};
