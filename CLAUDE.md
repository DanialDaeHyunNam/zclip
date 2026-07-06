# HOOK LAB — agent handoff notes

Internal tool that mass-produces short vertical UGC "reaction hook" clips
via a chat-driven iterate loop. Built 2026-07-06 in one session; this file
plus `docs/DEVLOG.md` is the full context needed to continue without the
original conversation.

## Commands

```
bun install        # deps: next 16.2 / react 19.2 / typescript 6 only
bun dev            # http://localhost:3000 (owner usually runs it on 3001)
bun run build      # typecheck + prod build — run after EVERY change
```

No tests. Verification = `bun run build` + driving the UI headless
(see "How to verify" below). Next dev holds a single-instance lock —
if the owner's dev server is running, you cannot start a second one;
test against theirs (client-side checks only) or `next start -p <port>`.

## Architecture (all of it)

- **No server, no DB.** All state in browser localStorage. Route handlers
  are thin proxies so provider API keys never reach the client.
- `lib/config.ts` — THE switchboard. `PROVIDERS` registry (model ids, env
  vars, docs/key URLs, pricing, chart colors, `implemented`, notes),
  param whitelists, `estimateCostUsd()` (respects `minSeconds`).
- `lib/providers/*.ts` — one adapter per provider, interface =
  `submit(prompt, params) → {jobId}` / `status(jobId) → {state, videoUrl?}`
  (`lib/providers/types.ts`). `params.image` = optional base64 reference.
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
- `app/page.tsx` — the whole UI (single client component, ~900 lines):
  chat thread (turns) / rewind / sessions sidebar / preview / params /
  key panel / spend chart / archive. State shapes documented inline
  (`Turn`, `Clip`, `StoredSession`).

## localStorage keys

`hooklab.thread` (current session turns) · `hooklab.sessions` (history,
max 20) · `hooklab.sessionId` · `hooklab.gallery` (append-only clip
archive — the spend ledger; survives rewinds) · `hooklab.pw`.
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
- **Starter blocks** (empty thread only): visual CHARACTER × SETTING card
  picker (`lib/prompts.ts` — `CHARACTERS`/`SETTINGS`/`composeStarter`).
  Either half optional; chat text = the action (empty → default
  quiet-surprise beat). Free-form text with no blocks still works.
  Card images: `/public/starters/<id>.jpg` (bake via
  `bun scripts/bake-starters.mjs` or drop files — see that folder's
  README); users add their own assets via "+ Custom" (localStorage
  `hooklab.customAssets`, image doubles as the first take's generation
  reference).
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
| Seedance (`seedance-1-0-pro-250528`) | UNVERIFIED — docs were JS-rendered | Endpoint/shape from training knowledge, marked in adapter. Verify on first real run. |

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

## Open items / cheap next steps

- Seedance adapter unverified end-to-end.
- Grok pricing unpublished → cost shows "—"; fill `costPerSecondUsd`
  when known.
- Sora `input_reference` resolution-match constraint may reject continuity
  snapshots if aspect/res changed between takes.
- Retry does not re-send the reference image (only stored as thumb).
- Session titles = first message truncated; could LLM-summarize.
- `next.config.ts` empty; no ESLint configured (intentional, minimal).
