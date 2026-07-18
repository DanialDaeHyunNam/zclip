# HOSTED — opening zclip.vercel.app for real use

Design doc for the policy change decided 2026-07-15: the cloud deploy stops
being a showcase (the 07-13 "shop window" plan is superseded) and becomes a
**usable on-ramp** — visitors can generate for real with their own keys,
while every screen honestly steers them toward the local install, which is
the genuinely better way to run ZCLIP.

Status: **implemented in v0.5.0** (2026-07-15). Key modules:
`lib/server-keys.ts` (per-request resolution + cloud env block),
`lib/client-keys.ts` (browser key store + pass-through headers),
`lib/video-src.ts` (fetch+blob playback). Smoke-tested against a
`ZCLIP_CLOUD=1` prod build: key-less generate/status/refine refuse loudly,
a header key reaches the provider end-to-end, ref-video Seedance blocks
with the install pointer, /chat serves the studio.

---

## 1. Product stance — hosted is the on-ramp, local is the destination

The two tracks are not equals, and we say so out loud:

|                | 🌐 Web (zclip.vercel.app)                          | 💻 Local install                                   |
| -------------- | -------------------------------------------------- | -------------------------------------------------- |
| API keys       | Stored in this browser only; **pass through** the ZCLIP server per request | In `.env.local` — **never leave your machine** (except to the provider you call) |
| Your takes     | Browser storage only; provider files expire after their retention window — **download or lose them** | File store + clip vault keep every take **permanently** |
| Features       | GRAB ✗ · reference-video Seedance ✗ · Act-Two capped ~4.5MB | Everything ✓ (Act-Two up to 16MB)                   |

Every hosted limitation is an honest install-guide touchpoint, not an
apology. Concretely:

- **Landing CTA hierarchy**: local install is the primary CTA; "try it in
  the browser" is the secondary. Copy states plainly that local is the
  more private and more capable way to run ZCLIP.
- **Persistent hosted banner** (slim, dismissible per session) in the
  studio: "Browser mode — your keys pass through our server per request.
  Install locally and they never leave your machine → /install".
- **Every hosted-only error** (Seedance ref video, Act-Two size, expired
  archive playback) links to /install with one line on what local unlocks.
