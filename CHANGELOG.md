# Changelog

All notable changes to ZCLIP. Uses simple `MAJOR.MINOR.PATCH` versions; a
running local copy compares its version against the deployed one and prompts an
update when it's behind (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#versioning--updates)).

## 0.7.0 — 2026-07-15

### Added
- **Multi-subject motion transfer.** A transfer flow's IMAGE stage is now
  multi-select — confirm one look per person in the reference clip (the
  two-dancer case). Each rides as its own `reference_image` next to the
  clip's `reference_video`, in the order you pick (badges #1, #2…), and a
  hint reminds you to say which is which (left / right) in the prompt. Look
  flows stay single-confirm.
- **Seedance 2.0 Mini** (`dreamina-seedance-2-0-mini-260615`) — the
  cheapest clip-reader (ModelArk with-video token rate $2.1/M flat: ~12%
  under standard @720p, ~55% @1080p). Selectable in transfer flows for the
  tightest-budget pass.

### Changed
- Seedance pricing estimates corrected from owner-read ModelArk token rates
  (standard $2.4–4.7/M with video); Mini/Fast slot in below.
- Duplicate look thumbnails (from the pre-0.6.3 shared-look bug) collapse on
  load, with confirmations repointed onto the survivor.

## 0.6.4 — 2026-07-15

### Added
- **Seedance 2.0 Fast** (`dreamina-seedance-2-0-fast-260128`) joins the
  picker — same clip-reading family, ~25% cheaper (est. $0.08/s 720p) —
  and is selectable in transfer flows: iterate on Fast, finish on 2.0.
  All Seedance-2 gates (SPEC keep, continuity skip, reference pairing)
  now key off the family, not the single model.

### Fixed
- Transfer flows check the MOVES reference length BEFORE uploading:
  ModelArk r2v caps the reference at 15.2s (confirmed live — the
  content[2] rejection), so an over-long clip now gets a clear "trim the
  beat with GRAB (m:ss)" error instead of a provider parameter dump.
  Notably, that same live error confirmed the reference_image +
  reference_video pairing is ACCEPTED — role mixing is no longer
  unverified.

## 0.6.3 — 2026-07-15

### Fixed
- Re-picking a shared look no longer appends duplicate thumbnails — it
  re-confirms the one already in the strip.
- MOVES candidates stay visible after picking, with the live one
  highlighted (▶) — with several similar references it's always clear
  which is set. Chip labels drop the shared "Reference · " prefix so the
  distinctive part survives truncation.

### Changed
- Transfer templates restructured into guardrails + a marked "Acting:"
  line — the line you're MEANT to edit ("← direct the performance here";
  the marker is stripped before the prompt is sent). Taller textarea for
  the multi-line template.

## 0.6.2 — 2026-07-15

### Added
- The look stage offers "Reuse a look you already made": confirmed stills
  from your other flows and saved Character cards appear as thumbnails —
  one click imports and confirms, so a transfer flow can borrow the exact
  look an Image → Motion flow already locked.

## 0.6.1 — 2026-07-15

### Fixed
- MOVES reference chips get breathing room above the first row.

## 0.6.0 — 2026-07-15

