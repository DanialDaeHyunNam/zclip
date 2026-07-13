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

## 27. Video Prompt Spec Gate wired (mono handoff) + gitignored Spec Lab

- Mono's photoreal discipline (15 sections, timecoded cut board) became a
  pre-generation gate. `/api/spec-check` is a SEPARATE track from refine
  (900-char clamp stays on refine only; spec prompts run 2–4k chars,
  maxOutputTokens 4096). check → strict-JSON {missing, note, warnings}
  validated server-side against real gate ids (a hallucinated id can't
  wedge the interview); assemble → the 15-section prompt, submitted to
  `/api/generate` VERBATIM (refine on top loses the double locks).
- Per-model adaptation is structural: both modes read `MODEL_PROFILES`
  (promptLanguage / maxSeconds / avoid → warnings; assembleHints appended
  at assembly; extraGates merged into the critical list). Quick-reply
  chips clamp to maxSeconds programmatically ("TikTok 15s" never shows on
  Veo's 8s cap). Deterministic rules live in CODE, not the prompt — LLM
  kept missing "one-take ⇒ cut-board resolved", so the route enforces it.
- Gate cards are Turns with `kind: "gate" | "preview"` so rewind/sessions
  work unchanged; every take-numbering site now filters `!t.kind`
  (takeNo() helper). Cards snapshot question/options at ask time; one
  card per turn; free text + chips; "skip checks, run as typed" always
  visible; the pre-spend confirm moved from Send (interview is ~free) to
  the preview card's Generate / the skip hatch. Model switch replaces an
  open card and re-checks under the new profile (keyed off the card's
  stored provider — no effect loops).
- **Spec Lab** (owner-only A/B arena) — the repo is OSS, so the ENTIRE
  feature sits in gitignored `/app/lab` (route `/lab`, its own assemble/
  snapshots/verdict API routes) + `/lab` (snapshots, ledger.json,
  README). Import direction lab→lib only; the lab assembler is a
  deliberate COPY of the public one parameterized by posted spec JSON.
  `isCloud()` 404s everything as a second belt. Verified: no tracked file
  references lab (grep), `git check-ignore` passes both folders.
- Verified with the owner's dev server live on :3000 (`bun x tsc
  --noEmit`, NOT build): curl spec-check on vague/answered drafts (missing
  shrinks, grok/veo profile warnings fire), assemble 2.4–3.3k-char
  15-section outputs, lab snapshots/verdict/assemble live, /lab renders.
  UI thread flow NOT exercised headlessly on purpose: the store is
  file-backed (`.zclip-data`) and shared with the owner's session —
  sending headless messages would write into their real thread (see the
  live-state incident rule). Read-only DOM/screenshot checks only.

## 28. Gemini-key onboarding for the spec interview (owner's UX spec)

- Owner's 4-step flow: video key in + send → if no GEMINI_API_KEY, a
  pitch modal sells the interview ("a few optimized questions, far more
  believable clips"), key saves to .env.local exactly like the provider
  key panel, then the interrupted send runs the spec interview (opt-in is
  implicit — saving the key turns SPEC mode on). Decline = honest
  fallback: that send AND future sends go to the video model exactly as
  typed (submitVerbatim — previously key-less sends just errored in
  refine), remembered in `hooklab.specDeclined`. The SPEC button next to
  Send is the permanent re-entry: with no key it reopens the same modal
  forever, even for decliners.
- Decision kept from the cost discussion: conversation layer stays on
  Gemini Flash (same ONE key as refine; free tier covers it) — a second
  provider key for a cheaper mini model would save <1% of a take's cost
  and add onboarding friction. Assembly is the arm you'd upgrade (a bad
  prompt wastes a $0.4–1.6 clip), and ONLY via a Spec Lab win.
- In practice the modal fires for Sora/Grok/Seedance users: Veo's
  provider key IS GEMINI_API_KEY, so key-less Veo is blocked earlier by
  keyMissing. Cancel (backdrop) keeps the draft in the composer; decline
  still passes through the pre-spend confirm (it's real money).
- Modal untested live (owner's dev server has the key set; removing it to
  test would touch live state) — tsc + read-only render check only.
  First key-less user flow needs one real pass.

## 29. References ride the spec interview; spec SSOT moves into ZCLIP

- Owner corrected the text-first restriction: attachments are NOT a
  separate mode. Text + images/cards/pins ⇒ the interview runs AND the
  references land on the final generate (same priority rules as the
  classic flow — the routing branch deliberately sits AFTER the classic
  ref computation so charImg/dressWithFashion/lastSnap/seedance-2 rules
  are reused, not re-implemented). Empty text ⇒ classic flow untouched.
- Bundle lifetime is the hard part: reference bytes can't live in
  localStorage (5MB) or the thread, so they park in `specRefsRef` keyed by
  flowId. Consumed one-shot at generate/skip; a reload or a newer send
  invalidates it and the cards' "riding along" labels turn into a LOUD
  refusal (retryTurn precedent — never bill without what the user
  attached). Primary image re-normalizes at submit time (aspect can
  change mid-interview).
- The checker/assembler SEE the references: card prompts + pinned-take
  prompts go as a context block, frames as multimodal parts — verified
  live: a character card + "one-take" draft returns missing:[] (no
  redundant questions about who's on screen). Assembler grounds
  SUBJECT/SCENE in the same context.
- **SSOT moved**: the mono skill is retired (owner call — GUI iteration
  beats skill-file editing). `lib/video-prompt-spec.ts` is now the single
  source of truth; version bumps happen here, gated by Spec Lab wins;
  the lab page's paste-line now targets this file's CHANGELOG block, not
  mono. All mono-sync language stripped from docs/CLAUDE.md/lab.
- sendGuarded's confirm matrix: interview start (free) and pitch-modal
  open skip the pre-spend confirm; every path that actually submits money
  (preview Generate, skip hatch, pitch decline, declined-fallback send)
  still passes guardRun exactly once.
- Follow-up (owner): performance transfer stays a classic-flow feature —
  a video reference on a non-clip-reading model AUTO-BYPASSES SPEC for
  that send (soft note; Seedance 2.0 keeps SPEC). The bypass is a money
  path so it does NOT skip the confirm (also fixed: empty-text SPEC sends
  used to slip past guardRun into the classic flow unconfirmed). Model-
  switch-mid-interview edge still gets the ⚠ look≠motion card warning.
  SPEC-off tooltip now RECOMMENDS turning it on (short pitch).

## 30. Spec interview moves INTO the composer (owner UX revision)

- Owner rejected thread question-cards ("위에서 확인하는 거 싫음") and the
  passive "Spec gate is thinking…" placeholder. Rework: the composer
  itself becomes the stepper (SpecFlowState: checking → asking →
  assembling → review) — question + chips/textarea + OK confirm, loud
  loading lines with animated dots, review with clamped prompt +
  self-checks + Generate, skip hatch on every step, ✕ returns the draft.
  Thread shows ONLY finished takes; spec takes render their prompt open
  (max-height box + ⤢ full-view/copy modal, `fromSpec` flag).
- Big architectural win discovered: the stepper writes NOTHING to
  turns/store until Generate — interview state and the ref bundle are
  both in-memory and die together on reload (the lost-references refusal
  guard became unnecessary and was removed). This also made the
  interview HEADLESS-TESTABLE against the live dev server for the first
  time (no risk to the owner's shared .zclip-data store): exercised
  end-to-end — send → loading → "One-take or multi-cut?" chips → answer
  → "1 ANSWERED" → next check — zero thread turns created.
- Legacy `kind: "gate"/"preview"` turns from pre-stepper sessions are
  skipped at render (fields kept on Turn for stored-data compat); all
  !t.kind guards stay. SpecCard component deleted.
- Ops scar: a python file-truncate keyed on a comment PREFIX hit the
  same prefix in the Turn interface docs and chopped studio.tsx to 97
  lines — recovered via git checkout + full re-apply. Lesson: anchor
  destructive text ops on UNIQUE anchors (rfind + content asserts), or
  just use the Edit tool.

## 31. CHASE reference intake — spec 1.0.1 + first real Spec Lab candidate

- Owner supplied a second reference-grade Seedance 2.0 artifact (CHASE
  fan-meeting dressing-room vlog, 15s/1080p/24fps) WITH its prompt.
  Frame-verified (16-frame ffmpeg grid): zero burned subtitles despite 8
  script-style dialogue lines; mid-video prop (ribbon hairpin) persists
  through every later cut; the whip pan hits exactly the props named in
  the camera-relative spatial map; @ image reference OVERRODE the text's
  hair description (image owns identity).
- Ported per the improvement gate. Profile-only now (SPEC_VERSION 1.0.1):
  seedance assembleHints — '@ image' inline token + image-owns-identity +
  script-lines-safe; long experimental note. Structural ideas went to
  /lab/snapshots/1.1.0-storyboard.json for A/B: beat-rhythm arrow line
  (new 'rhythm' section), spatial blocking in scene, per-cut
  '(Cut N · ~X sec · shot type)' headers with named camera grammar,
  linger-ending variant, prop-lifecycle continuity, off-screen audio
  events. NOT shipped live — Grok verifiedly needs the bans this
  reference omits, so labeled-blocks-vs-storyboard is exactly a Spec Lab
  question.
- lib/spec-check.ts: ending-hold self-check now accepts 'camera
  lingers …' as a hold variant.

## 32. FLOW method (still → motion pipeline) + Kling provider

- Owner spotted the viral still→motion pipelines (image model → Kling
  motion → publish at scale) and wanted a pipeline METHOD next to the
  chat method. `/flow`: Stage 1 STILL — generate via new `/api/image`
  (Grok image, ~$0.05, expiring provider URL downloaded server-side →
  base64) or upload; attempts grid; CONFIRM gate locks the look.
  Stage 2 MOTION — i2v on the confirmed still via the normal
  `/api/generate` (model select, Kling ★ recommended); iterate motion
  endlessly, the still never re-rolls. Two-step inline money confirm on
  both stages (browser dialogs are banned; guardRun lives in the studio).
- Interop by design: finished motion takes vault + append to the SHARED
  gallery (sessionId = flow id → Library + spend chart just work);
  confirmed stills save as custom Character cards (hooklab.customAssets)
  for the chat studio; rail ⇶ links both ways. Flow state in
  `hooklab.flows` (file-backed store, dataURLs are fine there).
- Kling provider added (6th): adapter UNVERIFIED (public docs
  2026-07-13) — api-singapore JWT AK:SK per request (KLING_API_KEY =
  "AK:SK"), i2v/t2v endpoints, jobId carries the endpoint for polling,
  5/10s duration grid (effectiveSeconds snaps), ~$0.024–0.032/s
  estimates. GUIDE entry: "Volume king — cheapest fluid motion";
  MODEL_PROFILES.kling with motion-first assembleHint.
- NOT exercised with money: /api/image (real $0.05/shot) and the Kling
  adapter end-to-end. Render/interaction verified read-only.

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
