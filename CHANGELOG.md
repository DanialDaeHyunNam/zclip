# Changelog

All notable changes to ZCLIP. Uses simple `MAJOR.MINOR.PATCH` versions; a
running local copy compares its version against the deployed one and prompts an
update when it's behind (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#versioning--updates)).

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
