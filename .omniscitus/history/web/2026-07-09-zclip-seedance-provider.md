# ZCLIP Seedance Provider Verification

**Participants**: dan, claude

## Summary
Bringing the Seedance 1.0 Pro adapter from "wired but unverified" to live: API-key
onboarding on BytePlus ModelArk, confirmed token pricing, and a spend guardrail.
Consolidates the Seedance-verification thread that was scattered as pending items
in [[zclip-chat-studio]] and [[zclip-deploy-versioning]].

## Context
- **Background**: Seedance shipped in ZCLIP as `implemented: true` but with
  `costPerSecondUsd: null` and a "verify on first run" note — endpoint/model id were
  built from JS-rendered docs and never confirmed against a real call. Dan set up the
  provider account to close this out, and wanted a spend cap first so a test run
  can't overshoot.
- **Requirements**: confirm the right console to create the key; a hard ~$10 usage
  ceiling before any paid call; know cost-per-clip so the cap is meaningful.
- **Decisions**: key comes from **BytePlus ModelArk** (= Volcengine Ark, ByteDance's
  intl brand) → env `ARK_API_KEY`; adapter is pinned to the **ap-southeast** region
  (`ark.ap-southeast.bytepluses.com/api/v3`), so the key + model must be created in
  Asia Pacific to match. Set the ModelArk **token** usage limit (Seedance bills video
  as tokens, unlike Veo/Sora/Grok per-second): **$10 = 4,000,000 tokens** at the
  confirmed $0.0025/1K rate; use 3.5M for a safety margin. Verify empirically — set a
  low cap, run ONE clip, read exact usage — rather than trusting the estimated
  token-per-clip formula.
- **Constraints**: a key alone isn't enough — ModelArk requires **Model activation**
  for Seedance per region before the key works. First real generation costs money
  (~$0.27 for a 5s 720p clip), so it stays a user-triggered step, never auto-run.

## Timeline

### 2026-07-09
**Focus**: Seedance API-key onboarding + confirmed pricing + $10 spend guardrail.
- Confirmed the screenshot (BytePlus ModelArk → API keys → Create API Key) is the
  correct place, cross-checked against `lib/config.ts`: `keyUrl` = console.byteplus.com,
  `envVar` = `ARK_API_KEY`, adapter `BASE` = `ark.ap-southeast.bytepluses.com` matches
  the console's "Asia Pacific" region. Flagged the two gotchas: **Model activation**
  (sidebar) must enable Seedance, and key/model region must match the hardcoded
  ap-southeast endpoint.
- **Pricing confirmed** from the ModelArk console: **$0.0025 USD / 1K tokens** for
  both i2v and t2v (= $2.50 / 1M). Seedance tokenizes video output, so a token cap is
  the right lever. Derived: **$10 = 4,000,000 tokens**; est. token/clip via
  `~(W×H×FPS×secs)/1024` → 5s 720p ≈108K (~$0.27, ~37 clips per $10), 5s 1080p ≈243K
  (~$0.61, ~16 clips). The $/token is now firm; token/clip is still approximate until
  a real run.
- Recommended usage cap: **4,000,000 tokens** for exactly $10, or 3.5M (~$8.75) for
  margin — deliberately low so an accidental overshoot is impossible.

**Learned**: Seedance is one of the rare video APIs billed in **tokens, not
per-second**, so ZCLIP's per-second cost model (`costPerSecondUsd`) needs a
token→second conversion to represent it honestly; when a rate is confirmed but the
per-unit consumption isn't, quote the confirmed part precisely ($10 = 4M tokens) and
mark the derived part (clip count) as an estimate to be firmed by one measured run.

## Pending
- [ ] Set the ModelArk usage cap (4M tokens ≈ $10, or 3.5M for margin) + enable
      Model activation for Seedance in the ap-southeast region.
- [ ] Run ONE real 5s 720p Seedance clip → read exact tokens + cost from the ModelArk
      Usage page (firms up token/clip + the cost table).
- [x] Confirm the adapter endpoint / model id (`seedance-1-0-pro-250528`) / response
      shape — a completed Seedance 1.0 Pro clip landed in the gallery 2026-07-09
      01:38 (plus six 2.0-family clips through 07-16); adapter shape verified, no fix needed.
- [ ] Fill `costPerSecondUsd` in `lib/config.ts` (currently `null` → cost shows "—")
      from the measured per-clip cost; drop the "unverified" note.

## Notes
Resolves the Seedance-verification pendings tracked in [[zclip-chat-studio]] and
[[zclip-deploy-versioning]]. Adapter: `lib/providers/seedance.ts`; config:
`lib/config.ts` (`seedance` block).
