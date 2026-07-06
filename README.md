# ZCLIP_

**UGC reaction hooks, typed — not filmed.**

ZCLIP is a chat-driven studio that mass-produces the short vertical
"reaction hook" clips that open TikTok / Reels / Shorts ads — the
talking-head gasp that makes people stop scrolling. Type what should
happen, get a take in ~60 seconds, then *iterate by conversation*:
every take becomes context for the next one, and you can rewind to any
point in the thread and branch from there.

<p>
  <img src="public/starters/blonde-1.jpg" width="100" alt="starter card" />
  <img src="public/starters/guy-1.jpg" width="100" alt="starter card" />
  <img src="public/starters/asian-f-1.jpg" width="100" alt="starter card" />
  <img src="public/starters/black-m-1.jpg" width="100" alt="starter card" />
  <img src="public/starters/latina-1.jpg" width="100" alt="starter card" />
  <img src="public/starters/asian-m-1.jpg" width="100" alt="starter card" />
</p>

*27 built-in cast cards (all AI-generated people) × 10 settings — or bring
your own reference image. Every card's base prompt is visible and editable;
there is no hidden prompt.*

---

## Quickstart

```bash
git clone https://github.com/DanialDaeHyunNam/zclip
cd zclip
bun install
bun dev          # → http://localhost:3000
```

