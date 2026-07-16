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
  Later (v0.1.2–v0.1.9): the full archive is a real page (`/archive`, "Library"),
  not an overlay — cross-page state rides the `lib/store` cache via client nav +
  handoff keys; GRAB lives inside the Library as "+ Add reference"; Fashion applies
  to any model via `/api/dress` pre-compositing; the studio stays English-only
  (owner's call — no globe); rail order is Sessions·Dashboard·Library·Download·About
  with a persistent sessions sidebar and no ＋ New rail button.
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

### 2026-07-07 (studio + dashboard polish)
**Focus**: Dashboard interactivity + a persistent sessions sidebar.
- Dashboard: config table now lists the whole MODEL catalog (not just the 5
  adapters); interactive model filter chips above the chart filter the 14-day /
  by-session / by-model views; spend rows span full width with the value flush
  right (auto value column + minmax(0,1fr) bar kills the `· 68s` overflow).
- Sessions panel is now open by DEFAULT as a persistent sidebar (no backdrop);
  the studio shifts right beside it, rail button + Escape hide it.

**Learned**: CSS grid overflow ("blowout") comes from `min-width:auto` on
tracks — a long value pushes the grid past the container; fix with a value
column of `auto` + bar on `minmax(0,1fr)`. Modal→persistent is a small change
(drop the backdrop, shift content) when close-on-outside-click was never wired.

### 2026-07-08 (chrome cleanup + filesystem store + in-studio version/help UI)
**Focus**: Studio chrome, resilient storage, version/help modals.
- Removed the top `ZCLIP_ / About` header and the "Make the hook." empty-state
  hero; restored top margin (shell padding). Sessions sidebar now stays open until
  the ≡ toggle (Escape/archive/grab/+New no longer close it). Rail gained an about
  (ⓘ) link → `/`, a `?` help button, and a version chip at the bottom.
- Swapped all `localStorage.*` for the filesystem store (`lib/store`): sessions/
  gallery/assets persist to `.zclip-data` (dev). Save effects gated on a `hydrated`
  flag so empty initial state can't clobber the file. Fixes the "sessions vanish"
  bug (5MB quota + per-port :3000/:3001 split). See [[zclip-deploy-versioning]].
- In-studio version awareness: rail chip + "update available" banner + `UpdateGuide`
  (`useUpdateCheck` vs the deploy). In-app `?` help modal (`help-guide`) with a
  `WorkflowDemo` animation + how-to steps. `tee` → `t-shirt` in cast/wardrobe.

**Learned**: an uncaught `localStorage.setItem` quota error silently drops the
save — the biggest sessions (most base64 snapshots) were exactly the ones that
vanished on reload; a shared on-disk file also erases the per-port origin split.

### 2026-07-08 (rapid UX polish + rail/library restructure — v0.1.2→v0.1.9)
**Focus**: Studio guidance, cross-picker consistency, and a routes/rail
restructure, shipped across 8 review-driven releases.
- Guidance: "How to use?" entry point in the empty session (opens the same help
  modal as rail `?`); session thread capped (max-height 52vh) with internal
  scroll that always opens at the newest take; per-picker intro lines
  (Character/Background now match Fashion) with breathing room from the pills;
  3-point Library explainer.
- Fashion for ANY model: the picked outfit is composited onto the character
  reference (`/api/dress`) for take 1 regardless of the selected model, not just
  Act-Two (every provider takes an image ref) — extracted a shared
  `dressWithFashion` helper used by both send paths.
- Empty output frame left blank by default (briefly tried an autoplay sample
  reel; owner found it too much → removed).
- **Archive → its own `/archive` route** (was a covering overlay): keeps the
  rail, real URL + back button; "use as reference" hands a clip back to the
  composer via `PENDING_REF_KEY`. Extracted the shared `Clip` type/keys
  (`lib/clip`) + `ClipCardView` (`app/clip-card`). Renamed Archive → Library.
- **GRAB folded INTO the Library page** as a collapsible "+ Add reference"
  (removed the studio grab overlay + all its state/logic); ⤓ opens the library
  with the add form expanded (`/archive?add=1`), ▦ opens it to browse.
- Workflow demo now lands on the real take-1 video, not a still (see
  [[zclip-landing-demo]]).
- **Rail restructure**: Dashboard moved onto the rail (bar-chart icon), then
  final order Sessions · Dashboard · Library · Download · About (moved up from
  the foot); dropped the ＋ New rail button (new session = sidebar's + New or the
  logo); sessions sidebar is now truly persistent — removed the auto-close on
  session-pick / +New so only ≡ toggles it.

**Learned**: client-side `router.push` (not `window.location`) keeps the
`lib/store` singleton cache alive across page nav, so a fresh `/archive` read
sees just-written clips WITHOUT a disk round-trip — the store's disk flush is
debounced 400ms, so a full reload would race it; a deep-link param
(⤓ → `/archive?add=1`) expresses cross-page intent without prop-drilling;
reusing an overlay's markup inline needs a layout reset (`.grab-card`'s
max-width + 10vh margin → a `.library-grab` modifier); a demo's *result* should
be the clip its typed prompt would produce (video, not a stock still).

