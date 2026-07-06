/**
 * Starter building blocks: pick a CHARACTER and/or SETTING visually, then
 * the chat message only has to describe the action. Composed prompts keep
 * the house style: one held beat, explicit negatives — stacking actions
 * into a 3s window makes video models overact.
 */

const STYLE_PREFIX =
  "Vertical 9:16 amateur front-camera selfie video, handheld iPhone.";

const STYLE_SUFFIX =
  "Authentic unpolished UGC look, natural skin texture, subtle handheld camera shake, slightly overexposed, no cinematic color grading. 3 seconds.";

const defaultAction = (pronoun: "She" | "He") =>
  `${pronoun} is looking at ${pronoun === "She" ? "her" : "his"} phone, and in one calm slow beat ${pronoun === "She" ? "her" : "his"} eyes widen slightly and ${pronoun.toLowerCase()} silently mouths 'whaaaat?' in quiet disbelief, then holds that expression. Just one single subtle reaction — no gasping, no panting, no hand movements, minimal motion, slow and natural.`;

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

export const CHARACTERS: Character[] = [
  {
    id: "blonde",
    label: "Blonde 1",
    desc: "EARLY 20S · HOODIE",
    pronoun: "She",
    prompt:
      "A strikingly beautiful blonde woman in her early 20s, long wavy blonde hair, luminous fair skin, light natural makeup, fit slim figure, casual oversized hoodie",
  },
  {
    id: "korean",
    label: "Korean 1",
    desc: "GLASS SKIN · CARDIGAN",
    pronoun: "She",
    prompt:
      "A strikingly beautiful young Korean woman in her early-to-mid 20s, dewy glass skin, subtle K-beauty makeup, long dark hair with soft balayage, slim elegant figure, cozy cream oversized cardigan",
  },
  {
    id: "redhead",
    label: "Redhead 1",
    desc: "COPPER CURLS · BAND TEE",
    pronoun: "She",
    prompt:
      "A gorgeous woman in her mid-20s with curly copper-red hair, striking green eyes, flawless pale skin, fit figure, vintage band t-shirt",
  },
  {
    id: "black-f",
    label: "Black Woman 1",
    desc: "CURLS · KNIT TOP",
    pronoun: "She",
    prompt:
      "A stunningly beautiful Black woman in her early 20s, radiant deep skin, defined curls in a loose updo, elegant features, fit figure, ribbed knit top",
  },
  {
    id: "latina",
    label: "Latina 1",
    desc: "DARK WAVES · GOLD HOOPS",
    pronoun: "She",
    prompt:
      "A gorgeous Latina woman in her mid-20s, warm tan skin, glossy dark waves, striking features, subtle gold hoops, fit figure, casual cropped cardigan",
  },
  {
    id: "brunette",
    label: "Brunette 1",
    desc: "LATE 30S · KNIT TOP",
    pronoun: "She",
    prompt:
      "A beautiful warm woman in her late 30s, elegant features, shoulder-length brown hair, soft glowing skin, fit figure, comfortable knit top",
  },
  {
    id: "guy",
    label: "White Man 1",
    desc: "JAWLINE · CREWNECK",
    pronoun: "He",
    prompt:
      "An exceptionally handsome white man in his mid-20s, chiseled jawline, piercing blue eyes, tousled dark-blond hair, light stubble, athletic build, fitted heather-gray crewneck",
  },
  {
    id: "black-m",
    label: "Black Man 1",
    desc: "FADE · WHITE TEE",
    pronoun: "He",
    prompt:
      "A strikingly handsome Black man in his mid-20s, sharp jawline, short fade haircut, warm confident eyes, athletic build, fitted white t-shirt",
  },
  {
    id: "asian-m",
    label: "Asian Man 1",
    desc: "SHARP · BLACK CREWNECK",
    pronoun: "He",
    prompt:
      "A very handsome East Asian man in his mid-20s, sharp features, styled black hair, clear skin, lean athletic build, minimal black crewneck",
  },
];

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
): { prompt: string; label: string } | null {
  if (!c && !s) return null;
  // House rule: every face is above-average attractive, even the fallback.
  const subject =
    c?.prompt ??
    "A very attractive young woman in her early 20s, naturally beautiful features, fresh glowing skin, fit figure, casual outfit";
  const where =
    s?.prompt ?? "sitting in a softly lit room with a lived-in background";
  return {
    prompt: `${STYLE_PREFIX} ${subject}, ${where}. ${defaultAction(c?.pronoun ?? "She")} ${STYLE_SUFFIX}`,
    label: [c?.label, s?.label].filter(Boolean).join(" · "),
  };
}

export const PROMPT_RULE =
  "Keep the reaction to ONE single held beat, not a multi-step sequence — stacking several actions in 3 seconds makes the model overact (panting/frantic). Use explicit negatives like 'no gasping, no panting, no hand movements, slow and natural'.";