- **Take-completed nudge**: hosted shows a download prompt on every finished
  take ("providers delete files after a retention window — local installs
  vault every take automatically").

No dark patterns: hosted works for real, limits are stated before money
moves, and the nudge is "local is better", never "hosted is broken".

## 2. Honesty principle (differs from card-news)

card-news can be key-less/direct because the Claude API allows browser
CORS. Video providers mostly don't, and authenticated MP4 downloads need
the `/api/video` proxy — so a server hop is unavoidable. Therefore the
public copy must say **pass-through**, never "direct":

> Your key is stored in this browser (localStorage) only. While a
> generation request is being processed it passes through the ZCLIP server
> to the {provider} API — it is never stored or logged there. We recommend
> a dedicated key with a spend limit. Your prompt and reference
> images/videos are sent to the {provider} API when you generate.

`{provider}` resolves dynamically from the `PROVIDERS` selection in
`lib/config.ts`. Shown permanently in the key panel (studio is
English-only); landing/install mentions go through `lib/i18n.tsx` (EN/KO).
Status polling is part of "while a generation request is being processed" —
the key rides the poll headers too.

## 3. Architecture decisions (all settled 2026-07-15)

### 3.1 Key pass-through

- Hosted key entry saves to **localStorage** (`hooklab.keys`). The existing
  `/api/keys` POST (.env.local write) stays dev-only.
- Client sends the key per request in a header (`x-provider-key`-style) on
  `/api/generate` · `/api/status` · `/api/refine` · `/api/image` ·
  `/api/spec-check` · `/api/video`.
- **Adapters take the key as an explicit parameter** (`submit`/`status`
  signatures change; no more `process.env` reads inside adapters). Never
  mutate `process.env` per request — it is process-global, and concurrent
  requests would cross-contaminate keys (user A's clip billed to user B).
  An explicit argument also makes "never stored, never logged" reviewable:
  follow the parameter.
- **Cloud blocks the env fallback entirely**: `isCloud()` ⇒ header key
  required; missing ⇒ loud "add your key in the key panel" error. Local /
  self-host keeps the `.env.local` fallback. This closes the wallet-bomb
  hole where a provider key left in Vercel env would silently bill the
  owner for anonymous visitors' generations. Only owner-infrastructure env
  vars are exempt: `APP_PASSWORD`. (`BLOB_READ_WRITE_TOKEN` was retired
  2026-07-18 — Seedance reference videos park on a free auto-expiring
  temp host now, lib/ref-host.ts.)
- Error paths must not leak keys (audit adapter error messages that echo
  provider responses).
- `isCloud()` gate on `/chat` is removed. `/lab` stays 404 + gitignored
  (zero lab code may ship — repo is OSS). `APP_PASSWORD` gate survives as
  an option (= instant kill switch if the open deploy is ever abused;
  `ZCLIP_CLOUD` override can also restore showcase mode).

### 3.2 Veo/Sora playback: fetch + blob URL

`<video>` cannot send headers, and Veo/Sora require auth headers on the
MP4 fetch. Putting the key in the proxy URL (`?key=`) would land it in
Vercel request logs and make "never logged" false. Instead the client
fetches through `/api/video` **with the key in a header**, then plays via
`URL.createObjectURL(blob)` (clips are a few MB; ~10 lines of client
code). Download buttons reuse the same blob. Grok/Kling/Seedance return
public CDN URLs and skip the proxy entirely; Runway's `?remote=` CORS
proxy needs no key.

Consequence: hosted archive replays die once the provider retention
window passes (local clip vault is permanent) — surfaced honestly per §1.

### 3.3 Cost / quota defense (the "no owner cost bomb" audit)

| Owner-money surface                | Verdict                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Provider generation spend          | Impossible: cloud requires the visitor's header key; env fallback is blocked in code |
| Owner Vercel Blob (2,000 ops/mo, 75% warning 07-12) | Protected: reference-video Seedance is **disabled on hosted** (loud error → local install). Keyless-ref Seedance still works hosted |
| Gemini refine / spec-check / Grok image | Visitor's own key (same header rule)                                |
| Vercel bandwidth / function time   | The only shared resource: Veo/Sora playback streams through the proxy. Hobby plan cannot bill overages — it pauses the deploy (worst case = downtime, not a bill). If on Pro: set Spend Management caps. **TODO: confirm plan before release** |

### 3.4 Act-Two on hosted

Vercel's serverless body limit (~4.5MB) sits below Runway's 16MB inline
cap. Keep Act-Two hosted, but the client measures the payload **before
sending** and refuses over-limit with: "hosted caps driving video at
~4.5MB — trim it shorter, or install locally for the full 16MB".

### 3.5 Delete all data

- **Hosted**: "Delete all data" button = wipe `hooklab.*` localStorage,
  behind a confirmation modal (reuse the per-clip delete modal pattern)
  warning that the archive doubles as the spend ledger.
- **Local**: no button. Docs/guide line: delete `.zclip-data/` in the
  project folder. (The file store is the source of truth locally — a
  localStorage-only wipe would resurrect on reload, so we don't offer one.)

## 4. Verification rules (unchanged, restated)

- `bun run build` after every change; if the owner's dev server (:3333) is
  up, `bun x tsc --noEmit` only.
- **Never** call `/api/generate` for real in tests (real money per clip).
  Curl only refine/key-validation paths; simulate cloud with
  `ZCLIP_CLOUD=1` locally.

## 5. Release

v0.5.0 — version bump + CHANGELOG + tag + `gh release create` + redeploy
(the update-prompt contract in ARCHITECTURE.md § Releasing).
