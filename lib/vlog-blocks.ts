/**
 * Vlog format bank — pickable building blocks for talking-vlog takes.
 *
 * Same shape as CHARACTERS / SETTINGS / FASHION in `prompts.ts`, but for the
 * harder problem: an 8s clip a scroller accepts as a real person filming their
 * real life. Pick a FORMAT (who holds the camera + how it cuts), a LOOK (place
 * + light), a MOVE set (what her body/eyes do), and a SCRIPT (what she says),
 * and `composeVlog()` assembles a spec-compliant prompt.
 *
 * Every contract baked in here is field-verified — see docs/VLOG-REALISM-SPEC.md
 * for the evidence behind each one. The short version:
 *   - physics, not vibes ("real front cameras cannot blur backgrounds")
 *   - ~30-36 syllables of Korean per 8s; one line per beat
 *   - gaze is home base, not a stare (the single biggest uncanny lever)
 *   - positive composition only — bans plant what they ban on image-step models
 */

/** Shared realism contract. Physics + imperfection + the text/audio rules.
 *  Phrased positively on purpose: Grok's hidden image step reads "no split
 *  screen" as *split screen*. Only medium-physics negations survive here
 *  (bokeh/filter), which are stated as properties of the camera, not bans. */
const REALISM_CONTRACT =
  "Style: 8K photorealistic — real handheld phone vlog footage, genuinely phone-shot, not DSLR. No 3D render, no game engine, no anime. " +
  "Camera physics: tiny phone sensor with a fixed small aperture — everything is in sharp focus at once, background fully rendered in crisp detail at the SAME fidelity as her face: true material textures, clean geometry, no melted or smudged shapes. Real front cameras cannot blur backgrounds — no bokeh, no portrait-mode blur, no shallow depth of field. 180-degree shutter motion blur, natural micro-shake. " +
  "Skin & Makeup: real skin texture clearly visible through flawless professional idol makeup — fine pores, vellus hair, natural tonal variation, soft matte finish. Defined eyes, long lashes, straight brows, rose-pink satin lips. Clear skin — no moles, no freckles, no beauty filter, no airbrushing, no glossy wet look. " +
  "Text rule: every surface in the frame is free of readable text — blank signs, blank windows, nothing written anywhere. The dialogue is spoken aloud as AUDIO ONLY.";

/** The gaze block. Extracted frame-by-frame from a real idol vlog: four gaze
 *  moves inside a single 3s sentence. "Eye-contact with the lens" — our old
 *  default — was locking the exact thing that makes a face look alive. */
const FACIAL_LIFE =
  "Facial life: her gaze does NOT stay on the lens — it drifts to the world around her while she talks, drops in a small thinking beat, then returns to the lens to land the end of a line. Her head turns freely with her gaze, eyebrows rise and fall with the emphasis of her words, small smiles and little laughs break mid-sentence. She looks at the lens the way you glance at a friend while talking — returning, not staring. Bright, bubbly energy under a calm pace, chest rise from breathing. Never posed-frozen, always alive.";

/** Character canon. Frozen on purpose — identity holds across text-only takes
 *  because this block never changes (see spec §8). Edit with care; every past
 *  edit wobbled the face. The parenthetical is the moderation hedge that gets
 *  through Grok; Veo needs the job label dropped entirely (see `forVeo`). */
export const VLOG_CHARACTER =
  "A 20 year old K-pop idol (a fictional original character not based on any real person), 166cm, slim 7-head proportions. Slim oval face, delicate V-line jaw, softly tapered chin, big round sparkling dark brown eyes with aegyo-sal, small slender nose. Very long straight black hair past her chest, center-parted. Small silver stud earrings.";

export interface VlogFormat {
  id: string;
  label: string;
  desc: string;
  /** Who holds the camera and how the take is edited. */
  prompt: string;
  /** Friend-cam endings cut mid-moment; selfie-cam endings sign off. Mixing
   *  them reads wrong — the ending grammar belongs to the format. */
  ending: string;
  verified: boolean;
}

