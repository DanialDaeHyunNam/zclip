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

### 2026-07-08 (footer rebuild, version chips, install/usage guide)
**Focus**: Landing chrome + guides tie into the deploy/versioning work.
- Footer rebuilt Card News-style (brand / project / follow columns + a bottom bar:
  © · v{VERSION} · "check latest" / social icons). Nav gained a `v{VERSION}` chip
  → GitHub releases.
- Install guide (`run-local-guide`) opens as a POPUP from the landing CTAs on
  cloud, with a bilingual "What you can do" usage section + a `WorkflowDemo`
  animation (a UI-click walkthrough, like the demo reel but of the flow).
- Landing split into a server shell + `landing-client.tsx`; EN/한국어 toggle.

**Learned**: the version chip + "check latest" belongs in the footer (where users
look for meta); the studio surfaces the active update prompt — same data, two
audiences. See [[zclip-deploy-versioning]].

### 2026-07-08 (workflow demo lands on a real take — v0.1.7)
**Focus**: The "What you can do" walkthrough shows real video, not a still.
- Swapped the `WorkflowDemo` result frame from a static portrait
  (`/starters/asian-f-1.jpg`) to the real `/demo/take-1.mp4` — the exact scene
  the demo builds up (asian-f-1, bedroom, the quiet 'wait, what?' beat it types).
  Muted/looping with a forced-play ref (React's muted-as-property misses the
  autoplay policy); `.wd-clip img` → `img, video`.

**Learned**: the demo's *result* should be the clip its typed prompt would
actually produce — a still portrait where the flow promises a video reads as a
stock placeholder and undercuts the "real output" pitch.

## Pending
- [ ] Owner eyeball pass on all 37 baked card photos (re-bake singles as needed)
- [ ] Optional: add a male-led demo take set to fully balance the reel

## Notes
Cross-ref: web/2026-07-06-zclip-chat-studio.md