### 2026-07-08 (in-studio About dialog — v0.1.10→v0.1.11)
**Focus**: Stop the rail ⓘ from yanking you out to the marketing landing.
- The rail ⓘ opened the full landing (`/`) mid-session — jarring + hard to
  return. Replaced it with an in-studio `AboutModal` (`app/chat/about-modal.tsx`,
  same `.rlg-modal` shell as help/update): wordmark, gradient tagline,
  "Open source · MIT · vX" (→ releases), a Star CTA, and a "View the full
  landing →" link — so home is reachable, but only on purpose.
- Rail's About is now a button when an `onAbout` handler is passed (studio →
  opens the modal), else the plain `<a href="/">` (archive/dashboard keep it);
  shared the ⓘ SVG as an `AboutGlyph` helper.
- The About Star CTA reuses the landing's gold band (`.ld-star` + `starHalo`
  pulse + gold `.ld-star-icon`), so the free-tool "reward" reads the same
  in-studio as on the home page.

**Learned**: for a deep, focused workspace, "About/home" should be an in-context
dialog (dismiss to stay put) with an *explicit* link out — an accidental
full-page jump to marketing breaks flow; gate the disruptive nav behind intent.

### 2026-07-08 (multi-input context blend + stable composer — v0.2.0)
**Focus**: Let context stack instead of overwrite, and stop the composer jumping.
- **Multi-input blend**: Character, Background, and a Library/dropped reference now
  COEXIST on the next take (previously each new pick overwrote the last). The refine
  step sees all of them; the video model still gets ONE primary image (character
  face first). Works mid-conversation, not just take 1 — pick any block at any point
  to steer the next take.
- **Per-model context manifest** under the composer spells out what the selected
  model does with each attached piece and flags what it drops (Act-Two ignores the
  background + any text prompt) — so a capability gap is visible, not silent.
- **Composer reworked into a stable frame**: input stays anchored, chips + manifest
  form a scrollable summary beneath it, picker carousel opens as a dropdown popover
  that closes on select (no more layout jump on add/remove). "Start a clip" / "How
  to use" only on an empty session. Act-Two confirm now shows the REAL driving-clip
  length + cost computed from it.
- **GRAB downloads play everywhere**: Instagram/VP9 grabs that played in-browser but
  were blank in QuickLook now download as H.264 (yt-dlp prefers H.264, VP9/AV1
  transcoded, faststart). See [[zclip-deploy-versioning]].

**Learned**: when several inputs can conflict, blend + a per-model manifest beats
overwrite — surface what each model actually consumes (and drops) rather than
guessing; a composer that reflows as you attach context feels broken, so anchor the
input and let the summary scroll beneath it.

## Pending
- [x] "How to use?" entry point in the empty session center (rail `?` stays)
- [x] Session thread: max-height + internal scroll + always start at bottom (recent)
- [x] Pickers: confirm real asset images render (they do); demo video now on the
      workflow demo (owner asked to keep the studio render frame blank by default)
- [x] Library intro: generated-takes / URL-grab / direct multimodal-upload sources
- [x] Direct upload INTO the Library (a real library item, not just a composer
      drop) needs a server endpoint to persist the file + return a URL — BUILT
      with the v0.6.0 transfer flow: `app/api/clips` POST multipart writes a
      real Library item into `.zclip-data/clips/` (dev-only, line 56)
- [ ] ⤓ vs ▦ now sit adjacent in the rail (both open /archive) — consider
      collapsing into one entry point
- [x] Verify Runway Act-Two end-to-end (2026-07-07: live Act-Two session produced
      the 4 real takes now powering the landing demo reel — see [[zclip-landing-demo]])
- [ ] Verify the /api/dress outfit compositing quality on real cards
- [ ] Optional: LivePortrait adapter as a cheaper Act-Two alternative (user asked)
- [ ] Optional: wire Sora 2 Pro / Veo 3.1 pricing accuracy (currently estimates)
- [x] Verify Seedance adapter end-to-end — confirmed by real runs: completed
      Seedance 1.0 Pro clip 2026-07-09 + six 2.0-family clips through 07-16
      in the gallery ledger (adapter endpoint/shape work; pricing fill still
      open in [[zclip-seedance-provider]])
- [x] Set APP_PASSWORD before any public Vercel deploy (obsoleted by the local-first
      deploy model — cloud `/chat` renders the install guide, no public studio exists;
      only needed if a hosted studio is ever unlocked via `ZCLIP_CLOUD=0`)
- [ ] GRAB job files in `.grabs/` are never garbage-collected (fine for local dev)

## Notes
Full engineering record in docs/DEVLOG.md (#1–25) and CLAUDE.md handoff.