export const VLOG_FORMATS: VlogFormat[] = [
  {
    id: "friend-cam",
    label: "Friend Cam",
    desc: "FILMED BY A FRIEND · ONE TAKE",
    verified: true,
    prompt:
      "A single vertical 9:16 phone video: one young woman alone on screen, filmed by the friend walking beside her — one continuous full-frame handheld shot for the whole take, from the first frame to the last. The frame always shows exactly one person: her, chest-up, mid-stride. The friend stays behind the camera and is never visible. She is NOT holding the camera — her hands are free. The phone is held vertically at a three-quarter angle from her left, with the filmer's natural walking sway, drifting slightly ahead or behind. A quiet caught moment — relaxed, nothing performed.",
    ending:
      "the take ends mid-moment, still walking, mid-conversation — no goodbye, no sign-off",
  },
  {
    id: "selfie-onetake",
    label: "Selfie One-Take",
    desc: "ARM'S LENGTH · UNBROKEN",
    verified: true,
    prompt:
      "A single vertical 9:16 phone video: one young woman alone on screen filming herself — ONE continuous full-frame handheld selfie shot for the whole take, from the first frame to the last, exactly how a person films a quick selfie video while walking. Front-facing phone selfie at arm's length, slight wide-lens distortion, her selfie arm edging into frame, gentle walking bounce with each step, the framing drifting slightly as her arm moves.",
    ending:
      "she slows gently to a stop, a fast wave and a wink with a finger-heart, holding her smile into the lens to the last frame, not ending abruptly",
  },
  {
    id: "selfie-jumpcut",
    label: "Selfie Jump-Cut",
    desc: "4 CUTS · TRIMMED BEATS",
    verified: true,
    prompt:
      "A vertical 9:16 phone selfie vlog in exactly 4 cuts, about 2 seconds each. Front-facing selfie at arm's length, slight wide-lens distortion, gentle walking bounce, natural micro-shake. Jump-cut editing: every cut begins MID-motion and mid-breath, as if the boring seconds were trimmed out. The phone angle shifts between cuts — left side, right side, then lowered to center — like a real vlogger shifting her phone as she walks. Every cut is a single full-frame shot showing exactly one person.",
    ending:
      "she stops under a light, a fast wave and a wink with a finger-heart, holding her smile to the last frame",
  },
  {
    id: "car-interview",
    label: "Car Interview",
    desc: "BACK SEAT · WINDOW PULSE",
    verified: false,
    prompt:
      "A single vertical 9:16 phone video: one young woman alone in the back seat of a moving car, filmed from the front seat at a three-quarter angle — one continuous full-frame shot, the camera resting steady with the car's small vibrations. Her face brightness pulses gently as buildings and daylight pass the window behind her. She is not holding the camera — her hands are free. A quiet caught moment, talking to the friend behind the camera.",
    ending:
      "the take ends mid-thought, her eyes drifting back to the window, still riding",
  },
  {
    id: "table-cam",
    label: "Table Cam",
    desc: "STATIC · FOOD POV",
    verified: false,
    prompt:
      "A single vertical 9:16 phone video: one young woman alone at a restaurant table, the phone propped static across from her — one continuous full-frame shot, no camera movement at all. She simply exists in the frame, eating and talking, half-forgetting the camera is running.",
    ending:
      "the take ends on her mid-chew, glancing off toward the room, saying nothing",
  },
];

export interface VlogLook {
  id: string;
  label: string;
  desc: string;
  /** Place + light in one fragment. Named narrowly on purpose: dense,
   *  photographed-to-death locations render as real places; generic ones melt.
   *  Low-signage places only — AI-broken lettering is a top-tier tell. */
  prompt: string;
  verified: boolean;
}