### Added
- **MOTION TRANSFER flow — a reference video's moves, performed by your
  look.** ＋ New flow now asks which pipeline you want: the classic
  IMAGE → MOTION, or the new MOVES → IMAGE → MOTION. The transfer kind
  locks a reference clip (pick a GRAB from the Library or upload a local
  video — direct Library upload is new too), locks a look, then sends
  both to Seedance 2.0 (the clip-reading model): the look rides as an
  identity reference next to the motion reference. Opens pre-filled with
  a field-tested template — 🎲 cycles a green-screen composite variant
  that generates pre-keyed footage (flat #00FF00, no set, no shadows)
  for dropping into any edit. Flow tabs are now named after their
  pipeline ("Image → Motion 1"); existing tabs rename automatically.
- **Direct upload into the Library** (local only): `/api/clips` accepts a
  multipart video, vaulting it like any take.

### Changed
- Seedance 2.0 adapter pairs an identity image (`role: reference_image`)
  with a reference video instead of dropping the image — first real run
  still needs to confirm ModelArk accepts the pairing (failures surface
  loudly in the take, as ever).
- Reference-video size cap is provider-aware: ~60MB for Blob-staged
  Seedance (Runway keeps its 16MB inline cap).

## 0.5.6 — 2026-07-15

### Changed
- GRAB trim inputs take clock time now — type `6:30` → `9:45` (or
  `1:02:05`, or plain seconds like `390`); conversion to seconds happens
  behind the scenes, and the library note shows the same clock format.

## 0.5.5 — 2026-07-15

### Fixed
- GRAB with a trim range now downloads ONLY that section (yt-dlp
  `--download-sections` + frame-accurate keyframe cuts) — a 60s beat from a
  22-minute video used to pull the whole ~400MB file and silently trip the
  200MB cap, surfacing as ffmpeg's baffling "Error opening input files".
  When a source really is over the cap, GRAB now says so plainly and
  suggests setting a trim range. Section grabs also get a longer timeout
  (they stream slower by nature).

## 0.5.4 — 2026-07-15

### Changed
- Local-vs-browser comparison modal gains an "Updates" row: the browser
  is always the latest version automatically; a local install gets the
  in-app update banner and a one-command update.

## 0.5.3 — 2026-07-15

### Added
- FLOW method gets the chat method's rendering treatment in the shared
  left frame: scanline sweep + elapsed timer while a still (~10s) or a
  motion take (60–180s) is generating, and the header status now tracks
  the flow job (RENDERING/COMPLETE/STANDBY) instead of echoing the last
  chat take. A failed job puts the previous preview back instead of
  leaving a stuck busy screen.

## 0.5.2 — 2026-07-15

### Fixed
- The last underlines are gone: several links drew a 1px `border-bottom`
  as a pseudo-underline (key panel, install guide, stub notes) — removed;
  hover now shifts color instead.

## 0.5.1 — 2026-07-15

### Added
- **Local vs browser comparison modal** on the landing: the paragraph under
  the CTAs is now a one-line question — "What's the difference between
  running it locally or in the browser?" — that opens a clean side-by-side
  table (keys / takes / features / setup, EN·KO) with install and
  try-in-browser CTAs.

### Fixed
- Hosted "Browser mode" banner: ✕ now dismisses it permanently (it used to
  return on every reload).
- Links no longer underline anywhere — affordance comes from color/hover.
- The "API key required" popover no longer clips at the bottom of the
  page (or hides under the hosted banner): while it's open the settings
  column reserves matching scroll room.

## 0.5.0 — 2026-07-15

### Added
- **The hosted app is a real studio now — bring your own keys.**
  zclip.vercel.app's `/chat` no longer gates to an install guide: paste a
  provider key and generate. Keys live in **your browser** (localStorage)
  and **pass through** the server only while a request runs — never stored
  or logged there; the key panel says exactly this, always. Full design
  doc: [docs/HOSTED.md](docs/HOSTED.md).
- **Owner-wallet firewall.** On cloud deploys the server refuses to fall
  back to environment provider keys — visitors can only ever spend their
  own. (Locally `.env.local` works exactly as before.)
- **Hosted Veo/Sora playback & download** fetch the MP4 with the key in a
  header and play a `blob:` URL — the key never appears in a URL, so it
  can't land in request logs.
- **Two-track landing.** Local install is the primary CTA; "try it in the
  browser" sits next to it with an honest note on the difference (local =
  keys never leave your machine + permanent vault + every feature).
- **Delete all data** (hosted): one button on the dashboard wipes every
  `hooklab.*` localStorage entry — sessions, takes, keys, and the spend
  ledger — behind a warning modal. Local installs: delete `.zclip-data/`.

### Changed
- Provider adapters take the API key as an explicit per-request argument
  (`submit(prompt, params, apiKey)`) — no more `process.env` reads inside
  adapters, so concurrent hosted visitors can never cross-bill.
