# Flow Method & Kling Provider

**Participants**: Danial Nam, claude

## Summary
The FLOW method — a still→motion pipeline living beside the chat method
(CHAT|FLOW toggle, shared left frame): confirm a look once, iterate motion
forever. Plus the Kling 3.0 provider, three image engines with Gemini
edit-in-place, and the v0.4.0 release that shipped the week's work.

## Context
- **Background**: Market pattern the owner spotted (image model → Kling
  motion → publish at scale, "AI beauties" monetization threads) — ZCLIP
  needed a pipeline method where the LOOK is locked and only MOTION
  iterates, vs the chat loop where every take re-rolls everything.
- **Requirements**: per-stage prompts + confirm gates; a confirmed still
  never re-rolls while motion iterates; stage models swappable with
  recommendations (Kling ★); maximum interop with the chat method (shared
  Library/spend, stills → Character cards); started as /flow page, owner
  redirected to an in-studio method toggle sharing the left preview frame
  ("별도 페이지는 낭비").
- **Decisions**: references/edit via Gemini 2.5 Flash Image (only wired
  engine with native editing — a reference forces the gemini path
  regardless of selected engine); flows belong to their chat session
  (sidebar ⇶ badge); Character-card saves never overwrite (numeric
  suffix); Kling adapter built UNVERIFIED from public docs (JWT AK:SK per
  request, 5/10s grid, jobId carries the endpoint for polling) — Seedance
  precedent; image presets neutral-cast ("Korean idol" placeholder →
  "woman in her 20s"), background micro-faces avoided in presets (i2v
  wiggle + Seedance real-person filter + ad distraction); money always
  behind two-step inline confirms (browser dialogs banned).
- **Constraints**: Seedance 2.0 rejects real-person-looking image inputs —
  photoreal Flow stills should go to Grok/Veo/Kling for motion; Kling
  needs a separate API plan (key not yet acquired — adapter's first real
  run pending); Grok weak on dialogue acting (talking clips → Veo for
  native audio); face identity is not pinned across still generations
  (gacha) — mitigations: Edit look keeps the person, Character cards
  freeze a face.

## Timeline

### 2026-07-13
**Focus**: Full build — /flow page → studio-embedded method, 3 image
engines + edit, Kling provider, interop, v0.4.0 release.
- /api/image: Grok/GPT/Gemini engines behind existing keys, expiring
  provider URLs downloaded server-side → durable base64; reference image
  ⇒ Gemini EDIT mode (frame-verified live: Korean instruction swapped
  only the outfit, face/room preserved).
- FlowPanel embedded in the studio (CHAT|⇶FLOW pills; chat surfaces hide
  via CSS; flow drives the shared left frame; rail ⇶ button removed as
  redundant). Stage 1: prompt/🎲 presets/upload → attempts grid → CONFIRM
  → ✎ edit-from-look context chip; Stage 2: motion-only prompt, model/
  aspect/res/duration always visible, attempts poll → vault → shared
  gallery (sessionId = flow id keeps chat spend clean).
- Flows scoped to sessions (legacy flows visible everywhere); sidebar
  ⇶ badge; delete via confirmation modal (Library takes survive);
  Save-as-Character-card auto-numbers ("Flow 1 · 2").
- Kling: kling-v3 adapter (UNVERIFIED), KLING_API_KEY="AK:SK",
  effectiveSeconds 5/10 snap, GUIDE "Volume king" entry, MODEL_PROFILES
  motion-first hint. First run attempt correctly errored on missing key.
- Ops: owner port move 3000→3333 (docs/memory updated; file store made it
  data-safe); repeated external SIGTERMs killed dev servers → supervisor
  loop with death logging; corrupted .next caused /chat 404 once (clean
  rebuild fixed); Library card actions wrapped (Remove was clipped);
  per-clip PERMANENT delete (file+entry, confirmation modal); chat-bar
  column layout; spend popover scoped to session; fashion pill unhidden
  mid-thread.
- Release v0.4.0: CHANGELOG (public features only — lab/journal excluded),
  tag + GitHub release + prod deploy; /api/version serves 0.4.0; prod /lab
  404 (isolation holds). How-to guide +2 steps (SPEC, FLOW; EN/KO);
  README + provider table (Kling row) + SPEC/FLOW feature bullets.

**Learned**: per-stage confirm gates + an in-memory-until-money design
made the pipeline safe to test live; "reference forces the edit-capable
engine" beats asking users to know which model can edit. Legal note
discussed: liability for lookalike outputs sits with the publisher, not
the tool — identifiability is the test, so neutral-cast presets +
fictional-name rules are product-level mitigations.

## Pending
- [ ] Kling first real run (needs API plan + AK:SK key) — verifies the
      adapter, unlocks ~$0.48/10s arena pairs and the ★ default
- [ ] Veo native-audio run for talking clips (app-recommendation prompt)
- [ ] Consider identity-pinned still regen (same face, new scene) beyond
      Edit look — e.g. Character card as image ref in /api/image
- [ ] Flow motion presets: promote proven field prompts (o-face soft/
      dramatic variants) into MOTION_PRESETS

## Notes
DEVLOG #32 (build), release efcb180 + tag v0.4.0. Related unit:
video-prompt-spec-gate (SPEC gate + Spec Lab; same-day arena methodology).
Reference intake: CHASE room vlog (grab-1783916171883) shaped the bedroom
preset; o-face.mp4 shaped the surprise motion prompts.
