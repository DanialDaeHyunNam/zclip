/**
 * Reaction-hook prompt templates. One held beat, explicit negatives —
 * stacking actions into a 3s window makes video models overact.
 */

const STYLE_PREFIX =
  "Vertical 9:16 amateur front-camera selfie video, handheld iPhone.";

const STYLE_SUFFIX =
  "Authentic unpolished UGC look, natural skin texture, subtle handheld camera shake, slightly overexposed, no cinematic color grading. 3 seconds.";

export interface Variant {
  id: string;
  label: string;
  prompt: string;
}

export const VARIANTS: Variant[] = [
  {
    id: "blonde",
    label: "Blonde beauty",
    prompt: `${STYLE_PREFIX} A pretty blonde girl-next-door woman in her early 20s, long wavy blonde hair slightly messy, fair skin with a few freckles, light natural makeup, casual oversized hoodie, sitting in a softly lit real bedroom with a slightly cluttered background. She is looking at her phone, and in one calm slow beat her eyes widen slightly and she silently mouths 'whaaaat?' in quiet disbelief, then holds that expression. Just one single subtle reaction — no gasping, no panting, no hand movements, minimal motion, slow and natural. ${STYLE_SUFFIX}`,
  },
  {
    id: "korean",
    label: "Korean influencer",
    prompt: `${STYLE_PREFIX} A pretty young Korean woman in her early-to-mid 20s with a soft influencer look, dewy glass skin, subtle K-beauty natural makeup, straight dark hair with light-brown balayage falling loosely, wearing a cozy cream oversized cardigan, sitting in a softly lit real bedroom with a slightly cluttered background. She is looking at her phone, and in one calm slow beat her eyes widen slightly and she silently mouths 'whaaaat?' in quiet disbelief, then holds that expression. Just one single subtle reaction — no gasping, no panting, no hand movements, minimal motion, slow and natural. ${STYLE_SUFFIX}`,
  },
  {
    id: "freckles",
    label: "Freckled double-take",
    prompt: `${STYLE_PREFIX} A cute woman in her mid-20s, freckles, hair in a loose bun, oversized sweater, in a cozy cluttered room. She is looking at her phone, then she looks away distracted, then does one slow double-take back at her phone, eyes going wide and lips parting in a quiet 'wait, what?' — then holds it. Just one single subtle reaction, no gasping, no panting, no hand movements, slow and natural. ${STYLE_SUFFIX}`,
  },
];

export const PROMPT_RULE =
  "Keep the reaction to ONE single held beat, not a multi-step sequence — stacking several actions in 3 seconds makes the model overact (panting/frantic). Use explicit negatives like 'no gasping, no panting, no hand movements, slow and natural'.";
