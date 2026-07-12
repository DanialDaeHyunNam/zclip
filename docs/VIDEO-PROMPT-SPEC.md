# Video Prompt Spec Gate — implementation brief

> Handoff from the mono repo's `/mkt-make-video-prompt` skill (2026-07-12).
> Data mirror: [`lib/video-prompt-spec.ts`](../lib/video-prompt-spec.ts) (SPEC_VERSION 1.0.0).
> SSOT for the rules: `mono/.claude/skills/mkt-make-video-prompt/SKILL.md`.

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
- Providers: prompt body always English; spoken lines may stay Korean.
  See `MODEL_NOTES` for per-provider caveats (e.g. Grok needs English-only,
  Seedance here is 1.0 Pro, not the verified 2.0).

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
is recorded in a ledger inside `/lab` (file-based like `.zclip-data`, or
localStorage), plus a line the owner pastes into the mono skill's
changelog. A candidate only becomes the live `SPEC_VERSION` after winning
here. Losing candidates stay in history — negative data for MODEL_NOTES.

## Versioning contract (keep this section honest)

- `SPEC_VERSION` in `lib/video-prompt-spec.ts` mirrors the mono skill.
- Rules change in mono first (or flow back to mono when discovered here),
  then get ported + version-bumped here, with a CHANGELOG line.
- **Improvement gate**: a rule changes only when the change is confirmed
  better than before — same-condition A/B takes or an explicit owner
  verdict. Unverified ideas go into MODEL_NOTES / comments as
  "experimental", not into GATES/SECTIONS.
- Both repos' Claude sessions cross-check on update: mono's skill has a
  "구현 미러" pointer to this file; this file points back to the skill.
