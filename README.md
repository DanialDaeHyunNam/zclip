# HOOK LAB

Internal tool that mass-produces short vertical UGC-style "reaction hook"
clips (the surprised-reaction first half of a TikTok/Reels reaction ad)
through a chat-driven iterate loop (message → prompt rewrite → generate →
refine again), with rewind, session history, image references, take-to-take
continuity, and per-session spend tracking.

> Continuing development? Start with **`CLAUDE.md`** (agent handoff notes)
> and **`docs/DEVLOG.md`** (every decision + evidence) — they carry the
> full context of the original build session.

- **No server, no database.** All history lives in your browser
  (localStorage). The only server-side code is three thin Next.js route
  handlers that proxy the video API so the key never reaches the client.
- **Async by design.** `POST /api/generate` submits and returns a job id in
  under a second; the client polls `GET /api/status?id=…` every 3s. A video
  takes 60–180s — no serverless call ever waits for it.
- **Default provider:** Google **Veo 3.1 Fast** via the Gemini API
  (verified live 2026-07-06 — Veo 3.0 was retired 2026-06-30).
  ~$0.40 per 4s clip at 720p.

## Quickstart (local)

1. Get a Gemini API key: <https://aistudio.google.com/apikey>
   → "Create API key" (takes about a minute, works on the free-tier project
   but Veo generation requires billing enabled on the underlying project).
2. Put it in `.env.local`:

   ```
   GEMINI_API_KEY=your-key-here
   APP_PASSWORD=            # optional — set to gate the UI/API
   ```

3. Run:

   ```
   bun install
   bun dev
   ```

4. Open <http://localhost:3000>, pick a scenario variant, hit **GENERATE**.

## Swapping model / provider

The **MODEL dropdown in the UI** switches between registered providers at
runtime. The registry lives in **`lib/config.ts`** (`PROVIDERS`) — label,
model id, cost table, env var, docs link, and an `implemented` flag per
provider. Picking a not-yet-wired provider in the UI shows the exact
3-step wiring guide inline and keeps Generate disabled.

To wire a stub (e.g. Grok):

1. Implement `submit()` + `status()` in its `lib/providers/<name>.ts` —
   copy `veo.ts` as the reference; the interface is just those two
   functions.
2. Flip `implemented: true` (and correct `modelId`/cost) in
   `lib/config.ts`.
3. **Locally:** put its key in `.env.local`, restart `bun dev`.
   **On Vercel:** add the env var in *dashboard → Project → Settings →
   Environment Variables*, then **redeploy** (env changes only apply to
   new deployments).

| Provider | Env var | Get a key | Docs |
| --- | --- | --- | --- |
| Google Veo (default, fully wired) | `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> | <https://ai.google.dev/gemini-api/docs/veo> |
| OpenAI Sora (stub — adds watermark) | `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> | <https://platform.openai.com/docs/guides/video-generation> |
| xAI Grok (stub) | `XAI_API_KEY` | <https://console.x.ai/> | <https://docs.x.ai/> |
| ByteDance Seedance (stub) | `ARK_API_KEY` | <https://console.byteplus.com/> | <https://docs.byteplus.com/en/docs/ModelArk/> |

Only Veo is implemented. The other three are clean stub adapters in
`lib/providers/*.ts` — each implements the same two-method interface
(`submit(prompt, params) → { jobId }`, `status(jobId) → { state, videoUrl?,
costUsd? }`), so wiring one up touches exactly one file plus the two
constants in `lib/config.ts`.

## Password gate

Set `APP_PASSWORD` (locally in `.env.local`, on Vercel as an env var) and
the UI asks for it once (stored in the browser); all API routes reject
requests without it. Notes: it's a shared password sent as a header (and as
a `?pw=` query param on video URLs, since `<video>` tags can't send
headers) — fine for a short-lived internal tool, not real auth. Unset it
and everything is open.

## Deploy to Vercel

```
cd reaction-hooks
vercel                                   # first deploy, accept defaults
vercel env add GEMINI_API_KEY production # paste the key when prompted
vercel env add APP_PASSWORD production   # optional
vercel --prod
```

(Or: push to a repo → import in the Vercel dashboard → add the two env
vars in Settings → deploy.)

## Teardown

- Delete the project: `vercel project rm reaction-hooks` (or dashboard →
  Project → Settings → Delete Project).
- Revoke the Gemini key at <https://aistudio.google.com/apikey>.
- Generated clips live on Google's servers only ~2 days anyway; anything
  you didn't download is gone after that.

## Things to know

- **"Quota exceeded" on first run:** Veo has **no free-tier quota** — the
  API key's Google Cloud project must have billing enabled. Fix:
  <https://aistudio.google.com/apikey> → your key's project → *Set up
  billing* (upgrade to the paid tier), then retry. No code change needed.
- **Duration:** Veo 3.1's minimum is 4s (allowed 4/6/8), so the 3s creative
  target maps to `durationSeconds: 4`; the prompt text still says
  "3 seconds" to bias the action to resolve early. 1080p output requires
  8s (Veo constraint — the UI enforces this).
- **Content policy:** realistic-people prompts sometimes get eaten by
  Google's RAI filter — the UI surfaces the block reason instead of
  spinning forever. Soften the prompt and retry.
- **Cost figure** shown per clip is an estimate (`duration × published
  per-second price`), not a billing API readout.
