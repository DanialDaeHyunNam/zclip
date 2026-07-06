/**
 * Starter building blocks: pick a CHARACTER and/or SETTING visually, then
 * the chat message only has to describe the action. Composed prompts keep
 * the house style: one held beat, explicit negatives — stacking actions
 * into a 3s window makes video models overact.
 */

const stylePrefix = (aspect: string) =>
  aspect === "16:9"
    ? "Horizontal 16:9 amateur selfie-style video, handheld iPhone held sideways."
    : "Vertical 9:16 amateur front-camera selfie video, handheld iPhone.";

const STYLE_SUFFIX =
  "Hyper-realistic, indistinguishable from real found iPhone footage: natural skin texture with visible pores, no beauty filter, no airbrushed smoothing, authentic unpolished UGC look, subtle handheld camera shake, slightly imperfect exposure, no cinematic color grading. Natural micro-expressions, natural blinking, relaxed lifelike body language. 3 seconds.";

const defaultAction = (pronoun: "She" | "He") =>
  `${pronoun} is looking at ${pronoun === "She" ? "her" : "his"} phone, and in one calm slow beat ${pronoun === "She" ? "her" : "his"} eyes widen slightly and ${pronoun.toLowerCase()} silently mouths 'whaaaat?' in quiet disbelief, then holds that expression. Just one single subtle reaction — no gasping, no panting, no hand movements, minimal motion, slow and natural, with natural blinks and relaxed posture.`;

export interface Character {
  id: string;
  label: string;
  desc: string; // short mono descriptor on the card
  pronoun: "She" | "He";
  prompt: string; // subject description fragment
}

export interface Setting {
  id: string;
  label: string;
  desc: string;
  prompt: string; // location/lighting fragment ("sitting in …")
}

/** Each concept ships 3 numbered variants (Blonde 1/2/3 …). Tone target:
 *  very pretty/handsome in an everyday, approachable way — the
 *  best-looking person you might actually know, not a celebrity. All
 *  cast members are in their 20s; ask for age changes in the chat
 *  ("make her look ten years older") and the refiner applies it. */
interface CharBase {
  idBase: string;
  labelBase: string;
  pronoun: "She" | "He";
  desc: string;
  core: string; // shared subject core
  variants: string[]; // per-variant hair/outfit details
}

const CHAR_BASES: CharBase[] = [
  {
    idBase: "blonde",
    labelBase: "Blonde",
    pronoun: "She",
    desc: "EARLY 20S · CASUAL",
    core: "A very pretty blonde woman in her early 20s with an approachable girl-next-door look, natural realistic skin",
    variants: [
      "long wavy blonde hair, light natural makeup, oversized grey hoodie",
      "blonde hair in a claw-clip updo with loose strands, minimal makeup, white ribbed tank under an open flannel",
      "shoulder-length blonde bob, soft freckles, cream knit sweater",
    ],
  },
  {
    idBase: "asian-f",
    labelBase: "Asian Woman",
    pronoun: "She",
    desc: "EARLY-MID 20S · NATURAL",
    core: "A very pretty young East Asian woman in her early-to-mid 20s with a fresh natural look, clear realistic skin",
    variants: [
      "long dark hair with soft balayage, soft natural makeup, cozy cream oversized cardigan",
      "chin-length dark bob, barely-there makeup, oversized white tee",
      "long straight black hair half-tied, thin wire glasses, beige hoodie",
    ],
  },
  {
    idBase: "redhead",
    labelBase: "Redhead",
    pronoun: "She",
    desc: "MID 20S · CASUAL",
    core: "A very pretty woman in her mid-20s with natural copper-red hair and light freckles, realistic skin",
    variants: [
      "curly copper hair worn loose, green eyes, vintage band t-shirt",
      "straight auburn hair with curtain bangs, black turtleneck",
      "copper hair in a messy bun, denim jacket over a white tee",
    ],
  },
  {
    idBase: "black-f",
    labelBase: "Black Woman",
    pronoun: "She",
    desc: "EARLY 20S · NATURAL",
    core: "A very pretty Black woman in her early 20s with warm friendly features and natural realistic skin",
    variants: [
      "defined curls in a loose updo, ribbed knit top",
      "long box braids, small gold studs, cropped sweatshirt",
      "short natural afro, minimal makeup, satin blouse",
    ],
  },
  {
    idBase: "latina",
    labelBase: "Latina",
    pronoun: "She",
    desc: "MID 20S · WARM",
    core: "A very pretty Latina woman in her mid-20s with a warm approachable look and natural realistic skin",
    variants: [
      "glossy dark waves, subtle gold hoops, casual cropped cardigan",
      "dark hair in a sleek low bun, small hoops, white blouse",
      "loose dark curls, sun-kissed freckles, olive henley",
    ],
  },
  {
    idBase: "brunette",
    labelBase: "Brunette",
    pronoun: "She",
    desc: "MID 20S · RELATABLE",
    core: "A very pretty brunette woman in her mid-20s with a warm relatable look and natural realistic skin",
    variants: [
      "shoulder-length brown hair, comfortable knit top",
      "brown hair in a loose ponytail, striped long-sleeve tee",
      "layered brown hair, thin gold necklace, chambray shirt",
    ],
  },
  {
    idBase: "guy",
    labelBase: "White Man",
    pronoun: "He",
    desc: "MID 20S · CASUAL",
    core: "A handsome white man in his mid-20s with an easygoing approachable look and natural realistic skin",
    variants: [
      "tousled dark-blond hair, light stubble, heather-gray crewneck",
      "short brown hair, clean shave, navy henley",
      "medium wavy hair, casual glasses, plain black tee",
    ],
  },
  {
    idBase: "black-m",
    labelBase: "Black Man",
    pronoun: "He",
    desc: "MID 20S · CASUAL",
    core: "A handsome Black man in his mid-20s with a warm confident look and natural realistic skin",
    variants: [
      "short fade haircut, fitted white t-shirt",
      "short twists, light beard, olive crewneck",
      "buzz cut, clean look, denim overshirt",
    ],
  },
  {
    idBase: "asian-m",
    labelBase: "Asian Man",
    pronoun: "He",
    desc: "MID 20S · CLEAN",
    core: "A handsome East Asian man in his mid-20s with a clean approachable look and natural realistic skin",
    variants: [
      "neatly styled black hair, minimal black crewneck",
      "middle-part black hair, thin wire glasses, white oxford shirt",
      "short textured crop, light stubble, charcoal hoodie",
    ],
  },
];

