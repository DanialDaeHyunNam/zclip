# ARCHITECTURE — ZCLIP

Everything you need to fork this, add a model, translate it, or bend it to
your own workflow — without reverse-engineering the whole thing first. Read
[`README.md`](../README.md) for *what* it is and *how to run it*; this file is
*how it's built* and *where to push on it*. The chronological build log with
evidence for every decision is [`DEVLOG.md`](DEVLOG.md); the terse agent
handoff notes are [`../CLAUDE.md`](../CLAUDE.md).

---

## 1. The mental model in one breath

> A chat UI in the browser talks to a handful of thin Next.js route handlers
> whose only job is to keep provider API keys off the client. There is **no
> database and no application server** — every session, take, and dollar of
> spend lives in your browser's `localStorage`.

Consequences that explain most of the codebase:

- **Local-first.** The app is designed to run on *your* machine with *your*
  keys. The public Vercel deploy is an about page; the studio is gated there
  (§7). This is a security posture, not a limitation.
- **Async everywhere.** Video takes 60–180 s. Serverless functions must
  return fast, so generation is submit-now / poll-later (§3).
- **Never trust the client.** The UI is a convenience; the route handlers
  re-validate every parameter against server-side whitelists, because those
  handlers spend money.
- **Keys are booleans to the client.** The browser only ever learns *whether*
  a key exists, never its value.

---

## 2. Repo map

```
app/
  page.tsx            server shell: metadata + isCloud() → <LandingClient>
  landing-client.tsx  the bilingual (EN/KO) landing / about page
  run-local-guide.tsx macOS/Windows local-install guide (EN/KO)
  install/page.tsx    standalone /install route → <RunLocalGuide>
  chat/
    page.tsx          SERVER GATE: studio locally, install guide on cloud
    studio.tsx        the entire studio UI — one big client component
  dashboard/page.tsx  spend dashboard
  demo-reel.tsx       the landing's self-referential animated demo
  rail.tsx            the always-visible left rail (sessions / archive / grab)
  globals.css         all styling (design tokens at the top)
  api/
    generate/         POST → adapter.submit()  → { jobId }         (spends $)
    status/           GET  → adapter.status()  → { state, videoUrl? }
    video/            GET  → streams provider MP4s that need auth headers
    refine/           POST → Gemini Flash rewrites the prompt (multimodal)
    keys/             GET booleans + writable flag; POST writes .env.local (dev)
    auth/             optional shared-password gate (APP_PASSWORD)
    grab/             dev-only: yt-dlp / ffmpeg reference downloader
    dress/            wardrobe-swap image op
    fetch-video/      SSRF-guarded remote video fetch
lib/
  config.ts           THE switchboard — providers, pricing, param rules
  deploy.ts           isCloud() — the one cloud-vs-local switch
  i18n.tsx            EN/KO language provider for the public pages
  links.ts            canonical outbound URLs (repo, cut, bun, gemini)
  prompts.ts          cast + settings catalog, prompt composition, beat maps
  providers/          one adapter per video model (+ types.ts, index.ts)
```

---

## 3. Request lifecycle (one take)

```
 user types a message in the composer (app/chat/studio.tsx)
   │
   ├─▶ POST /api/refine ───────────────────────────────────────────────┐
   │     Gemini 2.5 Flash rewrites the PREVIOUS take's prompt with       │
   │     minimal edits. History- and multimodal-aware: it sees earlier   │
   │     takes, attached image/video frames, and pinned-take context.    │
   │     Returns the new prompt text. (text ≈ free)                      │
   │                                                                     ▼
   ├─▶ POST /api/generate ──────────────▶ providers/<x>.submit(prompt, params)
   │     validates params against whitelists,        returns { jobId } in <1s
   │     picks the adapter, spends real money
   │
   └─▶ poll GET /api/status?id=&provider= every 3s ─▶ providers/<x>.status(jobId)
         └─▶ { state:"done", videoUrl } ─▶ <video> plays it ─▶ appended to
             the archive (the spend ledger)
```

`videoUrl` is always a URL the browser can play directly. When a provider's
download needs an auth header (Veo, Sora) the adapter points `videoUrl` at the
same-origin `/api/video` proxy; providers that return public URLs (Grok,
Seedance) are played straight. `/api/video` is **SSRF-guarded by a host
allowlist** — see §9.

---

