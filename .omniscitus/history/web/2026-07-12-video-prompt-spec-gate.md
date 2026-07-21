# Video Prompt Spec Gate

**Participants**: Danial Nam, claude

## Summary
The owner's photoreal prompt discipline (15-section template + timecoded cut
board) productized as a pre-generation gate: spec-check interview → assembled
spec prompt → verbatim generate. Includes the gitignored Spec Lab A/B arena,
Gemini-key onboarding UX, and reference pass-through.

## Context
- **Background**: Free-typed prompts fail in known ways (burned subtitles,
  storyboard panels, 2× speech). The discipline proven in the mono repo's
  `/mkt-make-video-prompt` skill (supercar/RENA references on Seedance 2.0 /
  Veo 3.1) moved into ZCLIP, where the owner iterates fastest.
- **Requirements**: separate track from refine (NO 900-char clamp; spec prompts
  run 2–4k chars); one question card per turn (chips + free text); "skip
  checks, run as typed" always visible; assembled prompt → /api/generate
  VERBATIM (no refine on top); per-model adaptation via MODEL_PROFILES;
  Spec Lab entirely in gitignored /app/lab + /lab (repo is OSS — zero lab code
  ships, imports one-way lab→lib).
- **Decisions**: conversation layer stays on Gemini Flash (same ONE key as
  refine — a cheaper second-provider mini model saves <1% of a take and adds
  key friction; assembly is the arm to UPGRADE, only via a Spec Lab win).
  Deterministic rules live in code, not prompts (one-take ⇒ cut-board
  resolved; chips clamp to maxSeconds; hallucinated gate ids filtered).
  SSOT moved INTO ZCLIP same day — mono skill retired (owner call, GUI wins);
  lib/video-prompt-spec.ts is the single source of truth, bumps gated by Spec
  Lab wins. References ride the interview (attachments are not a separate
  mode); bundle parks in memory (specRefsRef), reload ⇒ loud refusal, never
  silent billing without refs. Performance transfer stays classic-flow: video
  ref on a non-clip-reading model auto-bypasses SPEC (Seedance 2.0 keeps it).
  Key onboarding: pitch modal on key-less text send; decline = as-typed
  verbatim fallback (remembered); SPEC button is the permanent re-entry.
  Interview UI = IN-COMPOSER stepper, never thread cards (owner: "위에서
  확인하는 거 싫음") — the interview persists nothing until Generate, and
  the finished spec prompt renders open in the thread (clamped + modal).
- **Constraints**: UI thread flow can't be tested headlessly — the store is
  file-backed (.zclip-data) and shared with the owner's live session (live-
  state incident rule: read-only checks only). Money paths (/api/generate)
  never auto-triggered; pitch modal untested live (owner's key is set).
  Seedance-2 model switch mid-interview keeps the ⚠ look≠motion warning as
  the transfer-bypass fallback.

## Timeline

### 2026-07-12
**Focus**: Full P0+P1 build — handoff commit → /api/spec-check → gate cards →
verbatim generate → Spec Lab → key onboarding → refs-ride → SSOT move.
- Committed mono handoff (docs/VIDEO-PROMPT-SPEC.md, lib/video-prompt-spec.ts
  1.0.0, .gitignore lab folders) then the structured MODEL_PROFILES update.
- /api/spec-check: check → strict-JSON {missing, note, warnings} validated
  server-side; assemble → 15-section prompt (maxOutputTokens 4096); both
  provider-aware (promptLanguage/maxSeconds/avoid/assembleHints/extraGates)
  and multimodal (card prompts as context, frames as parts).
- Studio: SPEC composer toggle; gate/preview cards as Turns with `kind`
  (rewind/sessions unchanged; all take-numbering sites filter !t.kind via
  takeNo()); model switch replaces an open card and re-checks under the new
  profile; self-checks annotate the preview mechanically (lib/spec-check.ts).
- Spec Lab at /lab: live vs snapshot on one brief, 2× cost shown up front,
  side-by-side, winner → /lab/ledger.json + paste-ready CHANGELOG line.
  Verified isolation: zero tracked-file references (grep), git check-ignore,
  isCloud() 404 belt.
- Key onboarding modal (owner's 4-step UX) + as-typed fallback for decliners;
  sendGuarded confirm matrix fixed (every money path confirms exactly once —
  including a pre-existing empty-text bypass hole).
- Live verification (text-only, free): missing shrinks with answers; grok/veo
  profile warnings fire; card context ⇒ missing:[] (no re-asking what an
  attachment answers); assemble 2.4–3.3k chars; /lab routes + page render.

**Learned**: deterministic rules belong in code — Gemini kept missing the
"one-take ⇒ cut-board resolved" rule at temp 0.1 until the route enforced it.
Reference bytes can't survive the thread (5MB quota), so park-in-memory +
loud-refusal-on-loss (retryTurn precedent) beats silently regenerating.

### 2026-07-12 (cont. — in-composer stepper + model guide)
**Focus**: Owner UX revision — the interview moves from thread cards into
the composer itself; plus a market-reputation Guide in the model picker.
- Stepper (`SpecFlowState`: checking → asking → assembling → review) lives
  in the composer: one question at a time (chips single-select + OK
  confirm, textarea for long-text gates), loud animated loading lines
  (replaces the passive "thinking…" placeholder), review step with clamped
  prompt + self-checks + cost + Generate, skip hatch everywhere, ✕ returns
  the draft. Thread question cards deleted (legacy `kind` turns skipped at
  render); spec takes show their prompt OPEN (max-height + ⤢ full-view/
  copy modal, `fromSpec`). Commit c1bf70b.
- Architectural win: the interview writes NOTHING to turns/store until
  Generate — in-memory, dies with reload alongside the ref bundle (lost-
  refs guard removed) — which made it headless-testable against the live
  dev server for the first time (exercised: send → loading → chip answer
  → "1 ANSWERED" → re-check; zero thread turns, zero spend).
- Model picker "GUIDE ?" (right-aligned under the company chips): per-
  model street rep (Jul 2026 web sweep — Veo cinematic polish, Sora
  physics, Grok #1 i2v arena w/ fast-motion face-softening caveat,
  Seedance control/motion, Act-Two true transfer) blended with ZCLIP
  field notes; dated footnote. Commit 1dddd6b.
- Incident: a python truncation keyed on a comment PREFIX chopped
  studio.tsx to 97 lines (same prefix in two comments) — recovered via
  git checkout + full re-apply. Rule going forward: unique anchors +
  content asserts, or the Edit tool.

**Learned**: moving ephemeral flows OUT of persisted state (turns → in-
memory stepper) deleted a whole class of edge cases (rewind exceptions,
lost-bundle refusal) AND unlocked safe live testing — persistence scope is
a design lever, not a given.

### 2026-07-12 (cont. 2 — composer layout)
**Focus**: Chat bar row → column (owner: long Korean drafts were getting
squeezed between attach/SPEC/Send).
- Full-width textarea on top; `.chat-bar-actions` row below — attach (+)
  left, SPEC + Send right-aligned; 8px vertical gap. Minimal diff: JSX
  moved attach+file-input into the action row, CSS just
  `flex-direction: column` + one flex row. Stepper/dnd/paste untouched.
  Commit cb027fe. Verified with a live screenshot (Korean long draft
  spans the full bar width).
- Stepper carded (owner: "하나의 내용이란 게 보이도록") — accent-tinted
  border + subtle bg + soft lift so the interview reads as one contained
  unit instead of floating text. Commit e527cfd, screenshot-verified.

**Learned**: none

### 2026-07-13
**Focus**: CHASE reference intake → 1.0.1/1.0.2, Spec Lab goes real —
modes, cast lock, first verdicts (null result), review loop live.
- CHASE fan-meeting vlog intake (frame-verified): @ image token +
  image-owns-identity + script-lines-safe → seedance profile (1.0.1);
  structural ideas → /lab snapshot 1.1.0-storyboard. Self-check accepts
  "camera lingers" endings.
- Arena field failures fixed (1.0.2): Veo celebrity-likeness hard block →
  fictional-names rule + veo avoid; 16k-char Gemini ramble → compress-
  retry backstop; generate cap 4000→6000; lab poll missed state "error"
  (spun as RENDERING forever).
- Lab matured: MODEL A/B mode (same prompt, two models), verdict note
  input, per-run CAST LOCK (random but identical subject both arms,
  gender-matched — controls the casting variable), English test-brief
  presets (🎲), grok as default judge (owner principle: cheapest capable
  model first; ~$1.38/8s pair).
- First real verdicts: 1.0.2 vs storyboard on Grok @4s = tie, variance
  dominates → candidate stays parked (improvement gate); methodology
  distilled to grok profile ("judge structure on ≥8s multi-cut briefs").
  /spec-lab-review skill (personal, ~/.claude) + /lab/experiments.jsonl
  journal + cursor now form the record→distill loop.
- Shipped in v0.4.0 (see flow-method-kling unit for the release itself).

**Learned**: an A/A run (live vs baseline) doubles as a noise-floor
measurement — without it, the storyboard tie would have been ambiguous.
Null results earn their keep when the methodology lesson ships somewhere
queryable (the model profile), not just the journal.

## Pending
- [x] First real-money spec take — done 2026-07-13 on Grok (not Sora): spec
      A/B arena pair (1.0.2 vs 1.1.0-storyboard, cast:Noa reference rode
      through) + studio spec takes (lab/ledger.json, experiments.jsonl)
- [ ] Key-less onboarding flow one real pass (pitch modal untested live)
- [x] Release: shipped as v0.4.0 2026-07-13 (package.json bump + CHANGELOG
      entry + git tag v0.4.0, main pushed to origin)
- [x] Transfer-in-SPEC question — resolved by AUTO-BYPASS (video ref on a
      non-clip-reading model skips SPEC into the classic transfer flow;
      Seedance 2.0 keeps SPEC); porting transcription into assemble stays
      a future option only if the bypass proves annoying
- [x] Eyeball the stepper's REVIEW step — owner ran real spec takes
      through it on 2026-07-13 (arena + studio)
- [ ] Refresh the model-picker GUIDE + MODEL_PROFILES notes as real
      billed tests land (guide is dated Jul 2026 market chatter)
- [ ] Storyboard candidate decisive test: ONE ≥8s multi-cut pair on Grok
      (~$2.50) — else retire it to Seedance hints permanently
- [ ] SPEC 1.1.0 (2026-07-20, CHASE camcorder ref)의 미룬 검증 2건 —
      additive 변경(회귀 0, 오너 verdict)은 A/B 없이 ship했으나 진짜 flip은
      게이트가 남음:
      ① "8K photoreal DEFAULT → 완전 genre-driven" FLIP을 /lab/snapshots
         후보로 만들어 캠코더/lo-fi 브리프로 A/B (지금은 lo-fi OVERRIDE만
         additive 삽입 — photoreal baseline 불변)
      ② `subject` modesty=filter-safety 가설(n=1)은 화질 arena가 아니라
         "필터 통과율" 테스트로 검증 — depth 실인물 필터 작업
         ([[depth-transfer-pipeline]])과 같은 계열, 통과/실패 이진 측정

## Notes
Docs trail: DEVLOG #27–#29, docs/VIDEO-PROMPT-SPEC.md (kept current),
CLAUDE.md spec section. Commits 2a87f73 → 0bdca45 on main. Spec Lab data in
gitignored /lab (README there explains snapshot format + workflow).
