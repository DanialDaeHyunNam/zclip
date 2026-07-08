# Changelog

All notable changes to ZCLIP. Uses simple `MAJOR.MINOR.PATCH` versions; a
running local copy compares its version against the deployed one and prompts an
update when it's behind (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#versioning--updates)).

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
