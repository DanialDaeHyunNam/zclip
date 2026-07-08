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

## 11. Baked assets + fluid design refresh

- Baked all 12 starter images via `scripts/bake-starters.mjs`
  (gemini-2.5-flash-image worked as-is, 3:4 aspect config accepted).
  Prompts tuned for photogenic, natural output; owner reviews visually — re-bake singles with
  `bun scripts/bake-starters.mjs <id> --force`.
- Design refresh (owner: "too boxy/boring"): Grok-style ambient
  backdrop (inline-SVG starfield + one soft accent glow on body::before),
  OpusClip-style fluid shapes — radius tokens (--r-sm/md/lg/pill) across
  all controls, pill buttons, Grok-style single-container chat pill with
  focus ring. New display font Space Grotesk (--font-display) for the
  wordmark + a landing-style hero on the empty session ("Make the hook."
  with gradient accent). The old square-corner rule in CLAUDE.md is
  superseded by this.

## 12. Asset library v2 + input-first picker

- Characters diversified to 9 (Blonde/Korean/Redhead/Black Girl/Latina/
  Mom + White/Black/Asian Guy), ALL prompts tuned to a photogenic,
  camera-ready cast (fallback subject included).
  Neutral catalog naming ("Blonde 1", "Black Guy 1") per owner.
- Settings expanded to 10 (added Park/Mountain/Beach/Rooftop 1).
  All 19 card images re-baked (male-specific bake wrapper; one 503
  retried). freckles asset removed.
- Input-first UX (Grok reference): the big grids are gone — pill buttons
  under the chat input ("✦ Character · <sel>", "◫ Background") toggle a
  horizontal card carousel; picking one attaches a round-thumb chip to
  the composer like a multimodal attachment.
- NO hidden prompt: composing blocks fills a visible, editable
  "BASE PROMPT · YOURS TO EDIT" textarea (`starterDraft`) — that exact
  text (user edits included) is what take 1 runs on; the message field
  layers the action on top via refine.

## 13. Cast v3 (realistic texture, 27 variants), ZCLIP rebrand, UI declutter

- Rebrand: HOOK LAB -> ZCLIP ("clips for the Z feed"). localStorage keys
  intentionally stay `hooklab.*` so existing browser data survives.
- Cast: every concept now ships 3 numbered variants (27 portraits),
  generated from CHAR_BASES in lib/prompts.ts. ALL ages unified to 20s —
  age shifts are a chat instruction ("make her look ten years older").
- Texture realism: bake wrappers rewritten to candid unedited iPhone
  selfie (visible pores, no beauty filter/retouching, everyday light);
  tone calibrated to "best-looking person you actually know", not
  celebrity. All 27 re-baked; backgrounds unchanged.
- Expression audit (owner request): repo-wide scan for blunt
  appearance/Korean phrasing — code, prompts and docs now use neutral
  casting language ("photogenic, camera-ready"); scan clean.
- UI declutter (owner): removed the prompt-rule hint under the input,
  the dashed empty-state guidance box, and the header model-meta line
  (model/aspect/duration already live in the params panel).

## 14. Realism-first prompts, layout alignment, Asian rename

- Video-prompt realism (owner: "질감에 모든 걸 걸어"): STYLE_SUFFIX now
  demands hyper-realistic found-footage texture (visible pores, no
  beauty filter/airbrushing) + natural micro-expressions/blinking;
  defaultAction adds natural blinks/relaxed posture. /api/refine SYSTEM
  now FORBIDS removing these clauses in rewrites (adds them if missing).
- Character prompt audit: all 27 fragments + fallback use neutral
  phrasing (no skin-tone comparatives, no body objectification) — grep
  clean. "Korean" line renamed to "Asian Woman" (owner call), ids
  korean-N -> asian-f-N (images renamed, not re-baked), core text now
  "East Asian", K-beauty term dropped.
- Left/right bottoms now align exactly (grid stretch + thread flex:1,
  chat pill is the last element; measured diff 0px). Params panel
  collapsed into one chip-style dropdown strip under the frame (model
  select max-width + ellipsis); big MODEL field, params grid and 1080p
  hint are gone. Starter pills/carousel moved back ABOVE the input.