export const VLOG_LOOKS: VlogLook[] = [
  {
    id: "soho-winter",
    label: "SoHo Winter",
    desc: "CAST-IRON · SHOVELED SNOW",
    verified: true,
    prompt:
      "Scene: a SoHo side street in New York on a cold winter afternoon — cast-iron facades, storefront display windows with mannequins and warm interior light, piles of shoveled snow along the curb, parked cars, a few distant pedestrians far behind her. Lighting: cold winter afternoon daylight, low pale sun, soft shadows, natural phone exposure, slightly cool muted color. Her breath is faintly visible in the cold air, cheeks faintly flushed.",
  },
  {
    id: "soho-autumn",
    label: "SoHo Autumn",
    desc: "GOLDEN · FALLEN LEAVES",
    verified: false,
    prompt:
      "Scene: a SoHo side street in New York on a warm autumn afternoon — cast-iron facades, storefront display windows with warm interior light, golden trees along the curb, scattered fallen leaves on the sidewalk, parked cars, a few distant pedestrians. Lighting: warm golden afternoon light, low sun between the buildings, soft long shadows, natural phone exposure, true-to-life color.",
  },
  {
    id: "kyoto-lane",
    label: "Kyoto Lane",
    desc: "MACHIYA · STONE PATH",
    verified: true,
    prompt:
      "Scene: a picturesque stone-paved lane in Kyoto's old Higashiyama district on a bright afternoon — traditional wooden machiya townhouses with dark timber lattice fronts and tiled roofs lining both sides, plain paper lanterns under the eaves, small green maples over old walls, the lane sloping gently away behind her. Quiet, charming, almost no one around. Lighting: soft bright afternoon daylight, gentle shadows, natural phone exposure.",
  },
  {
    id: "yeonnam-night",
    label: "Yeonnam Night",
    desc: "PARK PATH · LAMP POOLS",
    verified: true,
    prompt:
      "Scene: the tree-lined park path of Gyeongui Line Forest Park in Yeonnam-dong, Seoul, late at night — a narrow stone path between grass strips, leafy trees overhead, warm low park lamps spaced along the way, dark low buildings in the distance, almost no one around. Lighting: night exposure, one light world — the SAME warm lamps that light the path light her face. She is slightly underexposed, colors muted like real night phone footage, brightening only when she passes under a lamp, faint night grain. No ring light, no fill, no beauty light from the camera side. The sky stays truly dark.",
  },
  {
    id: "room-evening",
    label: "Room Evening",
    desc: "ONE LAMP · PLAIN WALL",
    verified: false,
    prompt:
      "Scene: a tidy minimal room in the evening — a plain warm-ivory wall behind her, nothing else in frame, no clutter. Lighting: a single warm bulb lamp just off-frame camera-left is the only light, pouring golden light onto her face while the wall behind falls into soft charcoal shadow. High-key on the face, deep shadow elsewhere. No overhead lights, no flat ambient.",
  },
];

export interface VlogMoves {
  id: string;
  label: string;
  desc: string;
  /** Body/eye choreography. Sequential by design — simultaneous actions at the
   *  frame edge (entering + waving) is where extra arms get born. */
  prompt: string;
}

