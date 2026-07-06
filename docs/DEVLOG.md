# DEVLOG — HOOK LAB

Chronological record of decisions, evidence, and pivots. Read
`CLAUDE.md` first; this file explains *why* things are the way they are.
All entries 2026-07-06 (single build session, owner: Dan).

## 1. Initial build (form-based v1)

- Fresh Next.js 16.2 (App Router) + TS 6 + bun, hand-rolled (no
  create-next-app cruft). Deps: next/react/react-dom only.
- **Live-docs rule established**: before wiring any provider, verify
  model id/endpoint on live docs. Immediately paid off — **Veo 3.0 was
  retired 2026-06-30**; wired `veo-3.1-fast-generate-preview` instead
  ($0.10/s 720p, $0.12/s 1080p, from ai.google.dev pricing page).
- Async job pattern (submit → poll every 3s) because clips take 60–180s
  and serverless calls must return fast.
- `/api/video` proxy exists because Veo file URIs require the API key in
  a header, which `<video>` cannot send.
- Password gate (`APP_PASSWORD`): header for fetches, `?pw=` for video
  URLs. Server-side enforcement verified with curl (401 without).
- v1 UI: prompt textarea + 3 preset variants + fixed 9:16/4s params.
  Verified: build, gate flow, visible no-key error, mobile stacking.

## 2. Console-noise fixes

- Hydration mismatch = browser extension injecting
  `data-google-analytics-opt-out` on `<html>` → `suppressHydrationWarning`
  (attribute-level, one element only). Not an app bug.
- `app/icon.svg` added (favicon 404). JetBrains Mono trimmed to 400
  (preload warning; timer weight adjusted).

## 3. Param controls + quota reality

- Aspect/duration/resolution became real selects; est. cost recalculates
  (verified $0.40 → $0.80 → $0.96 for 4s→8s→1080p).
- **1080p requires 8s** (Veo constraint) — UI locks duration; server
  validates too (whitelists in config; never trust client — the endpoint
  spends money).
- Owner hit `429 RESOURCE_EXHAUSTED`: **Veo has NO free-tier quota**.
  Fix = enable billing on the key's project (aistudio.google.com/apikey).
  Adapter now rewrites quota errors into that actionable message.

## 4. Multi-provider + in-UI keys

- All four adapters implemented (owner: "미리 다 만들어두고 키만 넣게").
  Live-docs findings:
  - **Sora**: `POST /v1/videos`, seconds "8"/"16"/"20", status
    queued/in_progress/completed/failed, content download needs Bearer →
    proxied via `/api/video?provider=sora&ref=`. First real call returned
    *"Invalid size for sora-2 model, only 720x1280, 1280x720"* → base
    model is 720p-only; 1080x1920/1920x1080 are sora-2-pro. `sizeFor()`
    encodes this.
  - **Grok**: first real call returned *"Text-to-video is not supported
    for this model"* → `grok-imagine-video-1.5` is image-to-video ONLY.
    Adapter now mirrors the Grok Imagine product: text →
    `grok-imagine-image-quality` still → animate. Two billed steps.
    Poll: `GET /v1/videos/{id}` → done/failed/expired, `video.url`.
  - **Seedance**: BytePlus docs are JS-rendered, could not fetch —
    adapter written from prior knowledge (`ark.ap-southeast.bytepluses.com
    /api/v3/contents/generations/tasks`, text flags `--ratio --duration
    --resolution`). **UNVERIFIED** — expect to fix on first run.
- `/api/keys`: GET booleans + writable flag; POST (NODE_ENV=development
  only) writes `.env.local` AND `process.env` (works without restart).
  Env-var allowlist + key-shape regex. On Vercel: refuses, UI points to
  dashboard. Verified: GET truthy for GEMINI, 400 on unknown var.

## 5. Pivot to chat UI (owner-driven)

- Single-screen chat: left = session thread, right = preview-centered.
  Each message → `/api/refine` (Gemini 2.5 Flash, current cheap text
  model per live model docs) rewrites the full prompt with minimal edits
  over the previous take's prompt → auto-submits generation.
- Verified refine quality: Korean input → English prompt keeping the
  one-beat rule; "안경 씌우고 방을 어둡게" → only `wearing glasses` +
  `dimly lit bedroom` changed.
- **Rewind** = truncate thread after a turn (archive untouched).
  **Presets optional** (empty-thread only, default None).
- Optimistic timer: UI flips to SUBMITTING on the click frame (the
  1–3s provider submit used to look like a dead button).
- Failed-turn UX: click shows FAULT + error in preview with a Retry
  button; Retry uses current model/params (provider-switch retry flow).
- Sessions auto-save (max 20) — later moved into a Claude-style
  collapsible left sidebar (rail `≡`/`+`, slide-out panel, Esc closes,
  per-item delete). Closed by default.

## 6. Multimodal reference + continuity

- Drag&drop / paste / `+` button attach an image. Client downscales to
  1280px JPEG (payload) + 120px thumb (the only thing persisted).
- Reference mapping per provider: Veo `instances[0].image` (first frame,
  personGeneration→allow_adult), Grok data-URL into `image.url`
  (skips its image step), Sora multipart `input_reference` (must match
  target resolution — docs), Seedance `image_url` content item.
- Refine is multimodal (inline_data) and **history-aware**: last 6 takes
  (request + prompt) sent so "take 1의 배경" resolves. Verified: take-1
  background restored from history while keeping take-2's glasses.
