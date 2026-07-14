# ZCLIP — agent handoff notes (formerly HOOK LAB)

Internal tool that mass-produces short vertical UGC "reaction hook" clips
via a chat-driven iterate loop. Built 2026-07-06 in one session; this file
plus `docs/DEVLOG.md` is the full context needed to continue without the
original conversation.

## Commands

```
bun install        # deps: next 16.2 / react 19.2 / typescript 6 only
bun dev            # plain run = :3000 (Next default); the OWNER runs it
                   # via the root Makefile on http://localhost:3333
bun run build      # typecheck + prod build — run after EVERY change
```

No tests. Verification: while a dev server is RUNNING use
`bun x tsc --noEmit` (running `next build` clobbers .next and KILLS the
dev server — learned the hard way); full `bun run build` only when no
dev server is up. Next dev holds a single-instance lock — the owner
runs theirs on :3333 (root Makefile, changed 2026-07-13 — the file-backed
store survives port moves); test against it with client-side checks only.

## Architecture (all of it)

- **No server, no DB.** All state in browser localStorage. Route handlers
  are thin proxies so provider API keys never reach the client.
- `lib/config.ts` — THE switchboard. `PROVIDERS` registry (model ids, env
  vars, docs/key URLs, pricing, chart colors, `implemented`, notes),
  param whitelists, `estimateCostUsd()` (respects `minSeconds`).
- `lib/providers/*.ts` — one adapter per provider, interface =
  `submit(prompt, params, apiKey) → {jobId}` / `status(jobId, apiKey) →
  {state, videoUrl?}` (`lib/providers/types.ts`). `params.image` = optional
  base64 reference. Adapters NEVER read provider keys from process.env —
  the key arrives per request (see Hosted below); keys must never leak
  into error messages/logs.
- `app/api/generate` POST → submit, returns jobId fast (async pattern:
  video takes 60–180s; client polls). Validates params against whitelists
  server-side — never trust the UI.
- `app/api/status` GET `?id=&provider=` → one cheap poll.
- `app/api/video` GET → streams MP4s that need auth headers
  (Veo `?uri=`, Sora `?provider=sora&ref=`). Grok/Seedance return
  browser-fetchable URLs and bypass it. SSRF-guarded by host allowlist.
