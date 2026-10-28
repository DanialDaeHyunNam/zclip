import type { Grade } from "@/lib/post-grade";

/**
 * ✂ POST — the ONE place the crop window, the handheld shake, the window
 * light and the vignette are defined, so the studio's live preview (WebGL, per frame)
 * and the ffmpeg render (/api/grab action "post") can't drift apart.
 *
 * Owner 2026-10-28: "everything that makes it look real has to be doable in
 * post" — trim, handheld shake, one-sided window light, 30fps, phone noise,
 * room tone. (No lens option on purpose: a 0.5× look is geometry — wider
 * field, the room and an arm in frame — that post can't add; DEVLOG #49.)
 */

/** Normalized crop window (left/top 0..1-span) for a centre (cx, cy).
 *  `margin` keeps the window that far off every edge so a shaking crop
 *  never runs out of picture; the zoom floors to make room for it. */
export function postWindow(zoom: number, cx: number, cy: number, margin = 0) {
  const z = Math.min(3, Math.max(1 / (1 - 2 * margin), Number.isFinite(zoom) ? zoom : 1));
  const span = 1 / z;
  const clamp = (v: number) =>
    Math.min(1 - span - margin, Math.max(margin, (Number.isFinite(v) ? v : 0.5) - span / 2));
  return { zoom: z, span, left: clamp(cx), top: clamp(cy) };
}

// ── Handheld shake ────────────────────────────────────────────────────────
// A held phone sways slowly (arm), breathes, and trembles a little: sums of
// sines at those rates, weights summing to 1. [weight, Hz, phase].
type Wave = readonly (readonly [number, number, number])[];
const SWAY_X: Wave = [[0.6, 0.7, 0.3], [0.3, 1.9, 1.1], [0.1, 5.3, 2.0]];
const SWAY_Y: Wave = [[0.6, 0.5, 1.7], [0.3, 2.3, 0.4], [0.1, 6.1, 2.9]];
const ROLL: Wave = [[0.7, 0.4, 0.9], [0.3, 1.3, 2.2]];

export type PostShake = 0 | 1 | 2;
export const POST_SHAKES: Record<Exclude<PostShake, 0>, { label: string; amp: number; roll: number }> = {
  // amp = max drift as a fraction of the source frame; roll = radians.
  1: { label: "Light — held still", amp: 0.006, roll: 0.0035 },
  2: { label: "Medium — restless hand", amp: 0.012, roll: 0.007 },
};

const wave = (w: Wave, t: number) =>
  w.reduce((s, [k, f, p]) => s + k * Math.sin(2 * Math.PI * f * t + p), 0);
const waveExpr = (w: Wave) => w.map(([k, f, p]) => `${k}*sin(2*PI*${f}*t+${p})`).join("+");

/** Room the crop needs for this shake (drift + the corners a roll swings in). */
export const shakeMargin = (level: PostShake) =>
  level ? POST_SHAKES[level].amp + POST_SHAKES[level].roll * 1.1 : 0;

/** Offsets at time t (seconds from the trimmed start) — the preview's copy. */
export function shakeAt(level: PostShake, t: number) {
  if (!level) return { dx: 0, dy: 0, roll: 0 };
  const { amp, roll } = POST_SHAKES[level];
  return { dx: amp * wave(SWAY_X, t), dy: amp * wave(SWAY_Y, t), roll: roll * wave(ROLL, t) };
}

/** The same offsets as ffmpeg expressions in `t` — the render's copy. */
export function shakeExpr(level: Exclude<PostShake, 0>) {
  const { amp, roll } = POST_SHAKES[level];
  return {
    dx: `${amp}*(${waveExpr(SWAY_X)})`,
    dy: `${amp}*(${waveExpr(SWAY_Y)})`,
    roll: `${roll}*(${waveExpr(ROLL)})`,
  };
}

// ── Window light × vignette: one multiply mask ─────────────────────────────
// The lit edge stays as is, the far edge darkens by `amount` along u^1.4,
// the shadow side cools a touch (blue drops faster) and the frame warms
// with the amount — daylight from one window. The vignette darkens the
// outer ring (elliptical, follows the frame). Both are position-dependent,
// so they can't live in the colour LUT (lib/post-grade.ts).
export type LightSide = "left" | "right";
const LIGHT_POW = 1.4;
export const VIGNETTE_MAX = 0.6;

/** Light multiply at u = 0 (lit edge) … 1 (far edge); amount 0 = no change. */
export function lightAt(amount: number, u: number) {
  const k = Math.pow(u, LIGHT_POW);
  const base = 1 - amount * k;
  return { r: base, g: base * (1 - 0.05 * amount), b: (1 - amount * 1.15 * k) * (1 - 0.15 * amount) };
}