- Hosted limits fail loud and point at the local install: reference-video
  Seedance (would stage clips on the operator's storage), Act-Two bodies
  over Vercel's ~4.5MB platform cap (16MB locally), expired archive
  replays (providers purge within days — hosted has no vault; a download
  nudge now sits on every finished take).

## 0.4.0 — 2026-07-13

### Added
- **SPEC mode — an interview before money moves.** Toggle SPEC next to
  Send and your draft is checked against a 15-section photoreal spec:
  the composer itself asks a few quick questions (genre, cut board,
  characters — quick-reply chips + free text), assembles a
  production-grade prompt, previews it with mechanical self-checks and
  the cost, and only generates on your explicit confirm. The assembled
  prompt is submitted verbatim — no rewrite pass on top. "Skip checks,
  run as typed" is always one click away. Attached images/cards/pins
  ride through the interview onto the final request. Spec takes show
  their full prompt in the thread (expand/copy modal).
- **Gemini-key onboarding.** No Gemini key? Your first text send opens a
  small pitch: add a free key for the guided interview, or decline and
  ZCLIP sends exactly what you typed (no more dead-end error). The SPEC
  button reopens the offer anytime.
- **FLOW method — lock a look, iterate motion.** A still→motion pipeline
  living next to the chat (CHAT | FLOW toggle in the session header):
  generate or upload a look (Grok / GPT / Gemini image engines), confirm
  it once, then iterate i2v motion endlessly — the still never re-rolls.
  ✎ edit a look in place ("same person, change the outfit" — Gemini image
  editing), 🎲 random starter drafts for looks and motions, per-flow
  model/aspect/duration, and every finished take lands in the shared
  Library. Confirmed stills save as Character cards (auto-numbered, never
  overwritten) for the chat method. Flows belong to their session — the
  sidebar marks sessions that used FLOW.
- **Kling 3.0 provider** (`kling-v3`, adapter unverified until a first
  real run): the market's most natural motion per dollar for i2v.
  Key format `ACCESS_KEY:SECRET_KEY` (Kling's separate API plan).
- **Model Guide.** The model picker grew a right-aligned "Guide ?" —
  a per-model street-reputation cheat sheet (what each model is actually
  best at, with field-note caveats), dated Jul 2026.
- **Library: per-clip permanent delete.** Every card's Remove now opens a
  confirmation that spells out what's lost, then deletes the saved file
  from disk AND the Library entry together.

### Changed
- Chat bar is a column now: full-width input on top, attach/SPEC/Send on
  an action row below — long drafts stop getting squeezed.
- The spend popover shows THIS session only, with an all-sessions button
  into the full dashboard.
- Fashion picker shows mid-thread too (it always worked there).
- Card action rows wrap instead of clipping (Remove was pushed offscreen).
- Prompt length cap raised to 6000 chars for assembled spec prompts;
  assemblers target ≤3600 with an auto-compress retry.
- Assembled prompts must use clearly fictional names — video providers
  hard-block real-person likenesses (Veo rejected one; now guarded).

### Fixed
- Errored provider jobs no longer spin as RENDERING forever in
  long-poll loops.
- Frame empty-state copy no longer touches the frame edges.

## 0.3.0 — 2026-07-10

### Added
- **Clip vault — takes now survive their providers.** Every finished take's
  video is saved into `.zclip-data/clips/` automatically (providers sign
  their download links and purge files within a day or two — anything not
  saved locally eventually becomes a dead player). Older takes whose links
  already died get one recovery attempt: the provider is re-polled by job id
  for a fresh signed URL. Unrecoverable takes show a clear "Video
  unavailable" notice instead of a blank frame.
- **Library "Clear All" now really clears.** It deletes every saved video
  file (generated takes and GRAB references) after a warning dialog that
  shows how much disk it frees and spells out what's lost: deleted takes
  can't be played again or used as references, and the spend history resets.
- **Reference Mix.** A video-reference chip now carries a mixer button —
  checkboxes decide what the next take copies from the reference (motion &
  timing, camera framing, background, wardrobe, on-screen text, speech).
  Unchecked aspects are explicitly removed, not just omitted — burned-in
  subtitles finally stay out of the output. Asks once on the first-ever
  video reference; choices persist as your default.
- **Seedance 2.0.** Reads the WHOLE reference clip — motion, pacing and
  audio — and generates sound in its output. Video inputs are URL-only, so
  the clip is parked on your own Vercel Blob store just for the job and
  deleted after (in-UI onboarding for the `BLOB_READ_WRITE_TOKEN`). New 15s
  duration preset to fit full scripts.
- **Desktop notifications.** The first Generate click asks for permission;
  after that, a take landing (or failing) while the tab is hidden fires a
  notification. The render frame notes that switching tabs is fine but the
  tab must stay open.
- **Session management.** + New materializes a "New session" entry
  immediately (never-used sessions vanish when you switch away); rename via
  double-click or the row's ⋯ menu; pin sessions to the top; the list keeps
  a stable newest-first order by creation time.
- **Fashion chip.** Picking an outfit now shows a removable chip in the
  composer (like Character/Background) and a manifest row explaining it's
  composited onto the character.

### Changed
- Continuity (CONT) is skipped on Seedance 2.0 — it hard-rejects image
  inputs that look like real people, which a continuity snapshot always is.
  The control reads CONT N/A there, with guidance to attach the previous
  take as a video reference instead.
- Retrying a take that was sent with an attached reference now refuses with
  an explanation (references aren't stored after sending; the retry would
  silently bill for a take without it).

### Fixed
- Seedance no longer sends a first-frame image alongside a reference video
  (the API rejects mixing them: "first/last frame content cannot be mixed
  with reference media content").

## 0.2.1 — 2026-07-09

### Changed
- **Install prompt now includes a friendly star request.** The one-line
  "paste into your AI coding CLI" prompt (shown at `/install`, the `/chat`
  gate, and the landing install modal) ends by asking the agent to relay a
  transparent "if you like this project, please consider a ⭐ on GitHub"
  note with the repo link once the app is running — surfaced to the user, not
  an automatic action. EN + 한국어.

## 0.2.0 — 2026-07-08

### Added
- **Stack context freely, on any model.** Character, Background, and a
  Library/dropped reference now coexist on the next take instead of overwriting
  each other — the prompt refiner sees all of them and the video model gets a
  single primary image (the character face first).
- **Per-model context manifest.** A summary under the composer spells out what
  the selected model does with each attached piece, and flags what it drops
  (e.g. Act-Two ignores the background and any text prompt).
- **Context blocks work mid-conversation**, not just on take 1 — pick a
  Character / Background / Library at any point to steer the next take.

### Changed
- **Composer reworked into a stable frame.** The pills and input no longer jump
  as you add or remove context: the input stays anchored, chips + manifest form
  a scrollable summary beneath it, and the picker carousel opens as a dropdown
  popover that closes on select. "Start a clip" / "How to use" show only on an
  empty session.
- **Act-Two confirm dialog** shows the real driving-clip length and the cost
  computed from it, instead of a generic "driving clip length".

### Fixed
- **GRAB downloads play everywhere.** Instagram (and other VP9) grabs that
  played in-browser but showed up blank in QuickLook / QuickTime now download as
  H.264 — yt-dlp prefers an H.264 rendition, VP9/AV1 is transcoded, and outputs
  are written faststart.

## 0.1.11 — 2026-07-08

### Changed
- **About dialog's "Star on GitHub" gets the gold glow** — the same gold band +
  pulsing halo + gold star as the landing's star CTA, so the free-tool "reward"
  reads consistently in the studio.

## 0.1.10 — 2026-07-08

### Changed
- **Studio ⓘ opens an in-app About dialog** instead of jumping to the full
  marketing landing (which was jarring mid-session and hard to get back from).
  The dialog matches the help/update modal language and keeps a "View the full
  landing →" link, so home is still one click away — just intentional now.

## 0.1.9 — 2026-07-08

### Changed
- **Rail reordered & decluttered** — top group is now Sessions · Dashboard ·
  Library · Download, with the About (ⓘ) affordance moved up next to them.
  Help (?) and the version chip stay pinned at the bottom.
- **Removed the ＋ New rail button** — start a new session from the sessions
  sidebar's **+ New** (or the logo, which is still a fresh start).
- **Sessions sidebar is persistent** on the studio — it no longer auto-closes
  when you pick a session or start a new one; only the ≡ button toggles it.

## 0.1.8 — 2026-07-08

### Changed
- **Dashboard moved to the rail** — it's now the second item in the left rail
  (a bar-chart icon, right under the logo) instead of a link buried in the
  sessions sidebar header, which is now just Sessions · + New.

## 0.1.7 — 2026-07-08

### Changed
- **Workflow demo lands on a real clip** — the "What you can do" walkthrough
  (in the help modal and install guide) now plays the actual first take from
  the landing reel (`take-1.mp4` — asian-f-1 in the bedroom, the exact beat it
  types) instead of a static portrait.

## 0.1.6 — 2026-07-08

### Changed
- **GRAB moved into the Library.** Fetching a reference video by URL is no
  longer a separate covering overlay — it's a collapsible **＋ Add reference**
  action inside the `/archive` (Library) page, sitting inline under the header
  (no more centered-island layout). The ⤓ rail icon now opens the Library with
  that add form already expanded; ▦ opens it to browse.
- **Copy follow-through** — the studio's Library explainer, the Act-Two
  "needs a driving video" hint, and the ⤓ tooltip now point at the new
  in-Library add flow instead of the old rail overlay.

## 0.1.5 — 2026-07-08

### Changed
- **Archive is its own page** (`/archive`) instead of a covering overlay — it
  keeps the left rail, gets a real URL and back button, and is reached by
  client-side navigation so freshly-finished takes show without a reload.
  "Use as reference" hands the clip back to the studio composer. (The grab tool
  can move to a route the same way next.)
- **Leaner install popup** — dropped the redundant "Star on GitHub / Close"
  footer row from the install-guide modal; the ✕ in its header already closes
  it and the landing already has the star.

### Internal
- Extracted the shared `Clip` type/keys (`lib/clip`) and the `ClipCardView`
  card (`app/clip-card`) so the studio and the archive page share one source.

## 0.1.4 — 2026-07-08

### Changed
- **Consistent picker intros** — the Character and Background pickers now show a
  one-line description like Fashion does, and there's proper breathing room
  between the pill row and the opened picker content (they were flush before).
- **Tighter empty Library** — the "Archive is empty" note no longer inherits the
  carousel's padding, so the gap under the Library explainer is normal.
- **Cleaner install guide** — dropped the redundant hero (title + lead) from the
  guide; it opens straight to the 3-step pager (the landing already set that
  context).

## 0.1.3 — 2026-07-08

### Changed
- **Fashion works with any model** — the picked outfit is composited onto the
  character reference (via the dress op) for the first take regardless of the
  selected model, not just Runway Act-Two. Every video provider takes an image
  reference, so the dressed frame carries the outfit through. The picker hint
  and pill tooltip no longer claim it's Act-Two-only, and prompt a Character
  first when none is selected.

## 0.1.2 — 2026-07-08

### Added
- **"How to use?" from the empty session** — a central entry point in the
  SESSION column (next to "Start a clip") opens the same help modal as the
  rail's `?`, so the guide is reachable without hunting for the rail button.
- **Library explainer** — opening the Library picker now shows what the
  library is: takes pile up automatically, URLs are downloaded via GRAB, and
  your own uploads land there too. The in-app how-to step says the same.
- **Paginated install guide** — the local-install guide (and its popup) is now
  three sequential steps — *What you can do* → *Nothing runs on our servers* →
  *Install guide* — with a tabbed stepper and Back/Next, instead of one long
  scroll.

### Changed
- **Session history scrolls internally** — the take list is capped and scrolls
  within the column (the composer no longer gets pushed off-screen), and every
  session opens scrolled to its most recent take.
- **Update banner floats at the bottom** — moved from the top center, where it
  overlapped the column headers.

## 0.1.1 — 2026-07-08

### Added
- **Workflow walkthrough animation** — a CSS/JS state machine (like the landing
  demo reel, but of the UI itself) that clicks Character → Background → Fashion,
  types the beat, hits Send, renders, and lands a take. Shown in the in-app help
  and the install guide's "What you can do" section.

### Changed
- How-to steps highlight their key phrases (accent bold).

## 0.1.0 — 2026-07-07

First versioned release. The core studio (chat-driven takes, model marketplace,
Act-Two performance transfer, GRAB, spend dashboard, 27-face cast) already
existed; this release adds the local-first deployment model, guides, resilient
storage, and version awareness.

### Added
- **Hosted-as-about-page deploy** — the public Vercel deploy is a marketing /
  about page; opening the studio there shows a **local-install guide** (macOS /
  Windows, English / 한국어) instead, since the studio spends real money on your
  own keys and runs locally. Landing CTAs open the guide as a popup.
- **Install guide** — bilingual mac/Win walkthrough with copyable terminal
  blocks; an **AI coding CLI one-liner** is the recommended path, manual
  bun/clone is the fallback.
- **Filesystem session store** — sessions/gallery/assets persist to
  `.zclip-data/store.json` on disk (dev only), fixing the two `localStorage`
  failure modes: the ~5MB quota (big multi-take sessions silently vanished) and
  the per-port origin split (`:3000` vs `:3001`). First run merges any prior
  localStorage in once; localStorage stays a fallback for the cloud build.
- **Version awareness** — the app shows its version (rail chip + landing
  footer). A local copy checks the canonical deployment's `/api/version` and
  shows an "update available" banner + update guide (AI-CLI one-liner or manual
  `git pull`) when it's behind.
- **EN/한국어** toggle on the landing + install guide.
- **Docs** — README, `docs/ARCHITECTURE.md`, and this changelog.

### Changed
- Cast/wardrobe copy: "tee" → "t-shirt" throughout.
- Studio chrome: removed the top `ZCLIP_ / About` header; the sessions sidebar
  now stays open until toggled; the rail gained an about (ⓘ) link and version
  chip; the landing footer was rebuilt (brand / project / follow + version bar).

## Unreleased

<!-- Add notes here as you work; move them under a version heading on release. -->