export const CHARACTERS: Character[] = CHAR_BASES.flatMap((b) =>
  b.variants.map((v, i) => ({
    id: `${b.idBase}-${i + 1}`,
    label: `${b.labelBase} ${i + 1}`,
    desc: b.desc,
    pronoun: b.pronoun,
    prompt: `${b.core}, ${v}`,
  })),
);

export const SETTINGS: Setting[] = [
  {
    id: "bedroom",
    label: "Bedroom 1",
    desc: "WARM LAMP · CLUTTER",
    prompt:
      "sitting in a softly lit real bedroom with a slightly cluttered background and warm lamp light",
  },
  {
    id: "cafe",
    label: "Cafe 1",
    desc: "DAYLIGHT · BLURRED BAR",
    prompt:
      "sitting by the window of a cozy cafe in daylight, blurred espresso bar in the background",
  },
  {
    id: "car",
    label: "Car 1",
    desc: "DRIVER SEAT · WINDOW LIGHT",
    prompt:
      "sitting in the driver's seat of a parked car in daylight, soft window light on the face",
  },
  {
    id: "kitchen",
    label: "Kitchen 1",
    desc: "MORNING · LIVED-IN",
    prompt:
      "standing at a kitchen counter at home in soft morning light, everyday clutter in the background",
  },
  {
    id: "desk",
    label: "Desk 1",
    desc: "EVENING · MONITOR GLOW",
    prompt:
      "sitting at a desk in a home office in the evening, faint monitor glow to one side",
  },
  {
    id: "dorm",
    label: "Dorm 1",
    desc: "FAIRY LIGHTS · POSTERS",
    prompt:
      "sitting on a dorm-room floor leaning against the bed, fairy lights and posters in the background",
  },
  {
    id: "park",
    label: "Park 1",
    desc: "SUNNY · BENCH",
    prompt:
      "sitting on a bench in a sunny green park, trees and a walking path softly blurred behind",
  },
  {
    id: "mountain",
    label: "Mountain 1",
    desc: "OVERLOOK · GOLDEN HOUR",
    prompt:
      "standing at a scenic mountain overlook, hazy ridgelines and golden-hour light behind",
  },
  {
    id: "beach",
    label: "Beach 1",
    desc: "WAVES · BRIGHT SKY",
    prompt:
      "sitting on a sandy beach near the waterline, soft ocean waves and a bright sky behind",
  },
  {
    id: "rooftop",
    label: "Rooftop 1",
    desc: "DUSK · SKYLINE",
    prompt:
      "on a city rooftop at dusk, skyline lights softly blurred in the background",
  },
];

/** Any pickable block — built-in or user-created custom asset. */
export interface StarterBlock {
  label: string;
  prompt: string;
  pronoun?: "She" | "He";
}

/** Build a full starter prompt from picked blocks. Missing halves fall
 *  back to neutral defaults so either card works alone. */
export function composeStarter(
  c?: StarterBlock | null,
  s?: StarterBlock | null,
  aspect: string = "9:16",
): { prompt: string; label: string } | null {
  if (!c && !s) return null;
  // Casting default matches the built-in cast: photogenic, natural.
  const subject =
    c?.prompt ??
    "A very pretty young woman in her early 20s with an approachable natural look, realistic skin, casual outfit";
  const where =
    s?.prompt ?? "sitting in a softly lit room with a lived-in background";
  return {
    prompt: `${stylePrefix(aspect)} ${subject}, ${where}. ${defaultAction(c?.pronoun ?? "She")} ${STYLE_SUFFIX}`,
    label: [c?.label, s?.label].filter(Boolean).join(" · "),
  };
}

export const PROMPT_RULE =
  "Keep the reaction to ONE single held beat, not a multi-step sequence — stacking several actions in 3 seconds makes the model overact (panting/frantic). Use explicit negatives like 'no gasping, no panting, no hand movements, slow and natural'.";