## 15. Pinned take context (multimodal-style)

- Any finished take now has a "❐ Context" button: pinning attaches it to
  the composer as a chip (snapshot thumb + "Take N"), send works with
  pins alone ("Blend take 2 + take 4" default message).
- Backend: /api/refine gets `contexts: [{take, prompt}]` as PINNED
  CONTEXT TAKES — system prompt treats them as primary source material
  (higher priority than ambient history). Pinned takes' snapshots feed
  the refiner images AND the generation reference (precedence: manual
  attach > pinned snapshots > starter assets > continuity).
- Resulting turn is tagged "CTX T2 T4". Pins clear on send/rewind/
  session switch. Soft warning (amber) at >3 pins — beyond that the
  refiner averages references into mush; no hard cap by design.
- Verified: chips + warning + ctx-only send headless; curl refine with a
  pinned take pulled its subject/room into the rewrite exactly.

## 16. Landing page (now at /)

- OpusClip-style punchy landing at /landing (server component, static):
  badge, "1 prompt, 10 takes. / Hook 10x faster." gradient hero, dual
  CTA (Launch Studio + Star on GitHub), mono stat strip, 6 feature
  cards (cast card shows real baked portraits), 3-step workflow section
  pitching hook -> cut.donkeyuse.com (owner's AI copilot editor) ->
  ship, open-source star ask in hero + footer.
- Routes: landing serves at `/` (app/page.tsx), the studio moved to
  `/chat` (app/chat/page.tsx); studio header "About" links back to `/`.
  REPO_URL in app/page.tsx is a placeholder — set after `gh repo create`.
- Landing offsets the global 52px rail padding via negative margin.

## 17. Landing v2: legible hero, differentiators, animated demo reel

- Hero says what it is at a glance: "UGC reaction hooks, / typed, not
  filmed." Animated DemoReel below the CTAs (app/demo-reel.tsx): a
  state-machine miniature of the real flow — type -> render timer ->
  take lands with cost -> pin as context -> next take builds on it —
  using real baked portraits, ~19s loop, no video file.
- "Why it's different" numbered section replaces the feature grid:
  01 model-swap mid-chat (4 today, adapters open) / 02 takes-as-context
  with THE BIG ONE badge / 03 "video-to-video, in spirit" (honest
  framing of the frame-compaction pipeline) / 04 actually-multimodal
  input / 05 built-in spend dashboard. Cast strip + "also in the box"
  one-liner keeps the rest.
- Workflow: cut.donkeyuse.com step now notes cut is open source and
  free as well.

## 18. Demo reel plays REAL ZCLIP output (3-act, frame-chained)

- Generated a 3-act story through the actual pipeline, each take seeded
  with a canvas-extracted frame of the previous one (the app's own
  continuity mechanism, driven headless): bedroom quiet-surprise ->
  slow push-in on the held reaction -> later that night in pajamas
  (~$1.20 total; the first cafe attempt had her eating a burger — owner
  killed it, story reworked). public/demo/take-{1,2,3}.mp4, ~2.2MB.
  DemoReel is a ~27s 3-phase loop with CTX T1/T2 rows; caption states
  the takes are real and each built on the last. Gotchas: browse js
  drops async evals >2s (use kickoff -> visible DOM marker -> chunked
  sync reads), and React's muted-as-property misses autoplay policy
  (force el.muted + play() in a ref).

## 19. Demo recast: Asian lead, dramatic acts, half-speed loop

- Owner feedback: pajamas never appeared (frame-seed beats wardrobe
  prompts — LEARNING: seed frames for emotion/camera changes, go
  prompt-chain-only for wardrobe/location changes), acts too tame, loop
  too slow, recast to the Asian lead.
- Regenerated all three takes (~$1.20): asian-f-1 bedroom quiet-surprise
  -> big laugh burst (T1-frame-seeded) -> golden-hour rooftop showing
  the phone (prompt-chain only, deliberate). Demo copy now matches the
  clips; loop tightened 27s -> ~15s (typing 3 chars/tick, ~1.4s renders).

## 20. Expression-drift diagnosis + Veo daily quota hit

- Owner: takes 2/3 lost the 'wait-what' expression. Diagnosis with
  evidence: refine had preserved the action sentence VERBATIM (checked
  P1 vs P2 text) — the model ignored it. Root cause is scene-emotion
  contagion: "friends laughing behind her" primes the subject to smile;
  "chic leather jacket" primes editorial-calm. A mid-prompt action line
  loses to scene mood priors.
- Fixes: (a) refine SYSTEM now instructs — keep action verbatim, no
  emotional actions on background characters, add explicit counters
  ("she does not smile", "first frame to last") when a kept expression
  is requested; (b) scripts/regen-demo-takes.sh holds the hand-tuned
  final prompts (neutral friends, expression doubled in subject+action,
  counter-negatives) — BLOCKED on Veo daily request quota (429 persisted
  past 65s = RPD cap, resets ~midnight PT; failed submits cost nothing).
  Run the script when quota resets, then eyeball frames.

## 21. Demo takes 2/3 regenerated on Grok — expression finally held

- Veo daily quota stayed exhausted after billing payment (payment != 
  quota reset; RPD resets midnight PT). Owner: "그냥 grok 써" — reran the
  expression-hold prompts through the Grok adapter (text->image->video).
  Frame check: T2 wide-eyed mid-'whaaaat', friends neutral, dusk skyline;
  T3 leather jacket + same rooftop, reaction held (no smile). The
  emotion-contagion fixes (neutral background friends, doubled
  expression, counter-negatives) worked on the first try.
- Demo labels: takes 2/3 now say GROK (also demos model-swap); spend
  line "$0.40+ · VEO + GROK". regen script accepts PROVIDER env.
- Ops note: two zombie next-server processes + a dead port after the
  earlier pkill; setsid doesn't exist on macOS — plain nohup works.

## 22. Natural surprise arc (owner's reference clip, beat-mapped)

- Owner supplied a 12s real UGC reaction as the gold standard. Decoded
  arc: talking mid-sentence -> glance at phone -> brows lift -> eyes
  widen + hand rises -> hand over mouth peak -> glance-aside re-check ->
  delighted disbelief. Encoded as surpriseArc() in lib/prompts.ts with
  TIMESTAMPED beats (models follow beat maps better than adjectives).
- composeStarter now picks by duration: <=4s keeps the one-held-beat
  rule (overacting guard), 6-8s gets the full arc automatically — the
  visible base prompt shows it when DURATION is 6S/8S. Refine SYSTEM
  teaches the same craft (beat maps for long takes, slow hand-to-mouth
  allowed, "no frantic gestures" replaces "no hand movements").

## 23. Reference aspect normalization + 1-15s duration gauge

- Card-as-reference bug pair (owner hit both): a 3:4 card into a 9:16
  grok request made the model TILE the frame vertically (two stacked
  copies) and drop likeness. Fix: normalizeRefB64 cover-crops the ONE
  image sent to the video model to the selected aspect (720x1280 /
  1280x720) at send time — applies to cards, manual attachments, pinned
  snapshots. Face now holds (owner confirmed).
- Duration select (4/6/8) replaced with a 1-15s range slider. The
  slider is a REQUEST; effectiveSeconds() in config is the single
  source of truth for provider snapping (Veo 4/6/8, 1080p=>8; Sora 8;
  Grok/Seedance clamp 1-15) — used by the veo adapter, the cost
  estimate, and the gauge label ("12S -> 8S" when snapping). Server
  validates 1-15 integers; adapters enforce their own grids.
- Ops rule learned: NEVER run `bun run build` while a dev server is
  running (it clobbers .next and kills it) — use `bun x tsc --noEmit`
  for verification; the owner runs dev on :3000, singleton lock blocks
  a second instance.

## 24. Performance transfer (video = how, card = who)

- Owner asked for face-swap-style motion keep. Honest ceiling with our
  APIs (no provider takes driving video + identity image): dense-sample
  the reference video (up to 10 evenly spaced frames at 640px), have
  the multimodal refiner TRANSCRIBE the performance into a timestamped
  beat map (expression/gaze/head/hands/camera per segment, scaled to
  the effective take length), and generate with the CHARACTER CARD as
  the identity reference. Trigger is implicit: video attached + card
  selected on the first take => transfer mode (chip says "performance
  source (face from card)"); refiner is forbidden from carrying the
  source person's identity. Attaching a video also nudges duration to
  the nearest 4/8/12 of the source length; refine frame cap raised to 12.
- NOT pixel motion transfer — it's transcription + recast. True driving-
  video tools (Runway Act-One etc.) or Sora characters/edits endpoints
  are future options; Sora characters need consent verification.
- Rights note for the owner: only transfer performances you own or have
  license to imitate; identity never copies, but choreography does.

## 25. Spend in header, archive as rail overlay, retro-pricing

- Spend chart lives in a popover off a chart icon next to SESSION (mini
  total always visible); the big bottom section is gone. "+N?" meant
  clips saved before a provider's pricing existed — boot now BACKFILLS
  costUsd from stored duration x current rates, so old Grok takes get
  real prices retroactively (seedance stays unpriced).
- Archive restructured: the chat page shows only the CURRENT session's
  takes; a new ▦ rail icon opens a full-screen overlay with every take
  grouped by owning session (Clear All lives there). Card markup
  extracted into ClipCardView. First splice attempt corrupted JSX —
  recovered via git checkout + component-based rewrite (lesson: never
  string-slice JSX blocks; extract components instead).

## 26. Public deploy = about page, studio gated to local, EN/KO, docs

- Owner: put the about page on Vercel, but when someone tries to actually
  run the studio, show a mac/Windows install guide (à la
  all-libertas.vercel.app) and make clear it only runs locally. EN/KO only.
  Plus a detailed README + a separate technical doc for people who fork it.
- **Cloud-vs-local switch** = `lib/deploy.ts` `isCloud()`: `VERCEL==="1"`
  (auto on Vercel, nowhere else) or `ZCLIP_CLOUD` override. `bun dev`/local
  `bun start` read as local; only a real deploy gates.
- **Server/client split on /chat** (the important move): `app/chat/page.tsx`
  became a SERVER component that renders `<Studio>` (moved to
  `app/chat/studio.tsx`, unchanged) locally, or `<RunLocalGuide gated>` on
  cloud — so the 2800-line studio bundle never ships to a cloud visitor.
  `app/page.tsx` likewise split into a server shell + `app/landing-client.tsx`.
- **Install guide** `app/run-local-guide.tsx` (also standalone at `/install`):
  ported the Libertas kit — mac/Win segmented toggle (state, persisted to
  `zclip.os`), terminal mocks with copy buttons + expected output, a
  "runs on your machine / nothing on our servers" trust diagram, numbered
  steps (install bun → clone → bun install → bun dev → paste key), cost
  callout — recolored to ZCLIP tokens (`#000`/`#6fdcff`/JetBrains Mono).
- **i18n** `lib/i18n.tsx`: tiny `LangProvider`/`useLang`/`LangToggle`, PUBLIC
  pages only (landing + guide; studio stays English — owner's scope call).
  Persists `zclip.lang`, mirrors `<html lang>`. Hydration rule: render `en` on
  server + first paint, adopt stored/nav in an effect (no localStorage in
  useState init). Each page owns its `COPY={en,ko}` deck.
- **Docs**: README overhauled (hosted-site-is-an-about-page model, unlock-a-
  hosted-studio recipe with `APP_PASSWORD`+`ZCLIP_CLOUD=0`, route map) + new
  `docs/ARCHITECTURE.md` (mental model, repo map, request lifecycle, the
  two-function adapter contract + add-a-provider, config switchboard,
  localStorage shapes, the gate, i18n, security, dev/verify rules, gotchas).
- Verified with dev server live on :3000: `bun x tsc --noEmit` clean (NOT
  `bun run build` — would kill the owner's server); `/`, `/install`, `/chat`
  all 200; SSR markers present (landing 한국어 toggle + English default,
  guide trust-diagram/req/mac-win, /chat local still the studio w/ rail).
  The gated cloud render is the same verified component + swapped hero —
  confirm on a Vercel preview or `ZCLIP_CLOUD=1 bun dev`.

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