export const VLOG_MOVES: VlogMoves[] = [
  {
    id: "window-shop",
    label: "Window Shopping",
    desc: "BROWSE · POINT · POCKET",
    prompt:
      "She walks at a lazy pace past the display windows, eyes on the storefronts, genuinely browsing. She strolls unhurried, one hand at a time — the other resting in her jacket pocket. Her eyes catch something in a window and she drifts a step closer to the glass to look.",
  },
  {
    id: "stroll-savor",
    label: "Stroll & Savor",
    desc: "SKY GLANCE · DEEP BREATH",
    prompt:
      "She walks at an easy pace, her eyes drifting up to the trees and the sky above, taking a slow contented breath of the air. A strand of hair blows across her face and she tucks it back with a soft real laugh, without breaking stride.",
  },
  {
    id: "arrive-awe",
    label: "Arrive & Awe",
    desc: "LOOK AROUND · SLOW STOP",
    prompt:
      "She walks at an easy pace, her eyes sweeping the buildings around her with real awe, mouth slightly open for a beat, then back to the lens still glowing. She slows gently to a stop, leaning a touch toward the lens like asking a friend.",
  },
  {
    id: "reflection-check",
    label: "Reflection Check",
    desc: "GLASS · HAIR · SELF-LAUGH",
    prompt:
      "Passing a window she notices her own reflection in the glass, slows half a step, and tucks a strand of hair behind her ear with a small laugh at herself, then walks on.",
  },
  {
    id: "think-and-answer",
    label: "Think & Answer",
    desc: "GAZE FLOAT · HAND GESTURE",
    prompt:
      "Before she answers, her gaze floats up and away for a real thinking beat, then comes back as she starts talking, her free hand moving with the story, her head turning to the window and back mid-sentence.",
  },
];

export interface VlogScript {
  id: string;
  label: string;
  desc: string;
  /** Korean lines with syllable counts. Budget: ~30-36 syllables per 8s clip
   *  (Korean casual speech ≈ 5-6 syll/sec, minus ~2-3s of acting beats).
   *  Open simple syllables only — clusters and glides break Grok's lip-sync. */
  lines: { ko: string; en: string; syllables: number; direction: string }[];
  format: string[]; // compatible VlogFormat ids
}

export const VLOG_SCRIPTS: VlogScript[] = [
  {
    id: "friend-hungry",
    label: "Where Are We Eating",
    desc: "THINK ALOUD · ASK FRIEND",
    format: ["friend-cam", "car-interview", "table-cam"],
    lines: [
      { ko: "여기 예쁘지?", en: "Pretty here, right?", syllables: 5, direction: "she murmurs half to herself" },
      { ko: "나 진짜 와보고 싶었어.", en: "I really wanted to come here.", syllables: 9, direction: "she glances to the camera with a soft grin" },
      { ko: "근데 우리 뭐 먹으러 가는 거야?", en: "So what are we going to eat?", syllables: 12, direction: "she turns her head to the camera with a curious, slightly hungry smile, eyebrows raised at her friend" },
    ],
  },
  {
    id: "night-local-ask",
    label: "Night Walk + Local Ask",
    desc: "HELLO · SAVOR · 맛집 CTA",
    format: ["selfie-onetake", "selfie-jumpcut"],
    lines: [
      { ko: "하이 여러분~!", en: "Hi everyone~!", syllables: 5, direction: "she breaks into a bright grin, a small wave following the line, one hand only" },
      { ko: "밤 산책 나왔어요~", en: "Out for a night walk~", syllables: 7, direction: "she gives a happy little shrug to the lens" },
      { ko: "와… 밤공기 너무 좋다.", en: "Ah… the night air is so good.", syllables: 8, direction: "her eyes close for a beat as she takes a deep contented breath" },
      { ko: "여기 연남동인데, 맛집 댓글로 알려주세요~", en: "I'm in Yeonnam-dong — drop food spots in the comments~", syllables: 16, direction: "stopped under a lamp, she leans toward the lens like asking a friend, with a playful point toward the bottom of the frame" },
    ],
  },
  {
    id: "travel-arrival",
    label: "Travel Arrival",
    desc: "I'M HERE · AWE · 맛집 CTA",
    format: ["selfie-onetake", "selfie-jumpcut", "friend-cam"],
    lines: [
      { ko: "여러분~ 저 교토 왔어요!", en: "Everyone~ I'm in Kyoto!", syllables: 9, direction: "she breaks into a big bright grin, a small wave following the line" },
      { ko: "와… 여기 너무 예쁘죠?", en: "Wow… so pretty here, right?", syllables: 8, direction: "her eyes sweep the street with real awe, then come back to the lens still glowing" },
      { ko: "이 근처 맛집 아는 분, 댓글 부탁해요~", en: "Anyone know good food nearby? Comments please~", syllables: 14, direction: "slowing to a stop, she gestures around at the street with one hand, then puts her palms together in a cute please" },
    ],
  },
];

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Veo blocks the "idol" token outright (spec §5.4) — strip every occurrence,
 *  including the one buried in the makeup clause. The physical spec carries the
 *  visual on its own; the job label was never what made her pretty. */