/** Vignette multiply at d = 0 (centre) … 1 (corner); vignette 0–100. */
export function vignetteAt(vignette: number, d: number) {
  const s = Math.min(1, Math.max(0, (d - 0.35) / 0.65));
  return 1 - (vignette / 100) * VIGNETTE_MAX * s * s;
}

/** ffmpeg geq expressions (gbrp, one frame) for light × vignette. */
export function maskGeq(light: number, side: LightSide, vignette: number) {
  const u = side === "left" ? "X/W" : "(1-X/W)";
  const k = `pow(${u},${LIGHT_POW})`;
  const d = "hypot(2*X/W-1,2*Y/H-1)/1.41421";
  const v =
    vignette > 0
      ? `*(1-${((vignette / 100) * VIGNETTE_MAX).toFixed(4)}*pow(clip((${d}-0.35)/0.65,0,1),2))`
      : "";
  const a = light.toFixed(4);
  return {
    r: `255*(1-${a}*${k})${v}`,
    g: `255*(1-${a}*${k})*${(1 - 0.05 * light).toFixed(4)}${v}`,
    b: `255*(1-${(light * 1.15).toFixed(4)}*${k})*${(1 - 0.15 * light).toFixed(4)}${v}`,
  };
}

/** GRAIN 0–100 → ffmpeg noise strength (alls), 0–25. */
export const grainStrength = (grain: number) => Math.round(Math.min(100, Math.max(0, grain)) * 0.25);

// ── Presets ───────────────────────────────────────────────────────────────
// Owner 2026-10-28: recommended starting points. The takes are already
// close-ups, so most presets don't zoom (shake floors it a hair for room).
// Phone footage reads flatter than AI frames (HDR lifts shadows, holds
// highlights) — hence the gentle −contrast / −highlights / +shadows.
export type PostPreset = {
  key: string;
  label: string;
  hint: string;
  zoom: number;
  cx: number;
  cy: number;
  shake: PostShake;
  light: number;
  lightSide: LightSide;
  vignette: number;
  sharpen: number;
  grain: number;
  phoneEncode: boolean;
  fps30: boolean;
  room: boolean;
  grade: Partial<Grade>;
};
const PHONE_FLAT: Partial<Grade> = { contrast: -10, highlights: -20, shadows: 15, vibrance: -10 };
export const POST_PRESETS: PostPreset[] = [
  { key: "quiet", label: "Quiet selfie", hint: "Still, emotional beats — crying, thinking. Phone-flat colour, light grain.", zoom: 1, cx: 0.5, cy: 0.45, shake: 1, light: 0.2, lightSide: "left", vignette: 15, sharpen: 0, grain: 40, phoneEncode: true, fps30: true, room: true, grade: { ...PHONE_FLAT, temp: 5 } },
  { key: "restless", label: "Restless hand", hint: "Big reactions — gasp, laugh, shock. More hand movement.", zoom: 1.04, cx: 0.5, cy: 0.45, shake: 2, light: 0.15, lightSide: "left", vignette: 10, sharpen: 0, grain: 45, phoneEncode: true, fps30: true, room: true, grade: PHONE_FLAT },
  { key: "moody", label: "Moody window", hint: "Late-day sadness — one side in shade, cooler, muted, more grain.", zoom: 1, cx: 0.5, cy: 0.45, shake: 1, light: 0.4, lightSide: "left", vignette: 30, sharpen: 0, grain: 65, phoneEncode: true, fps30: true, room: true, grade: { exposure: -0.3, contrast: 10, highlights: -25, temp: -8, saturation: -15, shadowHue: 215, shadowTint: 15 } },
  { key: "lamp", label: "Warm lamp", hint: "Night in bed by a lamp — darker, warm, noisy like a phone in low light.", zoom: 1, cx: 0.5, cy: 0.45, shake: 1, light: 0.35, lightSide: "right", vignette: 35, sharpen: 0, grain: 75, phoneEncode: true, fps30: true, room: true, grade: { exposure: -0.5, contrast: 5, shadows: 10, temp: 25, tint: 5, saturation: -10, highlightHue: 35, highlightTint: 20 } },
  { key: "tight", label: "Tight off-centre", hint: "Zoe-style close crop, face pushed to one side.", zoom: 1.25, cx: 0.62, cy: 0.4, shake: 1, light: 0.2, lightSide: "left", vignette: 15, sharpen: 0, grain: 40, phoneEncode: true, fps30: true, room: true, grade: { ...PHONE_FLAT, temp: 5 } },
  { key: "clean", label: "Clean", hint: "As generated — crop only, nothing added.", zoom: 1, cx: 0.5, cy: 0.5, shake: 0, light: 0, lightSide: "left", vignette: 0, sharpen: 0, grain: 0, phoneEncode: false, fps30: false, room: false, grade: {} },
];
