# ZCLIP Landing & Demo Reel

**Participants**: dan, claude

## Summary
Public landing at `/` (studio moved to /chat): OpusClip-style pitch with an
animated demo reel that plays REAL ZCLIP-generated takes, differentiator list,
cut.donkeyuse.com workflow, open-source star CTA. Brand renamed HOOK LAB → ZCLIP.
Shipped open-source 2026-07-07: github.com/DanialDaeHyunNam/zclip (MIT).

## Context
- **Background**: Dan wants the repo public + a landing that explains the tool
  instantly and pitches the hook→cut(donkeyuse) full-video workflow.
- **Requirements**: hero legible at a glance ("UGC reaction hooks, typed not
  filmed"), numbered differentiators (model-swap, takes-as-context = THE BIG ONE,
  video-to-video-in-spirit, multimodal, spend dashboard), star-the-repo ask,
  demo must be authentic (made with the tool itself).
- **Decisions**: demo reel is a JS state machine (no video file) playing 3 real
  takes (T1 Veo, T2/3 Grok after a quota hit — accidentally demoing model-swap);
  each take frame-seeded from the previous (real continuity); balanced 3F/3M cast
  strip; SynthID stance: Veo already watermarks — self-label on platforms, never
  fake testimonials.
- **Constraints**: Veo RPD quota mid-work → Grok fallback; performance copied from
  reference clips is transcription-only (no pixels reused) for rights safety.

## Timeline

### 2026-07-06
**Focus**: Landing v1→v2, rebrand, real-output demo reel, cast assets.
- Baked 27+10 starter photos (realistic-texture prompts, neutral casting names)
- Fluid design refresh: starfield, Space Grotesk, pills, radius tokens
- Demo reel: 3-act story (bedroom → rooftop with friends → outfit restyle),
  expression-hold prompts verified frame-by-frame
- Routes: landing `/`, studio `/chat`; rail Z_ logo home affordance

**Learned**: the demo IS the pitch — "REAL OUTPUT, each built on the last" only
works because the pipeline actually did it.

### 2026-07-07
**Focus**: Shipped open-source — repo public with a real README + license.
- Full README rewrite (was internal-tool notes): quickstart, requirements
  table, "why not the playground", provider/pricing table, security model,
  add-a-provider guide, Vercel deploy, troubleshooting, synthetic-people/FTC
- MIT LICENSE added
- Secrets audit clean across all tracked files AND full history (35 commits)
- Commit identity rewritten local-hostname → GitHub noreply, then
  `gh repo create zclip --public --source . --push`
- REPO_URL placeholder replaced with the live repo in app/page.tsx

**Learned**: `git filter-branch --env-filter` is the clean way to scrub a
local-hostname committer identity before a first public push.

### 2026-07-07 (cont.)
**Focus**: Landing revamp — real 4-take demo reel, sharper copy, pipeline.
- Demo reel rebuilt with 4 REAL takes from a live Act-Two session (the actual
  chat iteration: hand → lips → gasp → shush), data-driven (TAKES array).
  Made the A→B change legible (crossfade + "T1→T2" flash, longer hold), added
  a left-aligned takes-timeline filmstrip, and switched auto-loop → play-once
  + Replay button so viewers can read/watch calmly.
- Copy refresh for the real feature set (Act-Two = real transfer, marketplace,
  GRAB, wardrobe, spend confirm). Value-forward hero subhead ("Stop buying
  reaction clips …") with hand line breaks. Section labels → bold headings.
  Workflow reads as Generate → Edit → Post with tool tags + arrows.
- Buttons lose underlines; Star-on-GitHub CTA gets a gold pulsing glow (the
  only "reward" for a free tool).

**Learned**: similar-looking clips need a MOTION signal (crossfade) + a text
label to read as "changed" — a hard cut between look-alikes is invisible.
Copy: H1 carries the "what", the subhead carries the "why/who"; `text-wrap:
balance` fights meaningful line breaks, so use explicit `<br>` for punch lines.
On positioning: a pretty-woman demo reads as product-accurate (UGC market skews
female) when balanced by a mixed cast — don't swap to male, add balance.

## Pending
- [ ] Owner eyeball pass on all 37 baked card photos (re-bake singles as needed)
- [ ] Optional: add a male-led demo take set to fully balance the reel

## Notes
Cross-ref: web/2026-07-06-zclip-chat-studio.md