Open **http://localhost:3000/chat**, click the key chip, and paste a
[Gemini API key](https://aistudio.google.com/apikey) — it's written to
`.env.local` on your machine, never to the browser. That single key powers
both the prompt refiner and the default video model (Veo 3.1 Fast).
Pick a face, pick a room, hit send.

> **Heads-up on cost:** video generation is real money (≈$0.30–0.80 per
> take — see [pricing](#providers--pricing)). The estimate is shown next to
> the send button before every take, and a per-session spend dashboard
> lives in the session header.

### Requirements

| What | Why | Install |
| --- | --- | --- |
| [bun](https://bun.sh) | runtime + package manager | `curl -fsSL https://bun.sh/install \| bash` |
| Gemini API key | prompt refiner + Veo | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — **Veo needs billing enabled** (no free video tier) |
| `yt-dlp` + `ffmpeg` *(optional)* | the GRAB tool — pull reference videos from YouTube/X, trim clips | `brew install yt-dlp ffmpeg` |

No database. No accounts. All state (sessions, takes, spend ledger) lives
in your browser's localStorage; the server side is a handful of thin
Next.js route handlers that exist only to keep API keys off the client.

---

## Why not just use the provider's own playground?

1. **Takes become context.** Each finished take can seed the next one — a
   mid-video frame is captured and chained automatically (continuity mode),
   or pin any earlier take as explicit context ("take 1's background, take
   3's outfit"). Playgrounds give you one-shot generations; ZCLIP gives you
   a thread you can steer, rewind, and branch like a conversation.
2. **Model swap mid-thread.** Veo, Sora, and Grok Imagine behind one
   adapter interface — flip the model on a failed take and hit retry.
   Adding a provider is [one file](#adding-a-provider).
3. **Performance transfer.** Attach a reference video *and* a cast card:
   the video's performance (expression beats, gaze, hand timing, camera
   drift) is transcribed into a timestamped choreography — text, zero
   pixels reused — and re-performed by your cast. The source's identity,
   wardrobe, and room are deliberately never copied.
4. **Multimodal chat.** Drag in images or videos, paste a direct video URL,
   or GRAB one from YouTube/X — all become chips on the composer, like any
   modern chat.
5. **Spend you can see.** Every take is priced from published per-second
   rates before you send, and a stacked per-model chart tracks each
   session's total.

## The GRAB tool

The ⤓ icon in the rail downloads reference videos **on your machine**
(dev-mode only — the route refuses to run on a deployment):

- **YouTube & 1000+ sites** — via `yt-dlp`
- **X posts *and X articles*** — via X's guest GraphQL API directly
  (yt-dlp can't reach article-embedded media; ZCLIP can). Multi-video
  posts show a picker.
- **Direct `.mp4`/`.webm` links** — plain server-side fetch
- **Optional trim** — keep only the seconds you want (`ffmpeg`,
  frame-accurate re-encode)

One click attaches the grabbed clip to the composer as a reference —
straight into the performance-transfer pipeline. Use sources you have the
rights to reference.

## Providers & pricing

| Provider | Model | Status | $/second | Notes |
| --- | --- | --- | --- | --- |
| Google Veo *(default)* | `veo-3.1-fast-generate-preview` | ✅ verified live | $0.10 (720p) / $0.12 (1080p) | durations 4/6/8s; 1080p forces 8s; **no free tier — enable billing** |
| OpenAI Sora | `sora-2` | ✅ verified live | $0.10 | 720×1280 only on the base model; bills min 8s; watermarked |
| xAI Grok Imagine | `grok-imagine-video-1.5` | ✅ verified live | $0.08 + $0.05 image step | image-to-video only — ZCLIP auto-runs text→image→video; 1–15s |
| ByteDance Seedance | `seedance-1-0-pro-250528` | ⚠️ adapter written, unverified | — | verify endpoint on first run |

Keys are entered in the UI (dev mode writes them to `.env.local`) or set as
env vars — see [`.env.example`](.env.example). The UI only ever learns
*whether* a key exists, never its value. Attaching an image reference
skips Grok's image step (your image becomes the seed frame).

## Security model

- **Keys never reach the client.** Route handlers proxy every provider
  call; video downloads that need auth headers stream through
  `/api/video`. `GET /api/keys` returns booleans only.
- **Dev-only surfaces.** The `.env.local` key writer and the GRAB tool
  (which shells out to `yt-dlp`/`ffmpeg`) return 403 outside
  `NODE_ENV=development`.
- **SSRF-guarded fetchers.** Every server-side URL fetch validates the
  protocol, blocks private/link-local/metadata hosts, and enforces
  content-type checks and size caps.
- **Deploying somewhere public? Set `APP_PASSWORD`.** Every API route then
  requires it (header, or `?pw=` on video URLs since `<video>` tags can't
  send headers). It's a shared password — fine for a team tool, not real
  auth. **Without it, a public deployment spends *your* keys for anyone
  who finds the URL.**

## How it works

```
chat message ─→ /api/refine   Gemini Flash rewrites the last take's prompt
   │                          (history-aware, multimodal — sees the frames
   │                           of an attached video, pinned takes, etc.)
   └─→ /api/generate ─→ provider adapter.submit() ─→ { jobId } in <1s
        client polls /api/status every 3s ─→ videoUrl ─→ player + archive
```

- `lib/config.ts` — the switchboard: provider registry, pricing, duration
  rules (`effectiveSeconds` — what you request vs. what the provider bills).
- `lib/providers/*.ts` — one adapter per provider:
  `submit(prompt, params) → {jobId}` / `status(jobId) → {state, videoUrl?}`.
- `app/chat/page.tsx` — the entire studio UI, one client component.
- `app/page.tsx` — the landing page, with a demo reel generated by the
  tool itself (take 1 seeded takes 2 and 3 via frame chaining).

Deep context — every decision with evidence, provider quirks, prompt-craft
findings (why timestamped beat maps beat adjectives, why scene emotion
leaks into faces, why the seed frame beats wardrobe text) — lives in
[`CLAUDE.md`](CLAUDE.md) and [`docs/DEVLOG.md`](docs/DEVLOG.md).

## Adding a provider

1. Copy any adapter in `lib/providers/` and implement the two functions
   against your provider's async/polling API.
2. Register it in `PROVIDERS` in `lib/config.ts` — model id, env var, key
   URL, pricing, a chart color.
3. Add the env var to `KEY_ENV_VARS` (same file) so the UI key panel can
   manage it.

That's the whole surface. The UI, cost estimates, spend chart, retry, and
continuity logic pick the new provider up automatically.

## Deploying to Vercel

```bash
vercel                                    # first deploy, accept defaults
vercel env add GEMINI_API_KEY production
vercel env add APP_PASSWORD production    # strongly recommended — see above
vercel --prod
```

GRAB and the in-UI key writer disable themselves in production builds;
everything else works as-is.

## Troubleshooting

- **"Quota exceeded" on the first Veo take** — Veo has no free-tier video
  quota. Enable billing on the key's project
  ([aistudio.google.com/apikey](https://aistudio.google.com/apikey) → your
  key's project → *Set up billing*), then retry. Note: paying does **not**
  reset a daily cap you've already hit — that resets at midnight PT.
- **Take finished but no video** — Google's RAI filter ate the output; the
  UI shows the block reason. Soften the prompt and retry.
- **"Invalid size" on Sora** — the base `sora-2` model only does 720×1280 /
  1280×720; the 1080p sizes are `sora-2-pro`.
- **Reference image comes out tiled/doubled** — fixed automatically: ZCLIP
  cover-crops references to the target aspect before submitting, because
  aspect-mismatched seeds make i2v models tile the frame.

## On synthetic people & disclosure

The built-in cast are AI-generated people, not real humans. Veo output
carries Google's invisible SynthID watermark; Sora output is visibly
watermarked. If you run these clips as ads: label AI-generated content
where the platform asks (TikTok, Meta, and YouTube all have toggles), and
don't present a synthetic person's reaction as a real customer
testimonial — that's an FTC problem, not a style choice. Performance
transfer deliberately copies *choreography, never pixels or identity* —
keep it that way.

## License

[MIT](LICENSE)