## 4. Extension point #1 — add a video provider

This is the main thing forkers change. An adapter is **two functions**. The
contract is [`lib/providers/types.ts`](../lib/providers/types.ts):

```ts
export interface VideoProvider {
  name: string;
  submit(prompt: string, params: SubmitParams): Promise<{ jobId: string }>;
  status(jobId: string): Promise<JobStatus>;
}
```

`SubmitParams` gives you `aspectRatio`, `durationSeconds`, `resolution`,
optional `modelId`, an optional `image` reference (base64 — map it to your
provider's image-to-video mode), and, for driving-video transfer, `character`
+ `drivingVideo`. `JobStatus` is `{ state: "pending"|"done"|"error",
videoUrl?, costUsd?, error? }`.

**Steps:**

1. **Copy an adapter.** Start from the one whose API shape is closest —
   [`veo.ts`](../lib/providers/veo.ts) (long-running-operation poll),
   [`sora.ts`](../lib/providers/sora.ts) (job id + content download),
   [`grok.ts`](../lib/providers/grok.ts) (two-step text→image→video),
   [`runway.ts`](../lib/providers/runway.ts) (driving-video transfer). Read
   the provider's **live docs** and verify the model id / endpoint before
   wiring — this rule has repeatedly saved rework (Veo 3.0 was retired mid-build).
2. **Register it in `PROVIDERS`** in [`lib/config.ts`](../lib/config.ts):
   `modelId`, `envVar`, `docsUrl`, `keyUrl`, `costPerSecondUsd`
   (per-resolution, or `null` if unknown → cost shows "—"), optional
   `minSeconds` (a provider that bills a floor, like Sora's 8 s), and a
   `chartColor`. **Chart colors are a validated set** (OKLCH band, CVD-safe on
   `#000`) — change them as a group and re-validate, never one at a time.
3. **Add the key to `KEY_ENV_VARS`** (same file) so the in-UI key panel can
   manage it, and so the dev-mode `.env.local` writer accepts it.
4. **Wire it into the registry** in
   [`lib/providers/index.ts`](../lib/providers/index.ts).

The UI, cost estimates, spend chart, retry, and continuity logic all pick up
the new provider automatically — they read from `PROVIDERS`, they don't
hard-code models.

**Reference mapping is the subtle part.** One image goes to the video model;
ZCLIP cover-crops it to the target aspect first (`normalizeRefB64` in
`studio.tsx`) because aspect-mismatched seeds make image-to-video models *tile*
the frame. Map `params.image` to your provider's first-frame field.

---

## 5. The config switchboard — `lib/config.ts`

The single source of truth for anything a provider or the UI needs to agree on:

- **`PROVIDERS`** — the registry described in §4.
- **`MODELS`** — the flat, UI-facing model list (a provider can host several);
  filtered by company in the model picker.
- **`effectiveSeconds(provider, durationSeconds, resolution)`** — *what you
  request vs. what the provider bills*. The duration slider (1–15 s) is a
  request; each provider snaps it to its own grid (Veo 4/6/8, 1080p⇒8; Sora
  floor 8). This one function is used by the adapter, the cost estimate, and
  the slider's "12S → 8S" label — so they can never disagree.
- **`estimateCostUsd` / `estimateModelCost`** — duration × published $/s,
  respecting `minSeconds`. Costs are **estimates**, not billing readouts; no
  provider reports billed totals.
- **Param whitelists** (`ASPECT_RATIOS`, `RESOLUTIONS`, `DURATION_MIN/MAX`) —
  enforced server-side in `/api/generate`. The UI mirrors them; the server is
  authoritative.
- **`REFINER_MODEL_ID`** (`gemini-2.5-flash`) — the prompt refiner. Always
  needs `GEMINI_API_KEY`, regardless of which *video* provider is selected.

---

## 6. Client state & `localStorage`

There is no server state. The studio persists everything under these keys:

| Key | Holds |
| --- | --- |
| `hooklab.thread` | current session's turns |
| `hooklab.sessions` | session history (max 20) |
| `hooklab.sessionId` | active session id |
| `hooklab.gallery` | **append-only clip archive = the spend ledger** (survives rewinds) |
| `hooklab.customAssets` | user-added cast / setting cards + their images |
| `hooklab.pw` | the shared password, if the deploy set one |
| `zclip.lang` | EN/KO choice for the public pages (§8) |
| `zclip.os` | macOS/Windows choice on the install guide |

> The `hooklab.*` prefix is intentional — the app was renamed HOOK LAB → ZCLIP
> and the keys were **kept** so existing browsers don't lose their data.

**Quota discipline:** `localStorage` is ~5 MB. Never store full images/videos
there. Take snapshots (mid-video frames) are compacted to the newest 3 turns
on every write; references persist only as a 120 px thumbnail. The in-source
type shapes (`Turn`, `Clip`, `StoredSession`) are documented inline in
`studio.tsx`.

---

## 7. Cloud vs. local — the gate

One switch, [`lib/deploy.ts`](../lib/deploy.ts):

```ts
isCloud() === true   ⟺   ZCLIP_CLOUD ∈ {1,true}  OR  process.env.VERCEL === "1"
isCloud() === false  ⟺   ZCLIP_CLOUD ∈ {0,false}  OR  neither is set
```

`VERCEL` is auto-set on every Vercel build/runtime and nowhere else, so both
`bun dev` and a local `bun start` read as **local** (studio works); only a real
Vercel deploy reads as **cloud** (studio gated). `ZCLIP_CLOUD` overrides either
way — `ZCLIP_CLOUD=1 bun dev` previews the gate locally; `ZCLIP_CLOUD=0` on a
password-protected deploy unlocks a real hosted studio.

The gate is a **server/client split**, and that's the important pattern:
`app/chat/page.tsx` is a *server* component that decides, so the heavy
`studio.tsx` client bundle is **never sent to a cloud visitor** — they get the
lightweight install guide instead. `isCloud()` reads a non-`NEXT_PUBLIC_` env
var, so it must be called server-side and its result passed down as a prop
(that's why the landing is a server shell around a client body).

---

## 8. Internationalization (EN / 한국어)

Deliberately **not** a framework — no URL locale, no middleware. The scope is
the *public pages only* (landing + install guide); the studio is English-only.

[`lib/i18n.tsx`](../lib/i18n.tsx) is a React context that holds the language,
persists it to `zclip.lang`, and mirrors it onto `<html lang>`. Each page keeps
its own `COPY = { en: {...}, ko: {...} }` object next to its markup and reads
`COPY[lang]`. `<LangToggle>` is the segmented switch.

- **Add / edit a string:** edit the `en` and `ko` entries in that page's `COPY`
  object (`landing-client.tsx` or `run-local-guide.tsx`). Keep the `Copy` type
  in sync — TypeScript will flag a missing translation.
- **Hydration rule:** always render `en` on the server *and* on first client
  paint (matching `layout.tsx`'s `<html lang="en">`), then adopt the
  stored/browser language in an effect. Initializing `useState` from
  `localStorage` would cause a hydration mismatch — don't.
- **Add a third language:** widen the `Lang` union and `LANGS`/`LABELS` in
  `i18n.tsx`, then add that key to every `COPY` deck. (Out of current scope —
  the product is EN/KO only.)

Shell commands in the guide are language-neutral; only prose is translated.
macOS/Windows is separate *local* state (`zclip.os`), because the two OSes need
genuinely different commands, not a translation.

---

## 9. Security model

- **Keys never reach the client.** Route handlers proxy every provider call.
  `GET /api/keys` returns booleans only. Auth'd video downloads stream through
  `/api/video`.
- **Dev-only surfaces.** The `.env.local` key writer (`/api/keys` POST) and the
  GRAB tool (`/api/grab`, which shells out to `yt-dlp`/`ffmpeg`) return 403
  unless `NODE_ENV === "development"`. This is independent of `isCloud()`.
- **SSRF-guarded fetchers.** Every server-side URL fetch (`/api/video`,
  `/api/fetch-video`) validates protocol, blocks private/link-local/metadata
  hosts, enforces a host allowlist, and caps content-type + size.
- **Shared-password gate.** Set `APP_PASSWORD` and every API route requires it
  (header for fetches, `?pw=` for `<video>` URLs, which can't send headers).
  It's a shared password — fine for a team tool, not real auth. **An unlocked
  hosted studio with no password spends your keys for anyone who finds the URL**
  — which is exactly why the cloud gate (§7) exists.

---

## 10. Dev workflow & verification

- **`bun dev`** → `http://localhost:3000`. Next dev holds a single-instance
  lock; run only one.
- **⚠ The build rule:** **never run `bun run build` while a dev server is
  running** — it clobbers `.next` and kills the dev server. Verify with
  `bun x tsc --noEmit` instead. Run a full `bun run build` only when no dev
  server is up.
- **Headless browser** for UI checks: inject `localStorage` JSON then
  `location.reload()` to simulate error turns, sessions, and archive clips at
  **zero API cost**. The browse daemon dies between shell calls — chain
  goto→wait→act→assert in one command.
- **`/api/refine` is safe to curl** with a real key (text ≈ free). **Never
  auto-trigger `/api/generate` in tests — that's real money (~$0.40/clip).**

---

## 11. Gotchas & hard-won lessons

Curated from [`DEVLOG.md`](DEVLOG.md) — the ones that will bite a contributor:

- **Verify model ids on live docs before wiring.** Providers retire and rename
  models (Veo 3.0 → 3.1). Training-knowledge endpoints are a trap (Seedance's
  adapter is still marked unverified for this reason).
- **Prompt craft:** models follow **timestamped beat maps** better than
  adjectives; **scene emotion leaks into faces** ("friends laughing behind her"
  makes the subject smile — neutralize background characters); a **seed frame
  beats wardrobe text** (frame-chaining locks emotion/camera but overrides
  "now in pajamas" — go prompt-chain-only for wardrobe/location changes).
- **Never string-slice JSX** to refactor `studio.tsx` — it has corrupted the
  file before. Extract components instead.
- **Reference aspect must match the target** or image-to-video models tile the
  frame — `normalizeRefB64` cover-crops before submit.
- **`effectiveSeconds` is the only place** duration snapping is allowed to
  live. If the cost estimate and the adapter ever disagree, someone bypassed it.
- **macOS ops:** `setsid` doesn't exist; `nohup` works. A `pkill` on the dev
  server can leave zombie `next-server` processes holding the port.

---

## Versioning & updates

There is no version server. The hosted Vercel deploy is ALWAYS the latest — it
rebuilds from `main` on every push. A locally-running copy detects updates by
asking the deployment:

- `package.json` `version` is inlined into the client as
  `NEXT_PUBLIC_APP_VERSION` by `next.config.ts` (override via env to preview the
  "update available" state: `NEXT_PUBLIC_APP_VERSION=0.0.1 bun dev`).
- `GET /api/version` → `{ version }` with `Access-Control-Allow-Origin: *` and
  `Cache-Control: no-store`, so a local copy can fetch it cross-origin. (This
  route is NOT dev-gated — the hosted deploy is exactly who must answer it.)
- `lib/version.ts` — `VERSION`, `CANONICAL_URL` (the hosted deploy),
  `isNewerVersion(a, b)`. `lib/use-version.ts` — `useHosted()` (reads the
  `data-hosted` attribute `app/layout.tsx` stamps when `isCloud()`) and
  `useUpdateCheck()` (LOCAL copies fetch `CANONICAL_URL/api/version`, compare,
  surface an update; offline/blocked fails silently — no prompt).
- UI: a version chip in the studio rail + landing footer; when a newer version
  is deployed, an "update available" banner + `UpdateGuide` modal (AI-CLI
  one-liner recommended, manual `git pull && bun install && bun dev` fallback).

## Releasing — REQUIRED (the update prompt only fires when you bump the version)

The "update available" prompt only fires when the deployed version is higher
than the user's local copy. So **every release MUST bump the version** — skip it
and every local copy thinks it's current forever. Per release:

1. **Bump** `version` in `package.json` (`MAJOR.MINOR.PATCH`; the compare is
   numeric per dotted segment).
2. **Write notes** — add a section to [CHANGELOG.md](../CHANGELOG.md) for the new
   version (Added / Changed / Fixed). The version chip links users to the GitHub
   releases page, so the notes are what they see.
3. **Commit** (`Release vX.Y.Z`) and push.
4. **Tag + GitHub release** so the releases page has content:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## X.Y.Z/,/## /p' CHANGELOG.md)
   ```
5. **Redeploy** so the canonical `/api/version` returns the new version.

Preview the update state locally without deploying anything:
`NEXT_PUBLIC_APP_VERSION=0.0.1 bun dev`.

---

*MIT licensed. Fork it, gut it, ship it. If you add a provider or a language,
a PR is welcome but not required — this is yours to take.*
