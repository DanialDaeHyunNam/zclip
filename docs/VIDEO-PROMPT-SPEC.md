# Video Prompt Spec Gate — implementation brief

> Originally handed off from the mono repo's `/mkt-make-video-prompt`
> skill (2026-07-12). The SAME day the owner retired the mono skill —
> the spec lives HERE only now, managed through the GUI + Spec Lab.
> SSOT: [`lib/video-prompt-spec.ts`](../lib/video-prompt-spec.ts)
> (SPEC_VERSION 1.0.0). No cross-repo sync exists.

## Why

We proved (supercar vlog / RENA idol vlog references, reproduced on Seedance 2.0)
that photoreal output needs a **15-section spec prompt with a timecoded cut
board** — not a one-paragraph description. Free-typed prompts fail in known
ways: burned subtitles, storyboard panels, everyone talking at 2× speed.

ZCLIP is where the owner iterates fastest, so the discipline should live in
the product: when the user types a prompt, **whatever already satisfies the
spec passes through; whatever is missing gets resolved by conversation
before any money is spent.**

## UX (target behavior)

1. User types anything in the studio chat.
2. Before generation, a **spec check** runs (cheap Gemini call, same key as
   refine): the draft is scored against `SECTIONS` + `GATES` from
   `lib/video-prompt-spec.ts` → `{ satisfied[], missing[] }`.
3. Missing **critical gates** render as an inline question card in the chat
   (AskUserQuestion-style): the gate's `question` + 2–4 quick-reply chips
   (`options`) + free-text. One card per turn, accumulate answers into the
   draft. Non-critical gaps get sensible defaults, mentioned in one line.
4. When critical gates pass → assemble the full 15-section prompt
   (Gemini, spec as system prompt) → show it as a **preview card** with a
   "generate" confirm + per-model cost estimate (reuse `estimateCostUsd`).
5. Escape hatch always visible: **"skip checks, run as typed"** — never
   trap the user in the interview.
6. `SELF_CHECKS` run mechanically on the assembled prompt (string checks
   where possible) and annotate the preview card.

## Implementation pointers (this repo)

- New route `app/api/spec-check` (sibling of `refine`): input `{draft,
  answers, history}` → structured JSON verdict. Keep `refine`'s 900-char
  UGC path untouched — spec mode is a separate track for full spec prompts
  (they are 2–4k chars; do NOT clamp to 900).
- Gate cards live in `app/chat/studio.tsx` as a new turn type (alongside
  `Turn`); answers persist in the thread like normal messages so rewind
  works unchanged.
- The assembled spec prompt goes to `/api/generate` verbatim — no refine
  pass on top (Gemini rewriting a finished spec loses the double locks).
- **Per-model adaptation (structural, will grow over time)**: the gate flow
  is provider-aware via `MODEL_PROFILES` in `lib/video-prompt-spec.ts` —
  the spec check validates the draft against the SELECTED provider's
  profile (`promptLanguage`, `maxSeconds`, `avoid` patterns), gate
  questions adapt (duration options clamp to `maxSeconds`; a profile can
  add `extraGates`), and prompt assembly appends that provider's
  `assembleHints` to the system prompt (e.g. Grok: prose dialogue, no
  script lines; Veo: front-load bans because its pipeline rewrites
  prompts). Switching the model re-runs the spec check against the new
  profile. New field-test learnings land as structured fields when the
  machine should act on them, or in `notes` when informational.
  The quality bar for assembled prompts is the two canonical references
  (supercar vlog / RENA idol vlog) — an assembled prompt should read at
  that level regardless of what the user originally typed.

## Spec Lab — owner-only A/B arena (the improvement gate, enforced in UI)

The rule "a spec change ships only when confirmed better" needs a place to
be *confirmed*. That place is the Spec Lab.

**⚠️ Isolation requirement (the repo is going open source):** the entire
feature must live in **gitignored folders** — `/app/lab/` (route + UI) and
`/lab/` (spec snapshots, verdict ledger, helpers). Both are already in
`.gitignore`. An env flag is NOT enough: flag-gated code still ships its
source to every cloner. The public repo must contain **zero Spec Lab
code** — a fresh clone simply has no `/app/lab` folder and therefore no
route. Consequences to respect:

- **Import direction is one-way**: lab files may import from `lib/`
  (`video-prompt-spec.ts`, `config.ts`), but NO tracked file may import
  from `/lab` or `/app/lab` — otherwise every cloner's build breaks.
- Spec-version **snapshots live in `/lab`** (not in `lib/video-prompt-spec.ts`,
  which carries only the live spec the public gate uses).
- Next.js handles the rest naturally: the route exists only on machines
  that have the folder (the owner's).

**What it does**: pick two spec versions (live vs candidate snapshot),
enter ONE user brief → both versions assemble their prompt → generate BOTH
takes (same model/params, 2× cost shown up front) → side-by-side player →
owner picks the winner.

**What the pick does**: the verdict (winner version, brief, model, date)
is recorded in `/lab/ledger.json`. A candidate only becomes the live
`SPEC_VERSION` after winning here — the winning snapshot's changes get
edited into `lib/video-prompt-spec.ts` with a version bump + CHANGELOG
line. Losing candidates stay in history — negative data for
MODEL_PROFILES notes.

## Versioning contract (keep this section honest)

- `lib/video-prompt-spec.ts` is the SSOT — rules change there, with a
  `SPEC_VERSION` bump (minor; flow/breaking = major) and a CHANGELOG line
  in the file.
- **Improvement gate**: a rule changes only when the change is confirmed
  better than before — a Spec Lab win or an explicit owner verdict.
  Unverified ideas go into MODEL_PROFILES `notes` as "experimental", not
  into GATES/SECTIONS.

## References ride the interview (owner decision, 2026-07-12)

Attachments are NOT a separate mode: text + any images/cards/pins →
the spec interview runs AND the references land on the final
`/api/generate` request (same priority rules as the classic flow).
Empty text → classic flow, untouched. Mechanics: the bundle is parked in
memory (`specRefsRef` — reference bytes never enter localStorage), its
text context + frames feed check AND assemble (a character card resolves
the 'characters' gate; the assembler grounds SUBJECT/SCENE in it), and
the preview/gate cards show a "riding along" line. A reload loses the
bundle → generate/skip REFUSE loudly (retryTurn precedent) instead of
silently billing without the user's references.

Performance-transfer routing (owner call): a video reference on a model
that can't read the clip itself AUTO-BYPASSES SPEC for that send — the
classic flow's transfer transcription beat-copies the motion, which the
SPEC cut board would drop. A soft note says so; Seedance 2.0 keeps SPEC
(the model reads motion directly). The bypass is a money path, so it
does NOT skip the pre-spend confirm. Edge kept covered: switching a
started interview onto a non-clip-reading model surfaces a ⚠ "look
carries, motion is not beat-copied" warning on the cards instead.

## Key onboarding (owner's 4-step UX, 2026-07-12)

Text send without `GEMINI_API_KEY` → pitch modal (free key = guided
interview → photoreal spec; saves to `.env.local` like the provider key
panel, then interviews the interrupted draft — saving IS the spec
opt-in). Decline → remembered (`hooklab.specDeclined`); that send and
future key-less sends go to the video model exactly as typed. The SPEC
button next to Send is the permanent re-entry — key-less click reopens
the pitch, even for decliners.
