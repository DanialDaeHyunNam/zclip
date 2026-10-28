# CUT — the second session kind (design SSOT)

Status: **pipeline LIVE end-to-end** (2026-08-02). First full cut assembled
and vaulted from the real UI: 2 scenes → keyless Edge TTS → burned captions
→ in-browser H.264+AAC mux → 9.45s 720×1280 mp4 with an audio track →
Library. Remaining verifications + polish are listed at the bottom.

## What

`TAKE` sessions produce raw clips (chat / flow — everything ZCLIP did before).
`CUT` sessions produce **one finished, postable video**: script → per-scene
visuals → voiceover + captions → assembled vertical MP4. The pipeline is a
deliberate port of MoneyPrinterTurbo's shape (topic → script → search terms →
stock footage → TTS → subtitles → assemble), rebuilt on ZCLIP's architecture.

Naming (owner + agent call 2026-08-02): **CUT**, not "full video" — film
vocabulary pairs with TAKE ("takes go into cuts"), one word, chip-friendly.
Picker card title uses pipeline notation like FLOW's: `SCRIPT → SCENES → CUT`.

## Session semantics (owner call 2026-08-02)

- `StoredSession.kind?: "take" | "cut"` — `undefined` = take (every pre-CUT
  session; zero migration).
- **Kind is fixed at creation.** There is NO in-session switch. `+ New` in the
  sessions sidebar opens a 2-card kind picker (same pattern as ＋ New flow —
  forced choice buys discoverability, launch-prep lesson). Picking the other
  kind while on an untouched session simply creates a new session; the
  untouched one is never persisted, so it reads as replacement — existing
  placeholder-sweep semantics, unchanged.
- `?new=1` (rail handoff) opens the sidebar + picker instead of silently
  creating a take session.
- A cut session stays alive in the sidebar sweeps the same way flow work
  does: `hasCutWork()` in studio.tsx is the ONE definition (currently: a
  non-empty parked script draft; grows to scenes/renders with the pipeline).
- Studio header: take sessions keep the CHAT|FLOW method toggle (it IS the
  take signature); cut sessions show a static `✂ CUT` chip in its place.
  Sidebar rows badge `· ✂ cut` (exception-only badging, like ⇶ flow).

## Pipeline (to build) — MPT mapping

| MPT (Python/server) | ZCLIP CUT (browser-first) |
| --- | --- |
| script gen (LLM, paragraphs) | Gemini via a thin route (same key refine uses); paragraph ≈ scene |
| search terms (chronological `match_script_order` prompt) | same prompt idea, terms ride per-scene |
| stock: Pexels/Pixabay/Coverr, server download | **browser-direct** Pexels/Pixabay (CORS `*` verified live 2026-08-02, incl. `authorization` header preflight); Pexels key is free — lightest BYOK ever |
| per-scene visuals | 3-source mix: stock / **Library takes** (ZCLIP-only advantage) / AI-gen beat (existing providers, opt-in $) |
| TTS: edge-tts default (keyless) | keyless-first: edge-tts via thin route (msedge-tts, unofficial-endpoint risk accepted like MPT); Gemini TTS as keyed fallback. Word timings (WordBoundary) → captions for free, NO whisper |
| subtitles burn-in (moviepy) | canvas overlay at compose time |
| assemble: moviepy/ffmpeg server | **in-browser**: canvas frames + WebCodecs → mp4-muxer (engine already proven in lib/depth-extract.ts) + AudioEncoder (AAC) track for voiceover/BGM mix. SPIKE FIRST: audio+video mux is the one unproven piece |
| audio duration owns the timeline | same principle — TTS first, visuals cut to fit |
| batch N videos | later; cheap once stock-based |
| cross-posting (paid 3rd party) | not ported |

Constraints carried over: no keys in URLs/logs; local/self-host = zero
external calls unless the user acts; stock downloads go straight to the
browser (no server hop, no temp host needed — stock is public content).

## Increments

Wizard step order = **SCRIPT → VOICE → SCENES → CUT** (owner call
2026-08-02: follow MPT verbatim). Voice runs before casting because the
voiceover's length owns the timeline — SCENES then shows each scene's real
target duration while you cast, instead of trimming blind at assembly.

1. ✅ kind plumbing: StoredSession.kind, + New picker, sidebar/header chips
   (draft parked in plain localStorage `hooklab.cutdraft:<sessionId>` —
   NOT the file store). Draft deletion is dirty-gated: StrictMode double
   effects + mount-time persist ate the draft otherwise (live-caught).
2. ✅ Compose engine `lib/cut-compose.ts` — VERIFIED LIVE: seek-minted
   frames (depth-extract spine) + AudioEncoder AAC track in mp4-muxer;
   footage loops to fill each scene's narration; caption chunks burned
   proportionally. 9.45s output confirmed with audio.
3. ✅ SCRIPT step: topic → `/api/cut-script` (Gemini, refine's key pattern,
   JSON mode) → scenes + chronological per-scene terms; manual scripts get
   terms best-effort (keyless path stays alive: skip terms, type queries).
4. ✅ VOICE step: `/api/tts` (msedge-tts 2.x, keyless, both stream shapes
   handled) per scene → exact per-scene durations. Captions are
   PROPORTIONAL chunks, not word-boundary yet (upgrade candidate).
5. ✅ SCENES step: browser-direct Pexels (`lib/stock.ts`, portrait-file
   picker) + per-scene query cards; CUT step: assemble → download +
   `/api/clips` vault → gallery entry (provider "grab", cost 0).

Still open:
- [ ] Pexels search with a REAL key (shape from docs; CORS verified, first
      live search pending — free key at pexels.com/api)
- [ ] Hosted smoke (walls: vault 403 → download-only note is wired)
- [ ] Library takes as scene sources · AI-gen beats · BGM track · batch
- [ ] Word-boundary captions (Edge TTS metadata stream) · 1080p option
- [ ] Release bundling (version bump + CHANGELOG — rides the next release
      with the 07-21 unversioned batch)