- `app/api/refine` POST → Gemini Flash (`gemini-2.5-flash`) rewrites the
  prompt conversationally. Multimodal (image), history-aware (resolves
  "take 1's background" from earlier takes' prompts). Always needs
  GEMINI_API_KEY regardless of the selected video provider.
- `app/api/keys` — GET: which env keys exist (booleans only) + writable
  flag; POST (dev only): writes key into `.env.local` AND `process.env`
  (effective immediately). Env-var allowlist in config `KEY_ENV_VARS`.
- `app/api/auth` — optional shared-password gate (`APP_PASSWORD` env).
  Client sends `x-app-password` header; `<video>` URLs use `?pw=` param.
- `app/chat/page.tsx` — the studio EVERYWHERE since v0.5.0 (the cloud gate
  is gone; hosted behavior keys off `useHosted()` client-side). The studio
  UI itself is `app/chat/studio.tsx` (the single big client component):
  chat thread (turns) / rewind / sessions sidebar / preview / params /
  key panel / spend chart / archive. State shapes documented inline
  (`Turn`, `Clip`, `StoredSession`).
- `app/flow` — the FLOW method (vs the chat method): still → motion
  pipeline. Stage 1 generates/uploads a look (`/api/image`, Grok image,
  ~$0.05) with a CONFIRM gate; stage 2 animates the confirmed still via
  the normal `/api/generate` i2v (Kling recommended) and can iterate
  motion forever without re-rolling the still. Interop both ways:
  finished takes → shared gallery/clip vault (Library), confirmed stills
  → custom Character cards. State in `hooklab.flows`. Rail ⇶ icon.
- `app/api/image` — still generation for Flow stage 1 (xAI Grok image,
  downloads the expiring provider URL server-side, returns base64).
- `app/page.tsx` — server shell (metadata + `isCloud()`) → `app/landing-client.tsx`
  (the bilingual EN/KO landing). Studio CTA → `/install` on cloud, `/chat` local.
- `app/run-local-guide.tsx` — macOS/Windows local-install guide (EN/KO),
  served standalone at `/install` and as the `/chat` gate. Ported from the
  Libertas page's terminal/trust-diagram kit, recolored to ZCLIP tokens.
- `lib/deploy.ts` — `isCloud()` = `VERCEL==="1"` (auto) or `ZCLIP_CLOUD` override.
  The one cloud-vs-local switch. `VERCEL` is server-only → call server-side,
  pass the result as a prop (why landing/chat are server shells).
- `lib/i18n.tsx` — EN/KO `LangProvider`/`useLang`/`LangToggle` for the PUBLIC
  pages only (studio stays English). Each page holds its own `COPY={en,ko}`.
  Always render `en` on server + first paint (hydration), then adopt stored/nav.

## Hosted (v0.5.0) — the cloud deploy is a real BYOK studio

Design SSOT: `docs/HOSTED.md`. The load-bearing rules:

- **Key pass-through**: hosted keys live in localStorage (`hooklab.keys`,
  via `lib/client-keys.ts` — NOT the file store, keys must never land in
  .zclip-data) and ride each API call in the `x-provider-key` header.
  `lib/server-keys.ts` resolves per request: header wins; env fallback is
  **LOCAL-ONLY** — on cloud a missing header refuses loudly (this is the
  owner-wallet firewall; never weaken it). `/api/keys` GET also reports
  provider env keys as absent on cloud for the same reason.
- **Never mutate process.env per request** — concurrent visitors would
  cross-bill. The key is an explicit adapter argument instead.
- **Veo/Sora playback/download on hosted** = client fetch with the key
  header → `URL.createObjectURL` (`lib/video-src.ts` cache + the
  `videoSrc()` resolver in studio/archive). The key must NEVER ride a URL
  query — Vercel logs full URLs, and the public copy promises "never
  logged". `?pw=` (APP_PASSWORD) in URLs is fine — that's the owner's own
  secret, pre-existing behavior.
- **Hosted feature walls** (each one points at /install): ref-video
  Seedance (owner Blob quota), >4.5MB Act-Two bodies (Vercel platform cap,
  checked client-side pre-send), GRAB/vault/store/key-writer (dev-only
  403s, unchanged).
- Landing is two-track since v0.5.0: local install = PRIMARY CTA; hosted
  studio = honest quick taste. Every hosted limit is an install touchpoint,
  never an apology (docs/HOSTED.md §1).

## localStorage keys

`hooklab.thread` (current session turns) · `hooklab.sessions` (history,
max 20) · `hooklab.sessionId` · `hooklab.gallery` (append-only clip
archive — the spend ledger; survives rewinds) · `hooklab.pw` ·
`hooklab.keys` (hosted BYOK keys — plain localStorage ONLY, never the
file store; the dashboard's hosted "Delete all data" wipes all hooklab.*).
Snapshots (video frames) are compacted to the newest 3 turns on write —
do NOT store full images/videos in localStorage (5MB quota).

## Key behaviors (product decisions — keep them)

- **Chat loop**: each message → refine (base = last take's prompt, minimal
  edits) → auto-generate. Prompt state accumulates across takes.
- **Rewind** truncates the thread after a turn; archive keeps all clips.
- **Retry** on a failed turn re-runs with the CURRENTLY selected
  model/params (lets you flip provider and retry).
- **Continuity** (toggle, default ON): after a take completes, a mid-video
  frame is captured client-side (canvas) and auto-attached to the next
  take as the image reference. Manual attachment wins over continuity.
  Cross-origin videos without CORS silently skip capture.
- **Starter blocks** (empty thread only, input-first): pill buttons under
  the chat input open a card CAROUSEL (9 characters × 10 backgrounds,
  `lib/prompts.ts`); picking one attaches a chip to the composer like a
  multimodal attachment. Composing fills a VISIBLE editable base-prompt
  textarea (`starterDraft`) — that exact text runs as take 1's base (no
  hidden prompt; cast is photogenic and camera-ready, neutral
  "Blonde 1"-style naming). Card images:
  `/public/starters/<id>.jpg` (bake via `bun scripts/bake-starters.mjs`
  or drop files); "+ Custom" assets live in localStorage
  `hooklab.customAssets`, their image doubles as take 1's generation
  reference.
- **Attachments are images OR videos** — a video is compacted client-side
  into 3 frames; refine sees all frames, the video model gets the middle
  one. Reference priority: manual attach > starter-asset images >
  continuity snapshot.
- **Costs are computed estimates** (duration × published $/s), not billing
  API readouts. Sora bills min 8s. Spend chart groups the archive by
  sessionId, stacked by provider, colors from `PROVIDERS[p].chartColor`
  (palette validated for CVD/contrast on #000 — keep the set together).
- **Errors must be visible** — every failure surfaces in the turn row
  and/or preview FAULT panel. Never fail silently.

## Provider facts (verified vs assumed — see DEVLOG for evidence)

| Provider | Status | Critical facts |
| --- | --- | --- |
| Veo (`veo-3.1-fast-generate-preview`) | verified live, working | 3.0 retired 2026-06-30. LRO: `:predictLongRunning` → poll `v1beta/{name}`. Download needs `x-goog-api-key`. 9:16 ✓, durations 4/6/8, 1080p⇒8s. NO free-tier quota (429 until billing enabled). RAI filter can eat outputs (`raiMediaFilteredReasons` handled). Image mode ⇒ `personGeneration: "allow_adult"`. |
| Sora (`sora-2`) | verified via API errors | Base model ONLY 720x1280/1280x720 (1080 sizes are `sora-2-pro`). `seconds` ∈ "8"/"16"/"20" ⇒ min bill 8s. Watermark. Download via `/videos/{id}/content` + Bearer ⇒ proxied. `input_reference` = multipart, must match target resolution. |
| Grok (`grok-imagine-video-1.5`) | verified docs, untested with key | NO text-to-video mode — adapter does text→image (`grok-imagine-image-quality`)→video, 2 billed steps. User image skips step 1 (data URL accepted — unverified). No aspect param; prompt text controls aspect. Poll status: done/failed/expired, url at `video.url`. |
| Runway Act-Two (`act_two`) | docs verified 2026-07-07, untested with key | THE real performance transfer. `POST /v1/character_performance` (`X-Runway-Version: 2024-11-06`) → poll `/v1/tasks/{id}`. Body: `character`={type:image,uri} (the face card), `reference`={type:video,uri} (driving clip), `ratio` 720:1280, `bodyControl`, `expressionIntensity` 1–5. Inputs are data: URIs (16MB cap → trim with GRAB). Output on CloudFront → proxied via `/api/video?remote=`. No text prompt. 5 credits/s = $0.05/s. Needs Standard plan+. |
| Seedance (`seedance-1-0-pro-250528`) | UNVERIFIED — docs were JS-rendered | Endpoint/shape from training knowledge, marked in adapter. Verify on first real run. |
| Kling (`kling-v3`) | UNVERIFIED — built from public API docs 2026-07-13 | `api-singapore.klingai.com/v1/videos/{image2video,text2video}` → poll same path + task id (jobId = `endpoint:taskId`). Auth = per-request HS256 JWT from `KLING_API_KEY`="AK:SK" (no static bearer; API plan is separate from the consumer sub). Durations "5"/"10" strings. Result = public time-limited CDN URL (vault promptly). ~$0.024/s 720p, $0.032/s 1080p (credit-price estimates). |

## Design system (do not drift)

Pure black `#000` with a faint starfield + one soft glow (body::before),
hairlines `rgba(255,255,255,.08)`, Inter 200–500 body, Space Grotesk
(--font-display) for wordmark/hero, JetBrains Mono 400 for technical
text, ONE accent `#6FDCFF`, errors `#ff5f56`, letterspaced uppercase
labels, 0.3s ease transitions. Shapes are FLUID: radius tokens
--r-sm/--r-md/--r-lg/--r-pill (pill buttons, rounded cards/frames,
Grok-style chat pill). Empty session shows the landing hero. Chart
categorical colors are the separate validated set in config — data
colors, not UI accents.

## How to verify changes (patterns that worked)

- `bun run build` after every edit (catches TS + route issues).
- Headless browser: `~/.claude/skills/gstack/browse/dist/browse` —
  the daemon dies between shell invocations; chain goto→wait→act→assert
  in ONE command, prefer `wait <selector>` over sleeps.
- Simulate states by injecting localStorage JSON then `location.reload()`
  (fake error turns, sessions, archive clips) — zero API cost.
- `/api/refine` is safe to curl-test with the real key (text = ~free).
  NEVER auto-trigger `/api/generate` in tests — real money (~$0.40/clip).

## Versioning / releases (IMPORTANT — don't skip on a release)

Version awareness: `package.json` `version` → inlined as `NEXT_PUBLIC_APP_VERSION`
(`next.config.ts`) → shown in the rail chip + landing footer. A LOCAL copy fetches
`CANONICAL_URL/api/version` (`lib/version.ts` = `zclip.vercel.app`) and, if the
deploy is newer, shows an update banner + `UpdateGuide`. Files: `lib/version.ts`,
`lib/use-version.ts`, `app/api/version/route.ts`, `app/chat/update-guide.tsx`,
`data-hosted` stamp in `app/layout.tsx`.

**Every release MUST bump `package.json` version + add a `CHANGELOG.md` entry +
tag + `gh release create` + redeploy** — else the update prompt never fires (a
local copy thinks it's current forever). Full steps: `docs/ARCHITECTURE.md` §
Releasing. Preview locally: `NEXT_PUBLIC_APP_VERSION=0.0.1 bun dev`.

## Open items / cheap next steps

- Seedance 1.0 provider pricing still `costPerSecondUsd: null` (cost "—");
  Seedance 2.0 variant ships with ESTIMATED pricing ($0.10/$0.22 — "until a
  metered run", config comment). Confirm both against a real billed run.
- Session titles = first message truncated; could LLM-summarize.
- Sora `input_reference` res-match: `normalizeRefB64` now cover-crops every
  reference to the selected 720×1280/1280×720 at send time (mitigated) —
  not yet confirmed against a live Sora call.
- `next.config.ts` empty; no ESLint configured (intentional, minimal).

Resolved (kept for history): Grok pricing filled ($0.08/s flat, docs.x.ai;
retro-backfilled in DEVLOG #25). Retry-without-reference no longer silently
re-bills — `retryTurn` refuses loudly when `usedRef` (visible-errors principle).

## Video Prompt Spec Gate (handoff from mono 2026-07-12 — WIRED same day)

The owner's photoreal prompt discipline (15-section template + timecoded
cut board, proven on Seedance 2.0 / Veo 3.1) lives in the studio as a
pre-generation gate. SPEC toggle in the composer (session-only, off by
default): draft → `/api/spec-check` (SEPARATE track from refine, NO
900-char clamp; provider-aware via `MODEL_PROFILES`) → an IN-COMPOSER
stepper (`SpecFlowState`, DEVLOG #30 — the input area itself asks one
question at a time: chips/textarea + OK confirm, loud loading lines,
always-visible "skip checks, run as typed", ✕ returns the draft) → review
step (clamped prompt + SELF_CHECKS + cost + explicit Generate) →
`/api/generate` VERBATIM — never through refine. Model switch re-checks
the open stepper against the new profile. The interview writes NOTHING to
turns/store until Generate (in-memory; dies with reload alongside the ref
bundle — which is exactly why it's safely headless-testable against a
live dev server). Spec takes render their prompt OPEN in the thread
(max-height box + ⤢ full-view/copy modal, `fromSpec`). Legacy `kind`
turns from pre-stepper sessions are skipped at render — keep the
`!t.kind` guards when touching the thread.

Key onboarding (DEVLOG #28): text-only send without GEMINI_API_KEY →
pitch modal (key saves to `.env.local` like the provider panel; saving
turns SPEC on and interviews the interrupted draft). Decline
(`hooklab.specDeclined`) ⇒ key-less sends go out exactly as typed
(verbatim fallback — they used to error in refine). The SPEC button is
the permanent re-entry: key-less click reopens the modal, always.

- Design + UX + versioning contract: `docs/VIDEO-PROMPT-SPEC.md`
- **SSOT = `lib/video-prompt-spec.ts`** (SPEC_VERSION, sections/gates/
  self-checks/MODEL_PROFILES). The mono repo's skill is RETIRED
  (2026-07-12, owner call) — no cross-repo sync; rule changes happen here,
  gated by a Spec Lab win, with a version bump + in-file CHANGELOG line.
  App plumbing (API shapes, runSelfChecks, profile helpers): `lib/spec-check.ts`.
- References ride the interview: text + attachments ⇒ interview runs AND
  the bundle (parked in `specRefsRef`, never persisted) lands on the final
  generate; reload loses it ⇒ generate/skip refuse loudly. Empty text ⇒
  classic flow untouched.
- **Spec Lab** (BUILT, owner-machine only): `http://localhost:3333/lab` —
  live spec vs a `/lab/snapshots/*.json` candidate on one brief, both
  assemble+generate (2× cost shown up front), side-by-side, winner →
  `/lab/ledger.json` + a paste-ready mono changelog line. ⚠️ The ENTIRE
  feature lives in gitignored `/app/lab` + `/lab` (repo is open source —
  no lab code may ship; imports one-way lab→lib; NO tracked file may
  import from lab or a cloner's build breaks). `isCloud()` 404s it as a
  second belt. See `/lab/README.md`.