const deIdol = (s: string) =>
  s
    .replace("A 20 year old K-pop idol", "A 20 year old Korean woman")
    .replace("flawless professional idol makeup", "flawless professional K-beauty makeup");

/** Assemble a spec-compliant vlog prompt from picked blocks.
 *
 * `charSpec` lets a confirmed Character card override the frozen canon.
 * `forVeo` strips the blocked "idol" label (spec §5.4). `compact` drops the
 * optional prose to clear Grok's 4096-char cap while keeping every contract —
 * always check the returned `overGrokCap` before submitting to Grok.
 */
export function composeVlog(opts: {
  format: VlogFormat;
  look: VlogLook;
  moves: VlogMoves;
  script: VlogScript;
  durationSeconds?: number;
  charSpec?: string;
  forVeo?: boolean;
  compact?: boolean;
}): {
  prompt: string;
  label: string;
  chars: number;
  syllables: number;
  overGrokCap: boolean;
  overSyllableBudget: boolean;
} {
  const {
    format,
    look,
    moves,
    script,
    durationSeconds = 8,
    charSpec,
    forVeo = false,
    compact = false,
  } = opts;

  const character = charSpec ?? VLOG_CHARACTER;
  const syllables = script.lines.reduce((n, l) => n + l.syllables, 0);

  // Each line rides its own acting direction so the dialogue lands as one
  // conversation rather than a stack of isolated readings.
  const take = script.lines
    .map((l, i) => {
      const d = i === 0 ? upperFirst(l.direction) : l.direction;
      return `${d}: "${l.ko}"`;
    })
    .join(" — then ");

  const sections = [
    format.prompt,
    REALISM_CONTRACT,
    FACIAL_LIFE,
    look.prompt,
    `Audio: natural ambience of the place around her. ONE voice only — hers: bright, youthful, casual and unhurried, accurate lip-sync. Her lines are ONE continuous chat, each flowing from the previous one in the same mood — never isolated readings. Real phone-mic sound, never studio-clean.`,
    `Character: ${character}`,
    `The take (${durationSeconds}s, one continuous shot): ${moves.prompt} ${take} — ${format.ending}.`,
  ];

  // Prose that earns its place at full length but is the first to go when the
  // cap bites — the contracts above it never are (spec §5.5).
  if (!compact) {
    sections.splice(
      4,
      0,
      `Story: one emotional through-line across the take — a real vlog arc, never mechanical.`,
      `Physics: long hair swaying with her steps in the breeze, strands drifting across her face, clothing moving with real weight, correct contact shadows. Same girl, same outfit, same place throughout — no identity drift.`,
    );
  }

  let prompt = sections.join("\n");
  if (forVeo) prompt = deIdol(prompt);

  return {
    prompt,
    label: [format.label, look.label, script.label].join(" · "),
    chars: prompt.length,
    syllables,
    overGrokCap: prompt.length > GROK_PROMPT_MAX,
    overSyllableBudget: syllables > syllableBudget(durationSeconds),
  };
}

/** Grok's hard cap. Over this the job fails at submit with a length error. */
export const GROK_PROMPT_MAX = 4096;

/** Speech budget: Korean casual delivery ≈ 5-6 syllables/sec, and an 8s take
 *  spends ~2-3s on acting beats. Overrunning this is what makes dialogue rush. */
export function syllableBudget(durationSeconds: number): number {
  return Math.round(durationSeconds * 4.5);
}
