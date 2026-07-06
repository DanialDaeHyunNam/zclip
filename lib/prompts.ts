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
    label: "Blonde girl-next-door",
    desc: "EARLY 20S · HOODIE",
    pronoun: "She",
    prompt:
      "A pretty blonde girl-next-door woman in her early 20s, long wavy blonde hair slightly messy, fair skin with a few freckles, light natural makeup, casual oversized hoodie",
  },
  {
    id: "korean",
    label: "Korean influencer",
    desc: "GLASS SKIN · CARDIGAN",
    pronoun: "She",
    prompt:
      "A pretty young Korean woman in her early-to-mid 20s with a soft influencer look, dewy glass skin, subtle K-beauty natural makeup, straight dark hair with light-brown balayage falling loosely, wearing a cozy cream oversized cardigan",
  },
  {
    id: "freckles",
    label: "Freckled bun",
    desc: "MID 20S · SWEATER",
    pronoun: "She",
    prompt:
      "A cute woman in her mid-20s, freckles, hair in a loose bun, oversized sweater",
  },
  {
    id: "redhead",
    label: "Curly redhead",
    desc: "COPPER CURLS · BAND TEE",
    pronoun: "She",
    prompt:
      "A charismatic woman in her mid-20s with curly copper-red hair, pale skin, minimal makeup, wearing a vintage band t-shirt",
  },
  {
    id: "guy",
    label: "Casual guy",
    desc: "MID 20S · CREWNECK",
    pronoun: "He",
    prompt:
      "A friendly clean-cut man in his mid-20s, short dark hair, light stubble, wearing a plain heather-gray crewneck",
  },
  {
    id: "mom",
    label: "Relatable mom",
    desc: "LATE 30S · KNIT TOP",
    pronoun: "She",
    prompt:
      "A warm relatable woman in her late 30s, shoulder-length brown hair tied back loosely, comfortable knit top, soft natural look",
  },
];

export const SETTINGS: Setting[] = [
  {
    id: "bedroom",
    label: "Bedroom",
    desc: "WARM LAMP · CLUTTER",
    prompt:
      "sitting in a softly lit real bedroom with a slightly cluttered background and warm lamp light",
  },
  {
    id: "cafe",
    label: "Cafe window",
    desc: "DAYLIGHT · BLURRED BAR",
    prompt:
      "sitting by the window of a cozy cafe in daylight, blurred espresso bar in the background",
  },
  {
    id: "car",
    label: "Parked car",
    desc: "DRIVER SEAT · WINDOW LIGHT",
    prompt:
      "sitting in the driver's seat of a parked car in daylight, soft window light on the face",
  },
  {
    id: "kitchen",
    label: "Kitchen",
    desc: "MORNING · LIVED-IN",
    prompt:
      "standing at a kitchen counter at home in soft morning light, everyday clutter in the background",
  },
  {
    id: "desk",
    label: "Home office",
    desc: "EVENING · MONITOR GLOW",
    prompt:
      "sitting at a desk in a home office in the evening, faint monitor glow to one side",
  },
  {
    id: "dorm",
    label: "Dorm floor",
    desc: "FAIRY LIGHTS · POSTERS",
    prompt:
      "sitting on a dorm-room floor leaning against the bed, fairy lights and posters in the background",
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
  const subject =
    c?.prompt ??
    "A young woman in her early 20s with a natural everyday look, casual outfit";
  const where =
    s?.prompt ?? "sitting in a softly lit room with a lived-in background";
  return {
    prompt: `${STYLE_PREFIX} ${subject}, ${where}. ${defaultAction(c?.pronoun ?? "She")} ${STYLE_SUFFIX}`,
    label: [c?.label, s?.label].filter(Boolean).join(" · "),
  };
}

export const PROMPT_RULE =
  "Keep the reaction to ONE single held beat, not a multi-step sequence — stacking several actions in 3 seconds makes the model overact (panting/frantic). Use explicit negatives like 'no gasping, no panting, no hand movements, slow and natural'.";
