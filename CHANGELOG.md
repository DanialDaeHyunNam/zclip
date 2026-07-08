# Changelog

All notable changes to ZCLIP. Uses simple `MAJOR.MINOR.PATCH` versions; a
running local copy compares its version against the deployed one and prompts an
update when it's behind (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#versioning--updates)).

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
