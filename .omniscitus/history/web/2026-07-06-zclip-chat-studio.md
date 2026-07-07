# ZCLIP Chat Studio

**Participants**: dan, claude

## Summary
Chat-driven UGC reaction-hook video studio (/chat): message → prompt refine →
provider generation → iterate. Sessions, rewind, pinned-take context, continuity
snapshots, multimodal references, spend tracking, in-UI API keys. Plus a GRAB
reference-video toolchain, a `/dashboard` spend page, a model marketplace picker,
Runway Act-Two performance transfer with outfit compositing, and a spend confirm.

## Context
- **Background**: Dan needed to mass-produce the "surprised reaction" first 3s of
  TikTok/Reels UGC ads without filming; built from scratch today (2026-07-06),
  evolved form-tool → chat studio through rapid owner feedback.
- **Requirements**: no backend/DB (localStorage only), thin API proxies keep keys
  server-side, async submit+poll (60–180s renders), visible errors, one-screen UX,
  optional shared password, all 4 providers pre-wired with in-UI key entry.
- **Decisions**: Veo 3.1 Fast default (3.0 retired 2026-06-30); refine via
  gemini-2.5-flash with history/context/transfer modes; base prompt always visible
  & editable (no hidden prompt); reference images cover-cropped to target aspect
  (i2v tiles otherwise); duration is a request — effectiveSeconds() snaps per
  provider (Veo 4/6/8, Sora 8, Grok 1–15); expression-hold recipe: no emotional
  background actors + verbatim action + counter-negatives; frame-seed wins over
  wardrobe/location prompts (seed only for emotion/camera changes).
- **Constraints**: Veo daily quota (RPD) resets midnight PT regardless of payment;
  Grok has no text-to-video (text→image→video, $0.08/s + $0.05 image step);
  Sora base = 720p/8s+watermark; Seedance adapter unverified; NEVER run
  `bun run build` while a dev server runs (kills it) — use `bun x tsc --noEmit`.

## Timeline

### 2026-07-06
**Focus**: Entire studio built and iterated in one day (~30 commits).
- Scaffolded Next 16/bun app; Veo wired from live docs; async generate/status/video routes
- Pivoted to chat UI: takes, rewind, session history sidebar, session archive
- Multimodal: image/video attachments (video → up to 10 time-ordered frames),
  starter cards (27 faces × 10 sets, baked, card image = generation reference),
  pinned-take context (CTX), continuity snapshots (CONT), performance-transfer
  mode (video = choreography, card = identity), video-URL ingestion route
- Spend: per-take estimates, retro-priced backfill, header popover chart
- Archive: rail ▦ overlay grouped by owning session; chat shows current session only
- Natural surprise arc (owner's reference clip) encoded as timestamped beat map
  for 6–8s takes; refine system guards realism + action clauses

**Learned**: video models follow timestamped beat maps far better than adjectives;
scene emotion contaminates the subject's face; aspect-mismatched i2v references
tile the frame; JSX must be refactored via components, never string-sliced.

### 2026-07-07
**Focus**: Post-launch UX + a reference-video toolchain + a real dashboard.
- Turn-row actions: DELETE on failed takes (no archive ref → no confirm),
  pill-styled buttons scoped to `.turn-status`, `+ Context` affordance
- GRAB tool (rail ⤓, `app/api/grab`): pull reference videos onto the machine
  from YouTube (yt-dlp), X posts AND X articles (guest GraphQL with
  `withArticleRichContentState` — reaches article-embedded media yt-dlp can't),
  or direct .mp4; optional ffmpeg trim; dev-only route, `.grabs/` gitignored
- Rail overlays (sessions/archive/grab) made mutually exclusive (radio)
- GRABs land in the archive as zero-cost `provider:"grab"` cards (excluded from
  the spend ledger), view auto-jumps there, card has "use as reference"
- Header spend scoped to the CURRENT session ($0 on a new session); popover
  keeps all-session view + links to the new dashboard
- `/dashboard` page: stat tiles, 14-day stacked columns, by-session + by-model
  bars, provider/pricing/key config table — all from the localStorage ledger
- Library starter pill: attach any archived take/GRAB as a motion reference
- Transfer mode rewritten as hard-ruled motion transcription (no invented/
  reordered beats, same shot type, replace ONLY performer + location)

**Learned**: X articles are a hidden toggle on the tweet API, not a separate
endpoint — undici's default UA gets filtered, needs a browser UA (curl worked,
server didn't); the archive-as-ledger design meant the dashboard needed zero
new storage; transfer is transcription+seed-frame re-performance, so i2v
choreography fidelity is the hard ceiling — best is max transcription fidelity
+ a ban on invented beats (verified: still-image ref now holds pose vs. inventing).

### 2026-07-07 (cont.)
**Focus**: Real transfer (Act-Two), a model marketplace, wardrobe, spend guard.
- Fixed the double-submit (Korean IME Enter + async busyTurn) with an
  isComposing guard + a synchronous sendLockRef; surfaced Gemini finishReason
  and disabled thinking (thinkingBudget:0) so refine stops returning empty text
- Runway Act-Two provider (lib/providers/runway.ts): TRUE performance transfer
  (driving video + face card → motion mapped onto the face). Web-researched
  that Grok/Veo/Sora are all first-frame i2v and structurally cannot follow a
  source video — Act-Two is the only real fix. Character/video sent as data
  URIs; CloudFront output proxied
- Model catalog split from adapters: several models ride one adapter via a
  modelId override. Rich hand-rolled picker (no radix) — company filter chips,
  price + quality/speed meters + key status, headline-per-company default,
  "All models" reveals verified variants (Veo 3.1 / Veo 3.1 Lite / Sora 2 Pro)
- Fashion: Act-Two has no wardrobe input, so /api/dress composites the picked
  outfit onto the character (gemini-2.5-flash-image) BEFORE Act-Two animates
  it; Fashion carousel (16 baked garments, gender-filtered) + custom upload
- Pre-spend confirm modal on Send/Retry (model/format/length/est. cost),
  session-scoped "don't ask again"; default duration stays 4s (dropped the
  video-attach nudge)
- Logo now opens a fresh session; rail extracted + shared with /dashboard

**Learned**: i2v (first-frame) vs video-driven (Act-Two) are different model
categories — no prompt/LLM trick bridges them; the honest hacky-cheap cousin is
LivePortrait ($0.06/clip). The "model ≠ adapter" split (one protocol, many
model ids) is how every LLM provider ships variants. Fill capability gaps with
pre-steps (refine text, normalizeRefB64 aspect, dress wardrobe) rather than
waiting on the model. Money-guard opt-outs should be session-scoped, never
permanently persisted.

## Pending
- [ ] Verify Runway Act-Two end-to-end (needs a Runway key; adapter built to spec)
- [ ] Verify the /api/dress outfit compositing quality on real cards
- [ ] Optional: LivePortrait adapter as a cheaper Act-Two alternative (user asked)
- [ ] Optional: wire Sora 2 Pro / Veo 3.1 pricing accuracy (currently estimates)
- [ ] Verify Seedance adapter end-to-end (endpoint/model id unconfirmed)
- [ ] Set APP_PASSWORD before any public Vercel deploy
- [ ] GRAB job files in `.grabs/` are never garbage-collected (fine for local dev)

## Notes
Full engineering record in docs/DEVLOG.md (#1–25) and CLAUDE.md handoff.
