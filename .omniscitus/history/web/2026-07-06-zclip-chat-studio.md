# ZCLIP Chat Studio

**Participants**: dan, claude

## Summary
Chat-driven UGC reaction-hook video studio (/chat): message → prompt refine →
provider generation → iterate. Sessions, rewind, pinned-take context, continuity
snapshots, multimodal references, spend tracking, in-UI API keys.

## Context
- **Background**: Dan needed to mass-produce the "surprised reaction" first 3s of
  TikTok/Reels UGC ads without filming; built from scratch today (2026-07-06),
  evolved form-tool → chat studio through rapid owner feedback.
- **Requirements**: no backend/DB (localStorage only), thin API proxies keep keys
  server-side, async submit+poll (60–180s renders), visible errors, one-screen UX,
  optional shared password, all 4 providers pre-wired with in-UI key entry.
- **Decisions**: Veo 3.1 Fast default (3.0 retired 2026-06-30); refine via
  gemini-2.5-flash with history/context/transfer modes; base prompt always visible
  & editable (no hidden prompt); reference images cover-cropped to target aspect
  (i2v tiles otherwise); duration is a request — effectiveSeconds() snaps per
  provider (Veo 4/6/8, Sora 8, Grok 1–15); expression-hold recipe: no emotional
  background actors + verbatim action + counter-negatives; frame-seed wins over
  wardrobe/location prompts (seed only for emotion/camera changes).
- **Constraints**: Veo daily quota (RPD) resets midnight PT regardless of payment;
  Grok has no text-to-video (text→image→video, $0.08/s + $0.05 image step);
  Sora base = 720p/8s+watermark; Seedance adapter unverified; NEVER run
  `bun run build` while a dev server runs (kills it) — use `bun x tsc --noEmit`.

## Timeline

### 2026-07-06
**Focus**: Entire studio built and iterated in one day (~30 commits).
- Scaffolded Next 16/bun app; Veo wired from live docs; async generate/status/video routes
- Pivoted to chat UI: takes, rewind, session history sidebar, session archive
- Multimodal: image/video attachments (video → up to 10 time-ordered frames),
  starter cards (27 faces × 10 sets, baked, card image = generation reference),
  pinned-take context (CTX), continuity snapshots (CONT), performance-transfer
  mode (video = choreography, card = identity), video-URL ingestion route
- Spend: per-take estimates, retro-priced backfill, header popover chart
- Archive: rail ▦ overlay grouped by owning session; chat shows current session only
- Natural surprise arc (owner's reference clip) encoded as timestamped beat map
  for 6–8s takes; refine system guards realism + action clauses

**Learned**: video models follow timestamped beat maps far better than adjectives;
scene emotion contaminates the subject's face; aspect-mismatched i2v references
tile the frame; JSX must be refactored via components, never string-sliced.

## Pending
- [ ] `gh repo create` + push (secrets audited clean; local commits ready)
- [ ] Set real REPO_URL in app/page.tsx after repo creation
- [ ] Verify Seedance adapter end-to-end (endpoint/model id unconfirmed)
- [ ] Optional: re-generate demo takes 2/3 on Veo after quota reset (script ready)
- [ ] Set APP_PASSWORD before any public Vercel deploy

## Notes
Full engineering record in docs/DEVLOG.md (#1–25) and CLAUDE.md handoff.