- **Continuity** ("각 챗마다 나온 걸 compact하며 넘기기"): on take
  completion a mid-video frame is canvas-captured (crossOrigin=anonymous;
  tainted-canvas → silent skip for CORS-less CDNs) and auto-attached to
  the next take. Toggle in params (default ON); manual attach wins;
  `CONT` tag on turns that used it. Snapshots pruned to newest 3 turns
  at write time (localStorage quota).
- Honest limitation (told to owner): no provider offers video-to-video
  editing; "blend with take 1" happens at prompt/frame level only.

## 7. Spend analytics

- Archive (`hooklab.gallery`) is the ledger — append-only, survives
  rewinds; clips now carry `sessionId`.
- SPEND section: hero total + horizontal stacked bars per session,
  segments by provider, 2px surface gaps, row totals, legend, native
  tooltips. Costs are estimates (duration × published $/s; Sora
  `minSeconds: 8`); providers don't report billed totals — banner says so.
- Chart palette validated with the dataviz skill validator on #000
  (OKLCH band 0.48–0.67, worst adjacent CVD ΔE 23.8, contrast ≥3:1):
  veo `#1E9CC9` · sora `#8465DE` · grok `#BF7A22` · seedance `#3AA468`.
  Change them as a SET and re-validate, not individually.

## 8. Layout swap

- Owner: preview left / chat right is more natural (canvas-style LLM UI).
  Done via CSS `order` on `.output-col`/`.session-col` + grid columns
  `380px minmax(0,1fr)` — DOM order unchanged (chat stays first in
  source). Mobile stacks preview-first.

## 9. Public-repo prep + CORS fix + starter blocks

- **Repo prep**: standalone `git init`, secret sweep (all real keys only
  in `.env.local`; staged-file grep clean), `.gitignore` hardened to
  `.env` / `.env.*` / `!.env.example`. `.gstack/` logs (contain URL
  params) confirmed ignored. Initial commit `3bb60b0`. NOT pushed.
  Reminder: public repo ≠ public deployment — set `APP_PASSWORD` on
  Vercel or anyone can spend the keys through the UI.
- **Grok CORS**: `vidgen.x.ai` sends no CORS headers → snapshot capture
  errored in console and continuity silently failed. Fixed by proxying
  grok playback through `/api/video?remote=` (host allowlist
  `REMOTE_HOSTS`) + capture now only attempts same-origin URLs.
  Seedance still returns a raw URL → capture skipped quietly until its
  CDN host is known and added to the allowlist.
- **Starter blocks** (replaces the preset dropdown): visual card grids —
  6 CHARACTERS × 6 SETTINGS in `lib/prompts.ts`, combinable, either half
  optional (neutral fallbacks). Chat input on an empty thread = the
  action; empty action uses the default one-beat quiet-surprise reaction
  (pronoun-aware). `composeStarter()` assembles
  STYLE_PREFIX + subject + setting + action + STYLE_SUFFIX. Old
  `VARIANTS` removed.

## 10. Video references + visual/custom starter assets

- **Video attach**: drop/paste/pick a video → client extracts 3 frames
  (15/50/85%, 768px JPEG — same "compact" idea as take snapshots).
  All frames go to the refiner (`images[]`, Gemini reads subject/scene/
  motion arc); the MIDDLE frame goes to the video model (they accept one
  image). Handles MediaRecorder-webm's Infinity-duration quirk (seek-far
  hack). Verified headless with a synthesized webm → chip shows
  "Video reference · 3 frames extracted".
- **Visual starter cards**: cards render `/starters/<id>.jpg` when
  present (drop your own or bake with `bun scripts/bake-starters.mjs`,
  ~$0.04/image via gemini-2.5-flash-image — model id unverified, marked
  in script). Missing files fall back to text-only cards; note images
  that 404 BEFORE hydration escape React's onError — a post-mount scan
  hides them (naturalWidth===0 check).
- **Custom assets**: "+ Custom" card in each grid → inline form (name,
  pronoun for characters, prompt fragment, optional image downscaled to
  256px). Stored in localStorage `hooklab.customAssets`; deletable on
  hover. A selected asset's image is auto-attached as the FIRST take's
  generation reference (priority: manual attach > asset images >
  continuity snapshot; refine receives both char+setting images).
- Verified headless: custom character saved + auto-selected, video drop
  extraction, broken-image fallback (0 visible wrappers).

## Verification ledger (what was actually exercised)

- `bun run build` green after every feature.
- curl: auth 401s, param validation 400s, refine (plain / with-history /
  with-image), keys GET/POST-invalid.
- Headless browser (gstack browse): gate flow wrong→right password,
  cost recalc, stub/key panels, synthetic drag-drop → chip, fake error
  turn → FAULT+Retry, session switch both directions, sidebar open/list,
  spend chart render. NOTE: browse daemon dies between shell calls —
  do everything in one chained command; test data injected via
  localStorage only ever touched the headless profile, not the owner's
  browser.
- Real money paths exercised by the owner only (Veo quota 429, Sora size
  reject, Grok t2v reject — each produced the visible error it should).

## Deploy / teardown (unchanged from README)

`vercel` → env vars (`GEMINI_API_KEY`, optional `APP_PASSWORD`, others as
wired) → `vercel --prod`. Teardown: `vercel project rm reaction-hooks` +
revoke keys. Providers purge generated files (~2 days on Veo).
