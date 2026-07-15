# Vlog Realism Spec — what makes an AI vlog read as real

Companion to [VIDEO-PROMPT-SPEC.md](./VIDEO-PROMPT-SPEC.md). That doc covers the
15-section photoreal contract for *made-to-brief* video. This one covers the
narrower, harder problem we actually chase: **an 8-second talking vlog clip that a
scrolling viewer accepts as a real person filming their real life.**

Everything here is field-derived — 2026-07-15, ~16 takes across Grok Imagine,
Veo 3.1, Seedance 2.0, plus a frame-by-frame teardown of a real 10-minute K-pop
idol NYC vlog (Kazuha / LE SSERAFIM) used as the ground-truth reference.

## Why

Free-typed "make it realistic" prompts plateau around 70% believable: pretty,
uncanny, obviously synthetic. The last 30% is not adjectives. It comes from two
places, and it matters which:

1. **Structure** — physics, shot grammar, editing grammar, speech budget.
   Prompt-solvable. Everything in §1–§4 below.
2. **Renderer** — skin micro-texture, light transport on a cheek, drawing a
   background to the edge, acting aliveness, dialogue tone. **Not**
   prompt-solvable. See §6.

Spending prompt iterations on a renderer limitation is the single most expensive
mistake available here. Know which wall you're at.

## 1. The realism laws (prompt-solvable, all field-verified)

### 1.1 Declare the medium's physics, never the vibe

Every win today came from naming a physical truth of the capture medium, not
from asking for beauty. The model obeys "this medium behaves like X" far more
reliably than "make it look good".

| Failure | Vibe fix (fails) | Physics fix (works) |
|---|---|---|
| Portrait-mode plastic look | "no bokeh" | "Tiny phone sensor with a fixed small aperture — everything in sharp focus at once. Real front cameras cannot blur backgrounds." |
| Night face lit like a studio | "moody lighting" | "Her face is lit ONLY by distant streetlights, slightly underexposed, brightening only when passing under a lamp. No beauty light from the camera direction." |
| Dialogue rushed / mushy | "speak slowly" | Cut budget — one line per ~2s cut (see §1.4) |

### 1.2 Deep focus is the default; bokeh must be earned by focal distance

**Selfie/walking shots: no bokeh, ever.** Field-confirmed by the owner: added
background blur reads as *more* AI, not less — it's the portrait-mode tell.

But depth of field is **per-shot physics, not a global style**. A macro insert
(phone held inches from a cake, a glass, a ribbon) *does* fall off naturally, and
should. Strong renderers (Seedance) already know this per shot type; weak ones
(Grok) apply one global "cinematic = blur" prior and need the contract spelled
out per cut.

```
Global:  Selfie and wide shots — everything in sharp focus, no artificial bokeh.
Per-cut: Close-up insert at near-focus distance — natural optical falloff behind
         the subject, as real close-range focus behaves.
```

### 1.3 Imperfection is the signal

Perfection reads as fake. The believable clips are the boring ones. Always
include: micro-shake, 180° shutter motion blur, wide-lens selfie distortion,
flyaway hair strands, fabric wrinkles, mild digital noise (esp. at night),
slightly imperfect exposure, breath visible in cold air, chest rise from
breathing.

Skin: **matte, not dewy.** "Dewy glass skin" + "K-beauty glow" render as
specular wax — the single biggest source of the "pretty but plastic" look.
Replace with pores + vellus hair + natural tonal variation + soft matte finish.

But keep makeup and skin as **separate layers**: "real skin texture clearly
visible *through* flawless professional idol makeup". Dropping makeup to fix
texture drags the whole face toward "ordinary person" and loses the visual.
Texture and glam are not a trade-off — say both, explicitly, in one sentence.

### 1.4 Speech is bounded by seconds, not by instruction

**Korean casual speech ≈ 5–6 syllables/sec.** An 8s clip spends ~2–3s on acting
beats (glances, breaths, laughs), leaving ~5–6s of speech.

> **Budget: ~30–36 syllables per 8s clip. One breath-line = 8–12 syllables.**

Verified overrun: 26 syllables crammed into a 3s cut = 8.7 syll/s — audibly
rushed. Verified comfortable: 3 lines totalling 26–35 syllables across 8s.

Corollary (the RENA lesson): **never fix pacing with "speak slowly".** Enforce it
structurally — one line per cut, cut ≈ 2s. The model physically cannot rush what
doesn't fit.

Also: prefer open, simple syllables. Field-failed Korean lines on Grok: "드디어
휴일~!" (consonant cluster + glide). Field-passed: "하이 여러분~!", "짜잔~!",
"빠이빠이~!", "아~ 행복해."

### 1.5 Match length declaration to script length, in three places

Duration field, the Format line ("an 8-second vlog in exactly 4 cuts"), and the
actual cut count must all say the same number. Both directions fail:

- 8s requested, 15s script → compression, everyone talks at 2×
- 15s requested, 8s script → dead air, or the model invents filler

### 1.6 Jump-cut grammar

Real vlogs trim the boring seconds. Every cut should begin **mid-motion,
mid-breath** — "she is *already* mid-glance up at the sky", "the breeze has
*already* blown strands across her face", "she is *already* stopped mid-wave".
Plus a small framing jump (angle or distance moves a step) at every cut.

### 1.7 One emotional through-line, declared as its own section

Cut boards fragment dialogue into four isolated readings — the "robot narrator"
failure. Fix with an explicit Story section plus continuity cues in the cut
directions ("her voice continues", "a hum melting into the words", "wrapping up
the chat").

```
Story: One emotional through-line — a happy hello, growing awe at the street,
fully charmed, ending with a warm ask. A real vlog arc, never mechanical.
Audio: ... All lines are ONE continuous chat with the viewer, each flowing from
the previous — not four separate isolated readings.
```

### 1.8 The scene must earn the dialogue

Field failure: a prompt specified "low houses, utility poles, power lines" — an
ordinary residential back lane — while the script said "so pretty, right?". The
model rendered exactly what was ordered; the words were the lie. Not a rendering
bug, a **briefing bug**.

If the line claims beauty, the Scene block must specify a place that *is*
beautiful, and specific enough to be recalled from training data (see §1.9).

### 1.9 Name the place, narrowly, and pick high-density places

Generic locations get generic (melty) geometry. Named, photographed-to-death
locations get real geometry:

- ✅ "Kyoto's old Higashiyama district — machiya townhouses, dark timber lattice,
  tiled roofs, stone lane" → rendered as a real place
- ✅ "SoHo, New York — cast-iron facades, storefront display windows, shoveled
  snow" → rendered as a real place
- ❌ "a small Japanese town — low houses, utility poles" → rendered as nowhere

Density bonus: pick places with **few readable signs** (residential brownstone
streets, park paths, temple lanes) — AI-broken lettering is a top-tier tell.
Commercial strips are sign minefields.

### 1.10 Object diet closes the human/background quality gap

The model spends its capacity on the face; backgrounds degrade. Two mitigations:

1. Explicit parity contract:
   `Background quality contract: the street behind her is rendered at the SAME
   fidelity as her face — straight architectural lines, true material textures,
   clean geometry, no melted shapes, no smudged or warped background.`
2. Fewer objects to get wrong — a plain wall, an empty lane, big surfaces.

Caveat: this only narrows the gap. Closing it is a renderer property (§6).

## 2. Gaze is the uncanny lever (biggest single win)

From the Kazuha teardown, a 6-frame burst across **one 3-second sentence**:

> lens → eyebrows lift on the stressed word → head turns to the window
> *mid-sentence* → eyes drop in a thinking beat → back to lens → lands on a
> small smile.

**Four gaze moves per sentence. Head rotation 30–40°. The lens is home base, not
a stare.** Our standard "eye-contact with the lens" line was locking the exact
behavior that makes a face read as alive. Ship this block instead:

```
Facial life: her gaze does NOT stay on the lens — while talking it drifts
naturally to the window, down in a small thinking beat, then back to the lens to
land the end of the line. Her head turns freely with her gaze, eyebrows rise and
fall with the emphasis of her words, tiny smiles break mid-sentence. She looks at
the lens the way you glance at a friend while talking — returning, not staring.
```

Real-vlog gaze ratio: **≈30% lens, 70% world.** Our selfie clips were at 100%.
That difference is "presenting" vs "being filmed".

## 3. Two formats, two different grammars

The teardown's biggest structural insight: the reference vlog is not a selfie
vlog. The camera is **a trusted friend**, not a selfie stick.

| | **Selfie-cam** | **Friend-cam** (Kazuha default) |
|---|---|---|
| Camera | Her arm, wide-lens distortion, walking bounce | Friend walking beside her; filmer's sway |
| Gaze | Lens is home | World is home, lens is a visit |
| Hands | One occupied by the phone | **Free** — pockets, pointing, grooming |
| Dialogue | Address the viewer ("하이 여러분~!") | Talk to the friend |
| Ending | Sign-off wave, hold the smile | **No goodbye** — cut mid-stroll, mid-conversation |
| Dead time | Trimmed | **Kept** — chewing, silent walking, staring out a window |

A goodbye wave in friend-cam feels wrong; a mid-conversation cut in selfie-cam
feels broken. Don't mix the endings.

## 4. Reference teardown — Kazuha NYC vlog (ground truth)

10 minutes, 6 chapters: SoHo street walk → gallery → steakhouse dinner → hotel
morning → **car interview (half the runtime)** → bagel + Central Park.

### 4.1 Camera grammar bank (12)

1. Companion tracking walk — profile, she looks at shop windows, not the lens
2. Static table cam — food scene, she simply exists in frame and eats
3. **Car back-seat interview** — 3/4 from the front seat; face brightness pulses
   as buildings pass (daytime version of our streetlight modulation)
4. Food POV insert — yogurt bowl, bagel bag; faceless cuts as pacing air
5. POV pan reveal — curtain → skyline
6. Wide gallery shot — subject small, hand reaching toward the artwork
7. Alley walk-and-talk — answering the filmer while walking
8. Bench conversation — bench-height cam, she turns her body to the person
9. Walking toward camera — filmer retreats as she approaches
10. Unmanned establishing shot — skyline alone, no person
11. Haul reveal — lifting the shopping bag to the lens
12. Chapter title card (edit layer, e.g. `#STEAK HOUSE`)

### 4.2 Action / performance bank (12)

Window side-glance · answering an off-screen question ("어 네!") · reaching toward
an artwork · eating while listening (reacting mid-chew) · salt-shaker prop
business · hand gestures while storytelling · laughing then closing eyes toward
the window · **gaze floating up before answering (the thinking beat)** · haul
reveal · walking with a drink in snow · turning on a bench to talk · self-grooming
(hair, collar).

### 4.3 Wardrobe formula

**Oversized black leather + white knit + monochrome minimal.** Boxy leather
jacket with silver zips (worn open; caped over shoulders when seated), clean
white knit underneath — the dark jacket frames the face and the white top acts as
a bounce. Minimal accessories (small earrings), no hat/scarf, hair simply down.
Thin for the season — the "off-duty idol uniform".

```
Outfit: an oversized boxy black leather jacket with silver zips worn open, a
clean white knit top underneath, slim dark jeans — chic off-duty idol look,
minimal accessories, small earrings only.
```

### 4.4 What actually makes it read real

- The camera is a person she trusts, not a mirror
- Dead time survives the edit; subtitles carry the silence
- Unflattering moments survive — tired eyes, mid-chew, eyes shut
- She is **half-distracted by the world** for most of every shot

## 5. Model-specific traps (field-verified 2026-07-15)

### 5.1 Grok's hidden image step is a storyboard factory

`lib/providers/grok.ts`: grok-imagine-video is **image-to-video only** — chat
prompts silently generate a still first, then animate it. Feed it a
multi-beat script with quoted dialogue and the *image* model draws the most
plausible thing: **a subtitled 2-panel storyboard**. The video faithfully
animates that.

Evidence (n=4): every take containing an off-screen second speaker → split
screen. The one take with a single voice → clean. Prompt-layer bans did not fix
it; stacking more bans made it worse (see §5.2).

Fixes, in order of reliability:
1. **Flow mode** — confirm a single full-frame still by eye (Stage 1), then
   animate (Stage 2). Structurally impossible to split.
2. **Patch the adapter** — send only Scene + Character + first beat (plus
   "single full-frame photo") to the image step, not the full script.
3. Prompt-layer mitigations (§5.2), which help but do not guarantee.

### 5.2 Negation blindness — bans plant the thing they ban

Diffusion image steps weight nouns strongly and negations weakly. Writing
"NEVER split screen, no collage, no storyboard grid" injects *split screen*,
*collage*, *storyboard* into the image step. Take 11 stacked the strongest bans
yet and produced the worst result (3-panel split + burned subtitles + the friend
rendered on screen).

**Rule: for image-step models, describe the composition you want, positively.**

```
✅ A single vertical 9:16 phone video: one young woman alone on screen, one
   continuous full-frame handheld shot for all 8 seconds. The frame always shows
   exactly one person.
❌ NEVER split screen, never stacked panels, never a collage or storyboard grid.
```

Same for subtitles ("no subtitles" plants *subtitles*):
```
✅ Text rule: every surface in the frame is free of readable text — blank signs,
   blank windows, nothing written anywhere.
✅ The dialogue is spoken aloud as AUDIO ONLY.
```

### 5.3 Off-screen second speaker → shot/reverse-shot reflex

Invisible speakers co-occur with cutaway edits in training data. Naming a
second voice makes the model either cut to them or render them in frame.

**Keep the friend audible only in your head:** one voice, and let her *react* to
an unheard remark — "she catches an unheard remark from her friend and nods at
the lens". Or better, have her **ask** the friend a question — the answer lives
off-screen in the future, dialogue feels two-way, and it doubles as an ending.

### 5.4 Moderation tiers: Veo > Grok > Higgsfield

The string "K-pop idol" + a name reads as a celebrity request.

- **Higgsfield/Seedance**: passes `RENA — 20 year old K-pop idol` verbatim
- **Grok**: passes with the inline hedge
  `A 20 year old K-pop idol (a fictional original character not based on any real person)`
- **Veo 3.1**: blocks even with the hedge → drop the job label entirely
  ("a young vlogger" / "a Korean woman"), keep the physical spec + makeup block

Never feed a real person's face as an identity reference with a "replace the
face" instruction — that reads as deepfake and gets blocked (correctly). Extract
the *recipe* (lighting, framing, wardrobe, grammar) as text; use only our own
confirmed stills as identity references.

### 5.5 Grok prompt cap: 4096 chars

Hard limit, silently fatal at submit time. Our full spec runs ~4,700–5,000 chars
→ always compact for Grok. Compact by deleting adjectives and merging sections
(Story→Format, Acting→Facial life, Continuity→Physics); **never** by dropping
contracts (deep focus / text rule / audio-only / cut budget). Typical: 4,700 →
3,850 with every contract intact.

### 5.6 Seedance needs no armor

Native t2v — no hidden image step, so no split-screen class of failure at all.
It also holds cut structure and burns no subtitles with 7 dialogue lines across
8 cuts (rena-cafe, verified). Narrative prose + an image reference performs at
reference grade *without* the 15-section armor; the armor exists for weaker or
stricter models.

## 6. The two-tier workflow (the day's economic lesson)

Same prompt, two renderers, one day apart:

| | Grok Imagine | Seedance 2.0 |
|---|---|---|
| Split screen | 4 takes in a row | none |
| Background | melts / hides behind blur | drawn to the edge |
| Skin, leather, hair | flat | material-accurate |
| Korean dialogue | below bar | usable |
| Cost | ~$0.64–0.80/take | 36 cr (8s 720p) · 72 cr (8s 1080p) · 135 cr (15s 1080p) |

14 Grok takes ≈ $10 to converge the *prompt*. One Seedance take (36 cr) then
landed it first try. Neither is wrong — but know what you're buying:

> **Grok = grammar drafting (cheap, fast, structure only).
> Seedance = the publishable render.**

Do not iterate on Grok to fix texture/acting/voice. Do not burn Seedance credits
to discover that a cut board is mis-paced. When Grok structure is clean and the
gap left is "pretty but 70%", **stop iterating and switch renderers.**

## 7. Format bank

Recipes, not combinations. The combinatorial space (camera × action × wardrobe ×
script × time-of-day × place) is nominally ~10k, but most combinations aren't
grammatical — the scene format constrains which cameras and actions are legal.
What's worth counting is **verified recipes**.

| Recipe | Camera | Actions | Script slot | Status |
|---|---|---|---|---|
| Night walk selfie | selfie one-take / 4-cut jump | walk · sky glance · breath · stop under lamp | hello → savor → local ask | ✅ verified (Grok 0/7) |
| Day travel one-take | selfie one-take | walk · look around · slow to a stop | arrival → awe → 맛집 CTA | ✅ verified (Grok 4/6) |
| **Friend-cam window shopping** | friend tracking, 3/4 from her left | browse · pocket hands · glance to lens · point at glass | thinking out loud → question to friend | ✅ **verified (Seedance, 2026-07-15)** |
| Car interview | fixed 3/4 back-seat, window light pulse | thinking beat · hand gestures · look out window | Q&A, one topic | ⬜ untested |
| Table cam | static, food POV inserts | eat · react mid-chew · prop business | food reaction | ⬜ untested |
| Bench + drink | bench-height, turn-to-talk | sip · turn · laugh | wind-down chat | ⬜ untested |

**New episode = pick a verified recipe, change ONE variable** (place, script, or
wardrobe). New recipes get their own verification cycle. This minimal-delta rule
is what kept identity and quality stable across today's takes.

## 8. Character consistency without an image reference

Text-only takes still produced a strikingly consistent face all day. Why:

1. **The spec is narrow enough to collapse the distribution** — slim oval +
   V-line jaw + tapered chin + aegyo-sal + small nose + chest-length center-parted
   straight black hair + 166cm 7-head. Plus "K-pop idol", which pulls hard toward
   a single dense mode in training data.
2. **We froze the Character block** — not one character in the block changed all
   day; only wardrobe, scene, and script moved. Every time the face spec *was*
   edited (round→oval, moles added/removed), identity wobbled.
3. **Hair + makeup carry most of perceived identity** — a fixed hairstyle, brow
   shape, and lip color let the viewer's brain bind slightly different faces into
   "the same person".

Limit: this is **brand-level consistency, not pixel-level identity**. Side by
side as stills, the night-walk girl and the NYC girl are different people. Fine
for one-off clips; breaks the moment viewers binge a series. When that matters →
freeze a good still as a **Character card** and switch to i2v (Flow).

Also: text specs beat spec-source trust. The RENA source spec said "soft round
face with full cheeks" while its own output frames were clearly slim-oval with a
V-line jaw. Copying the words made faces worse. **Trust the reference frames,
not the reference words** — write the spec from what you see.

## 9. Pre-flight checklist

Before spending a credit:

- [ ] Duration field == Format declaration == cut count
- [ ] Dialogue ≤ ~30–36 syllables (8s); each line 8–12; no consonant clusters/glides
- [ ] Scene names a specific, dense, low-signage place — and it earns the dialogue
- [ ] Deep focus contract present; bokeh only on macro cuts
- [ ] Text rule present, phrased positively; dialogue marked AUDIO ONLY
- [ ] One voice only (or a reaction to an unheard remark)
- [ ] Gaze block present (lens is home base, not a stare)
- [ ] Story through-line section present
- [ ] Hands defined at every moment (one at a time; the other in a pocket)
- [ ] Grok: ≤ 4096 chars, positive composition, no ban vocabulary
- [ ] Veo: no "idol" label anywhere
- [ ] Right renderer for the goal (draft vs publish)

## Pending

- **UI wiring**: `lib/vlog-blocks.ts` ships the bank as pickable data
  (VLOG_FORMATS / VLOG_MOVES / VLOG_LOOKS / VLOG_SCRIPTS + `composeVlog()`), same
  shape as CHARACTERS/SETTINGS/FASHION in `lib/prompts.ts`. Not yet rendered in
  the Flow/Chat carousels — next step is a MOVES-style chip row.
- **Adapter patch**: trim what `grok.ts` sends to its image step (§5.1) — should
  kill the split-screen class at the source for chat mode.
- **Auto artifact QA**: extract 4 frames per take → vision check for panel
  splits / extra arms / burned text → badge in the take list.
- Car-interview and table-cam recipes are speculative until a take verifies them.
