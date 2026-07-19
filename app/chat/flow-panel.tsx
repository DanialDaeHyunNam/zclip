"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODELS,
  PROVIDERS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  resolveModel,
  effectiveSeconds,
  estimateModelCost,
  readsClip,
  type AspectRatio,
  type ProviderName,
  type Resolution,
} from "@/lib/config";
import { keyHeader, localKeyFlags, setLocalKey } from "@/lib/client-keys";
import * as store from "@/lib/store";
import {
  type Clip,
  fmtCost,
  isLocalVideoUrl,
  GALLERY_KEY,
  PW_KEY,
  PENDING_DEPTH_KEY,
} from "@/lib/clip";
import { FASHION } from "@/lib/prompts";
import { persistRemoteVideo } from "@/lib/persist-clip";

/**
 * FLOW method — embedded in the studio's session column as a METHOD
 * toggle (owner call: no separate page; the left preview frame is shared
 * with the chat method via onPreview).
 *
 *   Stage 1 · STILL  — generate (Grok/GPT/Gemini image) or upload the
 *                      look, iterate, CONFIRM one.
 *   Stage 2 · MOTION — animate the confirmed still (i2v), iterate the
 *                      motion endlessly while the still stays locked.
 *
 * Interop: finished takes vault + land in the SHARED gallery (Library,
 * spend chart — sessionId = flow id); confirmed stills save as custom
 * Character cards. State in `hooklab.flows` (file-backed store).
 */

const FLOWS_KEY = "hooklab.flows";

/** What the studio's left frame should show for the flow method. */
export interface FlowPreview {
  /** "busy" renders the chat method's scanline + elapsed timer in the
   *  shared left frame while a still/motion job runs (src unused). */
  kind: "image" | "video" | "busy";
  src: string;
  aspect: AspectRatio;
  label: string;
  /** busy only — when the job started, drives the elapsed readout. */
  startedAt?: number;
  /** video takes only — the MOVES reference url, unlocking the studio's
   *  COMPARE view (reference | take side-by-side, played together). */
  compareSrc?: string;
  compareLabel?: string;
}

/** 🎲 starter drafts — editing a full draft beats a blank box. Varied
 *  vibes, neutral casting; users overwrite freely. */
const LOOK_PRESETS = [
  "woman in her 20s, dewy glass skin, pink slip dress, pearl drop earrings, dressing-room vanity light, photoreal 9:16 portrait",
  "man in his late 20s, textured short hair, charcoal knit tee, soft window light in a minimal studio apartment, photoreal 9:16 portrait",
  "woman in her early 30s, natural freckles, oversized cream hoodie, warm bedroom lamp glow with fairy-light bokeh, photoreal 9:16 portrait",
  "athletic man in his 20s, post-workout glow, black training top, bright gym mirror light, photoreal 9:16 portrait",
  "woman in her 20s, sleek low bun, tailored beige blazer over white tee, clean office daylight, photoreal 9:16 portrait",
  "woman in her mid-20s, beach waves hair, white linen shirt, golden-hour backlight on a rooftop, photoreal 9:16 portrait",
  "man in his 30s, round glasses, denim shirt, cozy cafe window seat with blurred espresso bar, photoreal 9:16 portrait",
  "woman in her 20s, glossy dark hair, red satin top, neon street light at night with shallow depth of field, photoreal 9:16 portrait",
  "woman in her early 20s, glossy dark hair with soft bangs, idol-grade natural makeup — dewy clean skin, soft blush, gradient lip — casual fitted grey graphic tee, sitting on a desk chair in a bright lived-in bedroom, open doorway and unmade cream bedding behind her, plain softly-lit walls with at most two small indistinct polaroids, soft daylight, front-facing phone camera framing, photoreal 9:16 portrait",
];

const MOTION_PRESETS = [
  "subtle breathing, a slow blink, hair moving in a soft breeze, a small head tilt and a gentle smile at the lens",
  "mid-scroll on a phone, eyes snap wide, hand rises to cover the mouth, holds the surprised look with tiny micro-movements",
  "talking to the camera with bright energy, natural hand gestures, a quick laugh, never posed-frozen",
  "a slow confident smile building into a wink, chin tilts down slightly, eyes stay locked on the lens",
  "glances off-frame, notices the camera, breaks into a genuine laugh and leans in closer",
  "light bouncy sway to an unheard beat, shoulders loose, one playful finger-point at the lens",
  "lifts a coffee cup, takes a sip, exhales contentedly, eyes soften into a relaxed smile",
  "adjusts hair behind one ear, straightens posture, gives a small wave and mouths 'hi' to the lens",
];

const randomFrom = (list: string[], not?: string): string => {
  const pool = list.filter((p) => p !== not);
  return pool[Math.floor(Math.random() * pool.length)] ?? list[0];
};

const IMG_ENGINES = [
  { key: "grok", label: "Grok Imagine image", cost: 0.05 },
  { key: "gpt", label: "GPT Image (OpenAI)", cost: 0.06 },
  { key: "gemini", label: "Gemini 2.5 Flash Image", cost: 0.04 },
  // Same ByteDance family as Seedance — in text-identity mode the card is
  // a PREVIEW of the prompt, and a same-family preview predicts the
  // render. Transfer flows default here. (cost = third-party quote)
  { key: "seedream", label: "Seedream 4.0 (ByteDance — matches Seedance)", cost: 0.035 },
] as const;

interface FlowImageAttempt {
  id: string;
  prompt: string;
  image: string; // dataURL — file-backed store has no 5MB quota problem
  createdAt: number;
  /** Which engine drew it — transfer flows sort Seedream-made first and
   *  badge the rest (their text may render differently on Seedance). */
  engine?: string;
}

interface FlowMotionAttempt {
  id: string;
  prompt: string;
  modelKey: string;
  modelLabel: string;
  provider: string;
  jobId: string;
  status: "pending" | "done" | "error";
  videoUrl?: string;
  error?: string;
  costUsd?: number;
  durationSeconds: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  createdAt: number;
}

/** What a flow is FOR — picked at ＋ New flow (docs: three pipelines):
 *   "look"     · LOOK → MOTION (classic still → i2v iterate)
 *   "transfer" · MOVES → LOOK → TRANSFER (a reference video's choreography
 *                performed by your confirmed look — clip-reading models
 *                only, Seedance 2.0 today, Kling Motion Control later).
 *   "restyle"  · VIDEO → IMAGE (Lucy Edit v2v: the raw clip drives, the
 *                prompt/identity says what the dancer becomes — no depth
 *                pass, no filter dance, scene/camera/timing come free). */
type FlowKind = "look" | "transfer" | "restyle";

/** Restyle (Lucy Edit v2v) is HIDDEN from the ＋ New flow picker
 *  (owner call 2026-07-19): the offline lucy-edit model is Wan-2.2-based
 *  and comes out doll-faced on photoreal identity swaps + caps output at
 *  ~4s — not shippable quality. ALL its code stays wired (adapter,
 *  config, the restyle branches below) so flipping this to `true`
 *  revives it when Lucy 2.5-class offline v2v lands. Existing restyle
 *  flows still render; you just can't create new ones. */
const RESTYLE_ENABLED = false;

interface Flow {
  id: string;
  title: string;
  createdAt: number;
  /** Chat session this flow belongs to — a flow is a METHOD used inside
   *  a session, not a parallel world. Legacy flows (undefined) show in
   *  every session. */
  sessionId?: string;
  /** Legacy flows (undefined) are "look". */
  kind?: FlowKind;
  /** transfer only — the confirmed motion reference. A LIBRARY POINTER,
   *  never base64: the file-backed store must not swallow 35MB clips.
   *  audioUrl = where the SOUNDTRACK lives when the reference itself is
   *  silent (a depth clip carries its original's url here — set by the
   *  /depth handoff, or picked by hand in the REF AUDIO row). */
  refClip?: { url: string; label: string; audioUrl?: string } | null;
  /** transfer only — auto-convert the reference to a depth pass on ANIMATE
   *  (undefined = ON, the default: depth refs carry pure motion, zero
   *  identity, so they pass Seedance's real-person filter). */
  depthRef?: boolean;
  /** transfer only — the cached depth conversion of refClip. srcUrl records
   *  WHICH reference it was made from: iterate reuses it, switching the
   *  reference invalidates it. A Library pointer, never base64. */
  depthClip?: { srcUrl: string; url: string; label: string; mode?: string } | null;
  /** transfer only — unsharp the depth pass so faces/hands read (undefined
   *  = ON): the model follows head direction and expression beats better
   *  when they exist in the reference at all. */
  depthDetail?: boolean;
  /** transfer only — lay the reference clip's AUDIO over the finished take
   *  (undefined = ON): the choreography follows the ref 1:1, so its music
   *  lands on beat. Local-only (server ffmpeg); skipped for silent
   *  depth-labeled references. */
  keepAudio?: boolean;
  imgEngine?: string;
  imgPrompt: string;
  imgAttempts: FlowImageAttempt[];
  /** Legacy single-confirm (undefined once confirmedImgIds is written). */
  confirmedImgId?: string | null;
  /** Confirmed looks, in order. Look flows keep exactly one; transfer flows
   *  can confirm several (one identity per person in the reference clip —
   *  they ride as reference_image items in this order). */
  confirmedImgIds?: string[];
  /** Subset of confirmedImgIds sent as TEXT (the prompt that made them)
   *  instead of as a reference_image — the way around Seedance's real-person
   *  filter. Toggled per chip. */
  textLookIds?: string[];
  /** Per-look IDENTITY TEXT overrides — what actually rides in text mode.
   *  A look's generation prompt is usually a photo-composition brief, not
   *  a face description (two dancers converge on one face, verified on the
   *  owner's take); this is the edited/distilled replacement. */
  textOverrides?: Record<string, string>;
  motionPrompt: string;
  motionModelKey: string;
  motionAttempts: FlowMotionAttempt[];
  aspect: AspectRatio;
  duration: number;
  resolution: Resolution;
}

/** Transfer prompt templates come in TWO sets, keyed off the DEPTH REF
 *  toggle — a depth reference carries zero scene/identity, so its prompt
 *  must rebuild the WHOLE world (setting, light, style); a raw clip keeps
 *  its own world, so its prompt only locks camera/wardrobe and directs
 *  acting. The toggle, 🎲 Template and new-flow default all draw from the
 *  ACTIVE set only. */

/** Raw-clip set — distilled from the two-dancer field prompt (2026-07-15):
 *  camera lock + wardrobe hold; the green-screen variant pre-keys footage. */
const TRANSFER_PRESETS_RAW = [
  "Reproduce the reference video's body motion beat-for-beat on the same timeline. The camera stays completely fixed — every framing change comes from the dancer stepping toward or away from the lens; do NOT move, zoom or reframe the camera. The subject is the person from the reference image, outfit and hair held identical in every frame.\nActing: lively natural facial expressions throughout — playful energy, eyes to the lens. (← direct the performance here)\nAvoid: camera drift, face morphing, distorted hands, extra people, text, watermark.",
  "Reproduce the reference video's motion one-to-one. Locked camera — no zoom, pan or pull-back. The subject is the person from the reference image, outfit held identical in every frame. Every pixel around the subject is one flat solid green (#00FF00), a pure 2D color fill edge to edge, as if already keyed out — no green-screen studio set, no floor shadows, no wall-floor seam, no green cast on the subject, crisp silhouette edges.\nActing: confident and playful, eyes to the lens. (← direct the performance here)\nAvoid: camera movement, gradients in the green, reflections, extra people, text, watermark.",
];

/** Depth SCENES — a depth ref carries no world, so the prompt rebuilds
 *  setting AND light as a matched pair (a beach Light on a neon Setting
 *  reads wrong). The SETTING chips on the MOTION step swap these into the
 *  prompt's Setting:/Light: lines in place; 🎲 cycles full templates.
 *  Head rides the opening line ("single-shot {head} dance video"). */
interface DepthScene {
  id: string;
  label: string;
  head: string;
  setting: string;
  light: string;
  /** Card image — starter bakes for built-ins, dataURL for customs. */
  img?: string;
}

const DEPTH_SCENES: DepthScene[] = [
  {
    id: "beach",
    label: "Beach · midday",
    head: "summer beach",
    img: "/starters/beach.jpg",
    // Owner field prompt 2026-07-18 — the proven baseline.
    setting: "bright summer beach at midday — golden sand, rolling turquoise surf, clear blue sky",
    light: "natural bright sunlight, high-key, hard warm key from the sun, sparkling water highlights, soft sand bounce fill. Sun-drenched, never grey",
  },
  {
    id: "neon",
    label: "Neon street · night",
    head: "night street",
    setting: "neon-lit city street at night — wet asphalt reflections, glowing sign bokeh, thin light haze",
    light: "mixed neon key — cool cyan and warm magenta rims, specular street reflections, clean bright exposure on the face. Vivid, never murky",
  },
  {
    id: "studio",
    label: "Studio cyc · clean",
    head: "studio",
    setting: "seamless white cyclorama studio — pure sweep, no props, a faint contact shadow under the feet",
    light: "soft even studio key with gentle top light, shadowless white background, clean commercial exposure",
  },
  {
    id: "rooftop",
    label: "Rooftop · sunset",
    head: "rooftop",
    img: "/starters/rooftop.jpg",
    setting: "open city rooftop at golden hour — low sun over a hazy skyline, warm concrete deck",
    light: "long warm golden-hour key with a soft orange rim, gentle sky fill, glowing lens warmth. Golden, never flat",
  },
  {
    id: "stage",
    label: "Festival stage",
    head: "festival stage",
    setting: "outdoor festival stage at night — truss towers, a glowing LED wall behind, drifting haze",
    light: "punchy stage wash — moving beams, magenta-blue backlight, a bright clean key on the performer",
  },
  {
    id: "gym",
    label: "School gym",
    head: "school gym",
    setting: "empty school gymnasium — polished wood court, painted lines, folded bleachers",
    light: "bright overhead fluorescent banks, soft floor bounce, clean even exposure",
  },
  {
    id: "pool",
    label: "Poolside · noon",
    head: "poolside",
    setting: "resort poolside at noon — turquoise water, white loungers, palm shadows on the deck",
    light: "hard tropical sun with sparkling water caustics, white-deck bounce fill, vivid saturated color",
  },
  {
    id: "subway",
    label: "Subway platform",
    head: "subway platform",
    setting: "quiet late-night subway platform — tiled walls, glossy floor reflections, an empty track behind",
    light: "cool fluorescent strips with a soft cyan cast, glossy floor speculars, a clean bright face exposure",
  },
  // The starter SETTING cards, re-authored as DANCE scenes (open floor, no
  // sitting poses) so their baked photos double as scene cards here.
  {
    id: "bedroom",
    label: "Bedroom",
    head: "bedroom",
    img: "/starters/bedroom.jpg",
    setting: "a lived-in bedroom with warm lamp light, space cleared in front of the bed, soft clutter behind",
    light: "warm practical lamp glow with soft shadows, cozy amber cast, a clean bright exposure on the subject",
  },
  {
    id: "cafe",
    label: "Cafe",
    head: "cafe",
    img: "/starters/cafe.jpg",
    setting: "a cozy daylight cafe, open floor by the window, blurred espresso bar behind",
    light: "soft window daylight, gentle interior fill, airy bright exposure",
  },
  {
    id: "kitchen",
    label: "Kitchen",
    head: "kitchen",
    img: "/starters/kitchen.jpg",
    setting: "a lived-in home kitchen in the morning, open floor by the counter, everyday clutter behind",
    light: "soft morning daylight through the window, warm counter bounce, clean natural exposure",
  },
  {
    id: "desk",
    label: "Home office",
    head: "home office",
    img: "/starters/desk.jpg",
    setting: "a home office in the evening, space cleared beside the desk, faint monitor glow to one side",
    light: "moody practical mix — desk lamp key with a cool monitor rim, clean face exposure",
  },
  {
    id: "dorm",
    label: "Dorm room",
    head: "dorm room",
    img: "/starters/dorm.jpg",
    setting: "a dorm room with fairy lights and posters, open floor in front of the bed",
    light: "soft fairy-light glow with warm practical fill, gentle low-contrast exposure",
  },
  {
    id: "park",
    label: "Sunny park",
    head: "park",
    img: "/starters/park.jpg",
    setting: "a sunny green park lawn, trees and a walking path softly blurred behind",
    light: "bright natural sunlight with soft leaf-dappled fill, fresh vivid color",
  },
  {
    id: "mountain",
    label: "Mountain overlook",
    head: "mountain overlook",
    img: "/starters/mountain.jpg",
    setting: "a scenic mountain overlook, hazy ridgelines rolling behind",
    light: "golden-hour side light with hazy sky fill, warm cinematic glow",
  },
  {
    id: "car",
    label: "Car park",
    head: "parking deck",
    img: "/starters/car.jpg",
    setting: "an empty top-floor parking deck beside a parked car, city haze behind",
    light: "flat open daylight with soft concrete bounce, clean urban exposure",
  },
];

/** Generic light line for user-made custom scenes (they author the setting;
 *  the light stays safe and neutral). */
const CUSTOM_SCENE_LIGHT =
  "natural light true to the setting — clean bright exposure on the subject, never murky";

const depthTemplate = (s: DepthScene): string =>
  `Continuous single-shot ${s.head} dance video. No cuts. No scene transitions.\nMotion: the reference video is a depth-map dance reference — follow its choreography, timing and framing 1:1, matching every pose and beat exactly, including head direction and the timing of expression changes. Camera framing follows the reference video.\nCharacter: the person from the reference image — exactly as the reference, with lively natural facial expressions on the beat.\nSetting: ${s.setting}. (← swap the scene here)\nStyle: photorealistic, true camera texture, crisp high-clarity plate.\nLight: ${s.light}.\nThe subject is already dancing from frame one; hair and clothes react naturally to the motion.\nAvoid: extra people, face morphing, distorted hands, on-screen text, subtitles, watermark.`;

const TRANSFER_PRESETS_DEPTH = DEPTH_SCENES.map(depthTemplate);

/** Swap a scene into an existing depth prompt IN PLACE — only the
 *  Setting:/Light: lines change, every other user edit survives. If those
 *  anchor lines were edited away, rebuild the full template instead. */
const applyDepthScene = (prompt: string, s: DepthScene): string => {
  if (!/^Setting:.*$/m.test(prompt)) return depthTemplate(s);
  let out = prompt
    .replace(/^Setting:.*$/m, `Setting: ${s.setting}. (← swap the scene here)`)
    .replace(/^Light:.*$/m, `Light: ${s.light}.`);
  out = out.replace(
    /^Continuous single-shot .* dance video\./m,
    `Continuous single-shot ${s.head} dance video.`,
  );
  return out;
};

/** Restyle (Lucy v2v) templates — the clip drives; say what changes. */
const RESTYLE_PRESETS = [
  "Transform the dancer into the character described below. Keep the choreography, camera, framing and timing EXACTLY as the source — beat for beat. Keep the original scene and lighting.\nAvoid: face morphing between frames, identity drift, extra people, on-screen text, watermark.",
  "Transform the dancer into the character described below AND move the scene to a bright summer beach at midday — golden sand, rolling surf, clear sky, sun-drenched light. Keep the choreography, camera, framing and timing EXACTLY as the source — beat for beat.\nAvoid: face morphing between frames, identity drift, extra people, on-screen text, watermark.",
];

/** Is the current prompt an untouched template? (Any set — safe to swap
 *  on toggle without eating user edits.) */
const isPresetPrompt = (p: string): boolean =>
  !p.trim() ||
  TRANSFER_PRESETS_RAW.includes(p) ||
  TRANSFER_PRESETS_DEPTH.includes(p) ||
  RESTYLE_PRESETS.includes(p);

/** Pull the wearable out of a FASHION preset's product-shot prompt
 *  ("…product photo of an oversized hoodie, plain neutral…" → the garment). */
const garmentDesc = (p: string): string =>
  p.match(/product photo of (.+?), plain neutral/)?.[1] ?? p.slice(0, 80);

const ASSETS_KEY = "hooklab.customAssets";

/** A user setting card → a dance scene (their text IS the setting line;
 *  the light stays generic-safe). */
const customToScene = (c: {
  id: string;
  label: string;
  prompt?: string;
  image?: string;
}): DepthScene => ({
  id: `c-${c.id}`,
  label: c.label,
  head: c.label.toLowerCase(),
  setting: (c.prompt ?? c.label).trim().replace(/\.+$/, ""),
  light: CUSTOM_SCENE_LIGHT,
  img: c.image,
});

const newFlow = (n: number, sessionId?: string, kind: FlowKind = "look"): Flow => ({
  id: `f${Date.now()}`,
  title:
    kind === "transfer"
      ? `Moves → Image → Motion ${n}`
      : kind === "restyle"
        ? `Video → Image ${n}`
        : `Image → Motion ${n}`,
  createdAt: Date.now(),
  sessionId,
  kind,
  refClip: null,
  // Transfer/restyle identities ride as TEXT, so the card must be a
  // same-family preview — Seedream. Look flows keep Grok (the still IS
  // the i2v input there, any painter works).
  imgEngine: kind === "look" ? "grok" : "seedream",
  imgPrompt: "",
  imgAttempts: [],
  confirmedImgIds: [],
  // Transfer opens with the DEPTH template, restyle with the in-place
  // restyle template — editing a working draft beats a blank box.
  motionPrompt:
    kind === "transfer"
      ? TRANSFER_PRESETS_DEPTH[0]
      : kind === "restyle"
        ? RESTYLE_PRESETS[0]
        : "",
  motionModelKey:
    kind === "transfer" ? "seedance-2" : kind === "restyle" ? "lucy" : "kling",
  motionAttempts: [],
  aspect: "9:16",
  duration: kind === "look" ? 5 : 10,
  resolution: "720p",
});

/** i2v-capable models only — Act-Two needs a driving video, not a still. */
const MOTION_MODELS = MODELS.filter((m) => !m.transferOnly);
/** Models that READ a reference clip (motion+audio). Seedance 2.0 today;
 *  Kling Motion Control slots in here when its adapter lands. */
const TRANSFER_MODELS = MODELS.filter((m) => readsClip(m.key));

const storedPw = (): string | null => {
  try {
    const raw = localStorage.getItem(PW_KEY);
    return raw ? raw.replace(/^"|"$/g, "") : null;
  } catch {
    return null;
  }
};

const splitDataUrl = (d: string): { base64: string; mimeType: string } => {
  const m = d.match(/^data:([^;]+);base64,(.*)$/);
  return m
    ? { mimeType: m[1], base64: m[2] }
    : { mimeType: "image/jpeg", base64: d };
};

/** Turn a raw provider error into something actionable. Seedance's safety
 *  filter blocks photoreal identity images — even AI-generated ones — so
 *  the transfer flow's whole premise (a look as a reference_image) trips it.
 *  Say what's happening and how to get around it. */
const humanizeError = (raw: string, provider?: string): string => {
  // Always keep the provider's exact words so there's no doubt WHICH error
  // this is (a credit/quota error reads nothing like a safety block).
  // Route by provider — a fal balance error wearing "top up ModelArk"
  // clothing sent the owner to the wrong console (2026-07-19).
  if (provider === "lucy") {
    const falVerbatim = ` (fal said: "${raw}")`;
    if (/balance|locked|top up|insufficient|payment|credit|402/i.test(raw)) {
      return (
        "Your fal account is out of credit — fal is pay-as-you-go, but it draws from a PREPAID balance (no balance = locked). Add credit at fal.ai/dashboard/billing, then Retry." +
        falVerbatim
      );
    }
    return raw;
  }
  const verbatim = ` (Seedance said: "${raw}")`;
  if (/real person|may contain real/i.test(raw)) {
    // The filter fires on TWO different inputs — say which one this was.
    if (/input image/i.test(raw)) {
      return (
        "Seedance's safety filter blocked a LOOK image — photoreal identity images trip it even when the depth reference passes (verified live). Switch the look chips to ↳ text (the default), or send a stylized (anime/3DCG) look as the image." +
        verbatim
      );
    }
    return (
      "Seedance's safety filter blocked the REFERENCE video — it reads the driving clip's frames and flags real people in it. Turn DEPTH REF on: the depth pass strips identity and passes. For a raw real-person clip, Kling Motion Control (pose-extracted) or Runway Act-Two is the path." +
      verbatim
    );
  }
  if (/pixel count/i.test(raw)) {
    return (
      "The reference video is too SMALL for Seedance — r2v needs at least 409,600 pixels (e.g. 576×1024). With DEPTH REF on, just Retry: the depth pass now reconverts at the right size automatically. A hand-picked depth clip needs remaking in /depth at 1024px." +
      verbatim
    );
  }
  if (/15\.2|duration.*less than|content\[2\]/i.test(raw)) {
    return (
      "The reference clip is too long — Seedance reads at most 15s. Trim it to a beat above (m:ss) and retry." +
      verbatim
    );
  }
  if (/balance|insufficient|quota|exhausted|402|payment|credit/i.test(raw)) {
    return `Out of Seedance credit — top up the ModelArk balance, then retry.${verbatim}`;
  }
  return raw;
};

/** W×H of a video blob (0 if unreadable) — ModelArk r2v floor checks. */
const probeVideoPx = (b: Blob): Promise<number> =>
  new Promise((res) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const n = v.videoWidth * v.videoHeight;
      URL.revokeObjectURL(v.src);
      res(n);
    };
    v.onerror = () => {
      URL.revokeObjectURL(v.src);
      res(0);
    };
    v.src = URL.createObjectURL(b);
  });

/** ModelArk rejects r2v references under this many pixels (verified live
 *  2026-07-18: "video pixel count … must be ≥ 409600"). */
const R2V_PX_FLOOR = 409_600;

/** Where a flow's soundtrack comes from: a raw reference carries its own;
 *  a depth reference is silent, so its linked original (audioUrl — set by
 *  the /depth handoff or picked in the REF AUDIO row) speaks for it. */
const audioSrcOf = (refClip: Flow["refClip"]): string | null => {
  if (!refClip?.url) return null;
  if (!/^depth\b/i.test(refClip.label)) return refClip.url;
  return refClip.audioUrl ?? null;
};

/** "6:30" → 390, "1:02:05" → 3725, "95.5" → 95.5; "" → null; bad → NaN. */
const parseClock = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p)))
    return NaN;
  if (parts.slice(1).some((p) => Number(p) >= 60)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
};

export function FlowPanel({
  onPreview,
  sessionId,
  sideOpen,
  onDigest,
  onNote,
}: {
  /** Surface an image/video in the studio's shared left frame. */
  onPreview: (p: FlowPreview | null) => void;
  /** Pipeline status one-liner (depth pass → model call → rendering) —
   *  the studio renders it UNDER the shared preview frame (owner call
   *  2026-07-18: that's where eyes are while ANIMATE runs). */
  onNote?: (note: string | null) => void;
  /** Current chat session — flows are scoped to it (legacy flows without
   *  a sessionId stay visible everywhere). */
  sessionId: string | null;
  /** Sessions side-panel open? The floating action bar centers in the space
   *  to the RIGHT of it when so. */
  sideOpen: boolean;
  /** Report this session's flow work (attempt prompts) up to the studio —
   *  the auto-title effect blends it with chat turns to name the session.
   *  Tagged with the session id so a stale report can never mislabel. */
  onDigest: (sessionId: string, msgs: string[]) => void;
}) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busyImg, setBusyImg] = useState(false);
  const [armed, setArmed] = useState<"img" | "motion" | null>(null);
  const [delAsk, setDelAsk] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState(false);
  /** A previous attempt picked as EDIT context ("same look, change only
   *  the outfit") — one-shot, consumed by the next Generate. */
  const [editFrom, setEditFrom] = useState<FlowImageAttempt | null>(null);
  /** Live one-liner for the ANIMATE pipeline (depth pass → model call) —
   *  the user must SEE what's running and what to wait for. */
  const [depthNote, setDepthNote] = useState<string | null>(null);
  /** Transfer IMAGE step: the prompt form hides once the cast has anyone —
   *  this reopens it ("generate with a prompt" path). */
  const [genOpen, setGenOpen] = useState(false);
  /** Which cast slot the outfit strip is open for (null = closed). */
  const [outfitFor, setOutfitFor] = useState<number | null>(null);
  /** Slot index a dress job is running on (busy overlay). */
  const [dressBusy, setDressBusy] = useState<number | null>(null);
  const outfitFileRef = useRef<HTMLInputElement>(null);
  /** User-made scene / outfit cards, read from hooklab.customAssets (this
   *  is the studio tab, so writing through lib/store here is safe). */
  const [customScenes, setCustomScenes] = useState<DepthScene[]>([]);
  const [customFashion, setCustomFashion] = useState<
    { id: string; label: string; image: string }[]
  >([]);
  const [sceneFormOpen, setSceneFormOpen] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [sceneText, setSceneText] = useState("");
  const [sceneImg, setSceneImg] = useState<string | null>(null);
  const sceneFileRef = useRef<HTMLInputElement>(null);
  /* Per-flow ephemera reset on switching flows. */
  useEffect(() => {
    setGenOpen(false);
    setOutfitFor(null);
    setSceneFormOpen(false);
    setRestyleEditing(false);
    setFalPanelHidden(false);
  }, [flowId]);

  const fileRef = useRef<HTMLInputElement>(null);
  /** ＋ New flow opens a kind picker instead of assuming "look". */
  const [newPick, setNewPick] = useState(false);
  /** Library video clips offered as MOVES candidates (transfer flows). */
  const [libClips, setLibClips] = useState<Clip[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const refFileRef = useRef<HTMLInputElement>(null);
  /** Inline MOVES trim (m:ss → m:ss) so an over-15s reference is cut right
   *  here instead of round-tripping to the Library. */
  const [trimFrom, setTrimFrom] = useState("");
  const [trimTo, setTrimTo] = useState("");
  const [trimBusy, setTrimBusy] = useState(false);
  // In-flight guard so a double-click can't fire two takes.
  const firingRef = useRef(false);
  // Legacy hint retained by the ANIMATE handlers below; harmless with the
  // wizard's inline action (the floating bar was removed).
  const [barHidden, setBarHidden] = useState(false);
  // Long motion prompt collapses to a read-only 3-line view after a take is
  // sent; ✎ Edit flips it back to a textarea.
  const [motionEditing, setMotionEditing] = useState(false);
  // Wizard: which step (index into flowSteps) is showing. One stage at a time.
  const [stepIdx, setStepIdx] = useState(0);

  /* flows scoped to the current session (legacy flows show everywhere) */
  const visibleFlows = flows.filter(
    (f) => !f.sessionId || !sessionId || f.sessionId === sessionId,
  );
  /* Selection is DERIVED with a fallback: a stale/null flowId (remount,
   *  session switch, effect-timing gap) falls back to the session's most
   *  recent flow instead of an empty panel — entering a flow-only session
   *  always lands on its work, never on "Start a flow". */
  const flow =
    visibleFlows.find((f) => f.id === flowId) ??
    visibleFlows[visibleFlows.length - 1] ??
    null;

  /* normalize flowId onto the derived selection so tab highlights and every
   *  setFlowId-relative action agree with what's on screen */
  useEffect(() => {
    if (flow && flow.id !== flowId) setFlowId(flow.id);
  }, [flow, flowId]);

  /* No flow in this session at all → make one. Wait for a REAL session id
   *  before auto-creating — creating with "" (studio not yet hydrated)
   *  would orphan the flow into every session. */
  useEffect(() => {
    if (flow || !hydrated || !sessionId) return;
    const f = newFlow(1, sessionId);
    setFlows((fs) => [...fs, f]);
    setFlowId(f.id);
    setEditFrom(null);
  }, [sessionId, flow, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  /* switching sessions must not carry another flow's one-shot edit context */
  useEffect(() => {
    setEditFrom(null);
  }, [sessionId]);

  /* Bind orphan flows to the current session. Flows made by an older build
   *  (no scoping) or before the session id was known carry no sessionId and
   *  used to leak into EVERY session; stamp them onto the active session the
   *  first time we have a real id. Self-limiting — once bound, none remain. */
  useEffect(() => {
    if (!hydrated || !sessionId) return;
    setFlows((fs) =>
      fs.some((f) => !f.sessionId)
        ? fs.map((f) => (f.sessionId ? f : { ...f, sessionId }))
        : fs,
    );
  }, [hydrated, sessionId]);
  const isTransfer = flow?.kind === "transfer";
  /** Lucy v2v — the raw clip drives; the look/prompt says what to become. */
  const isRestyle = flow?.kind === "restyle";

  /** Looks already made elsewhere, offered for reuse in THIS flow's look
   *  stage: every other flow's CONFIRMED still + custom Character cards
   *  (any session — looks are assets, not session state). */
  const sharedLooks = (() => {
    if (!flow) return [];
    // Carry each look's GENERATION PROMPT (cards + flow attempts both keep
    // it) so a reused look can still feed the "↳ text" identity path.
    const out: { image: string; label: string; prompt?: string }[] = [];
    const seen = new Set<string>();
    for (const f of flows) {
      if (f.id === flow.id) continue;
      const ids = f.confirmedImgIds ?? (f.confirmedImgId ? [f.confirmedImgId] : []);
      for (const id of ids) {
        const img = f.imgAttempts.find((a) => a.id === id);
        if (img && !seen.has(img.image)) {
          seen.add(img.image);
          out.push({ image: img.image, label: f.title, prompt: img.prompt });
        }
      }
    }
    try {
      const assets = JSON.parse(store.get("hooklab.customAssets") ?? "{}") as {
        characters?: { label?: string; image?: string; prompt?: string }[];
      };
      for (const c of assets.characters ?? []) {
        if (typeof c.image === "string" && c.image.startsWith("data:image/") && !seen.has(c.image)) {
          seen.add(c.image);
          out.push({
            image: c.image,
            label: c.label ?? "Character card",
            prompt: typeof c.prompt === "string" ? c.prompt : undefined,
          });
        }
      }
    } catch {
      /* no cards */
    }
    return out.slice(0, 8);
  })();

  /** Import a shared look as this flow's confirmed still — it lands in
   *  the attempts strip too, so unconfirm/change works as usual. Re-picking
   *  a look that's already an attempt CONFIRMS the existing one instead of
   *  appending a duplicate thumbnail. */
  const useSharedLook = (look: { image: string; label: string; prompt?: string }) => {
    if (!flow) return;
    const existing = flow.imgAttempts.find((a) => a.image === look.image);
    const id = existing?.id ?? `i${Date.now()}`;
    patchFlow(flow.id, (f) => {
      const cur = f.confirmedImgIds ?? (f.confirmedImgId ? [f.confirmedImgId] : []);
      // Transfer flows ADD the shared look (multi-person); look flows replace.
      const next = isTransfer
        ? cur.includes(id)
          ? cur
          : [...cur, id]
        : [id];
      // Transfer identities default to TEXT (see toggleConfirm).
      const textLookIds =
        isTransfer && !cur.includes(id)
          ? [...new Set([...(f.textLookIds ?? []), id])]
          : f.textLookIds;
      return {
        textLookIds,
        imgAttempts: existing
          ? f.imgAttempts
          : [
              ...f.imgAttempts,
              {
                id,
                // Keep the real generation prompt when we have one (enables
                // ↳ text); fall back to a label marker otherwise.
                prompt: look.prompt?.trim() || `(shared · ${look.label})`,
                image: look.image,
                createdAt: Date.now(),
              },
            ],
        confirmedImgIds: next,
        confirmedImgId: undefined,
      };
    });
    // Auto-distill the identity from the card (owner call: always process).
    const curIds =
      flow.confirmedImgIds ?? (flow.confirmedImgId ? [flow.confirmedImgId] : []);
    if ((isTransfer || isRestyle) && !curIds.includes(id)) {
      autoDescribe(
        existing ?? {
          id,
          prompt: look.prompt?.trim() || `(shared · ${look.label})`,
          image: look.image,
          createdAt: Date.now(),
        },
        flow.id,
      );
    }
    preview({
      kind: "image",
      src: look.image,
      aspect: flow.aspect,
      label: `look · ${look.label}`,
    });
  };
  const motionModel = resolveModel(
    flow?.motionModelKey ?? (isTransfer ? "seedance-2" : "kling"),
  );
  const imgEngine =
    IMG_ENGINES.find((e) => e.key === (flow?.imgEngine ?? "grok")) ??
    IMG_ENGINES[0];
  // Confirmed looks, in order. Migrate the legacy single field on read.
  const confirmedIds =
    flow?.confirmedImgIds ??
    (flow?.confirmedImgId ? [flow.confirmedImgId] : []);
  const confirmedImgs = confirmedIds
    .map((id) => flow?.imgAttempts.find((a) => a.id === id))
    .filter(Boolean) as FlowImageAttempt[];
  const confirmedImg = confirmedImgs[0] ?? null; // first = backward-compat
  // CAST (transfer): slots GROW with each confirmed look — one dancer per
  // look, cap 3 (Seedance's practical multi-subject limit). Beyond 3 the
  // tail benches: front kept, tail cut, non-destructive.
  const activeCast = isTransfer ? confirmedImgs.slice(0, 3) : confirmedImgs;
  const benchedCast = isTransfer ? confirmedImgs.slice(3) : [];
  // The scene currently picked on the MOTION step (derived from the prompt's
  // Setting: line) — the IMAGE step offers to bake it into the look so the
  // identity card is lit for the world it will dance in.
  const activeScene =
    isTransfer && flow?.depthRef !== false
      ? (DEPTH_SCENES.find((s) => flow?.motionPrompt.includes(s.setting)) ?? null)
      : null;
  // Motion is generatable when: look flow has a confirmed still, OR transfer
  // flow has its MOVES clip (the identity look is optional there).
  const canAnimate =
    isTransfer || isRestyle ? Boolean(flow?.refClip) : Boolean(confirmedImg);
  const motionReady = Boolean(flow?.motionPrompt.trim());
  const animateReady = canAnimate && motionReady;
  // Hide the bar while a take is actually rendering (any pending attempt) —
  // there's nothing to fire until it lands.
  const rendering = Boolean(
    flow?.motionAttempts.some((a) => a.status === "pending"),
  );
  /* Pipeline status → the studio (rendered under the shared left frame —
   * that's where eyes are while ANIMATE runs). depthNote covers the
   * depth/upscale/submit phases; a pending attempt keeps a rendering line
   * up until the take lands. */
  const noteLine =
    depthNote ??
    (rendering
      ? `⏳ ${motionModel.short} is rendering — usually 60–180s, the take lands in the flow's history`
      : null);
  useEffect(() => {
    onNote?.(noteLine);
  }, [noteLine, onNote]);
  useEffect(() => () => onNote?.(null), [onNote]);

  // Any edit to a generation input re-shows the bar (it hid after ANIMATE).
  const inputSig = flow
    ? `${flow.motionPrompt}|${confirmedIds.join(",")}|${(flow.textLookIds ?? []).join(",")}|${confirmedIds.map((id) => flow.textOverrides?.[id]?.length ?? 0).join(",")}|${flow.refClip?.url ?? ""}|${flow.depthRef === false ? "raw" : "depth"}|${flow.motionModelKey}|${flow.aspect}|${flow.duration}|${flow.resolution}`
    : "";
  useEffect(() => {
    setBarHidden(false);
  }, [inputSig]);

  // Flows are INDEPENDENT: on switching to a flow, sync the shared left frame
  // to THIS flow's real state — resume its render if a take is pending,
  // else show its latest result / confirmed look / nothing. So a render in
  // one flow doesn't bleed into another, and returning to a rendering flow
  // shows it rendering again (elapsed resumes from the real start).
  useEffect(() => {
    if (!flow) return;
    setMotionEditing(false); // collapse the prompt fresh on each flow
    const pending = flow.motionAttempts.find((a) => a.status === "pending");
    if (pending) {
      preview({
        kind: "busy",
        src: "",
        aspect: pending.aspectRatio,
        label: `${resolveModel(pending.modelKey).short} — rendering motion · usually 60–180s`,
        startedAt: pending.createdAt,
      });
      return;
    }
    const done = flow.motionAttempts.find((a) => a.status === "done" && a.videoUrl);
    if (done?.videoUrl) {
      preview({
        kind: "video",
        src: done.videoUrl,
        aspect: done.aspectRatio,
        label: `${done.modelLabel} · take`,
        compareSrc:
          (flow.kind ?? "look") !== "look" ? flow.refClip?.url : undefined,
        compareLabel: flow.refClip?.label,
      });
    } else if (confirmedImg) {
      preview({ kind: "image", src: confirmedImg.image, aspect: flow.aspect, label: "look" });
    } else {
      preview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.id]);
  const hasTake = Boolean(
    flow?.motionAttempts.some((a) => a.status === "done"),
  );
  // Wizard steps for the current pipeline. `stage` maps each step to its render
  // section; `required` gates advancing past it; `done` drives the ✓ chip.
  const flowSteps: {
    label: string;
    stage: "moves" | "look" | "motion";
    done: boolean;
    required: boolean;
  }[] = flow
    ? isTransfer
      ? [
          { label: "MOVES", stage: "moves", done: Boolean(flow.refClip), required: true },
          { label: "IMAGE", stage: "look", done: confirmedImgs.length > 0, required: false },
          { label: "MOTION", stage: "motion", done: hasTake, required: true },
        ]
      : isRestyle
        ? [
            { label: "VIDEO", stage: "moves", done: Boolean(flow.refClip), required: true },
            { label: "IMAGE", stage: "look", done: hasTake || confirmedImgs.length > 0, required: false },
          ]
        : [
            { label: "STILL", stage: "look", done: Boolean(confirmedImg), required: true },
            { label: "MOTION", stage: "motion", done: hasTake, required: true },
          ]
    : [];
  // Clamp the wizard index and resolve the active stage to render.
  const activeStepIdx = Math.min(
    Math.max(0, stepIdx),
    Math.max(0, flowSteps.length - 1),
  );
  const activeStage = flowSteps[activeStepIdx]?.stage ?? "look";
  // On switching/creating a flow, land on the first unfinished REQUIRED step
  // (or the last step when everything's done, so you're on Motion to iterate).
  useEffect(() => {
    if (!flow) return;
    const todo = flowSteps.findIndex((s) => s.required && !s.done);
    setStepIdx(todo === -1 ? Math.max(0, flowSteps.length - 1) : todo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.id]);

  /** Flip a selected look between IMAGE mode (rides as a reference_image)
   *  and TEXT mode (its generation prompt is sent as the character
   *  description — skips Seedance's real-person filter). The chip STAYS
   *  either way; only how it's sent changes. */
  const toggleLookText = (a: FlowImageAttempt) => {
    if (!flow) return;
    const desc = (flow.textOverrides?.[a.id] ?? a.prompt).trim();
    if (desc.length < 12 || /^\((uploaded|shared)/.test(desc)) {
      setError(
        "This look has no identity text yet — open ✎ identity and use ✨ From card to distill one.",
      );
      return;
    }
    patchFlow(flow.id, (f) => {
      const cur = f.textLookIds ?? [];
      return {
        textLookIds: cur.includes(a.id)
          ? cur.filter((x) => x !== a.id)
          : [...cur, a.id],
      };
    });
  };

  /* ── per-slot outfit swap (face + garment = one set) ── */

  /** Land a dressed card: new attempt, and it REPLACES that dancer's slot
   *  (the set stays one card per person downstream). */
  const applyDressed = (
    slotIdx: number,
    slot: FlowImageAttempt,
    b64: string,
    mime: string,
    outfitLabel: string,
  ) => {
    if (!flow) return;
    const attempt: FlowImageAttempt = {
      id: `i${Date.now()}`,
      prompt: `${slot.prompt.replace(/ · wearing .*$/, "")} · wearing ${outfitLabel}`,
      image: `data:${mime};base64,${b64}`,
      createdAt: Date.now(),
      engine: "gemini",
    };
    patchFlow(flow.id, (f) => {
      const ids = [...(f.confirmedImgIds ?? [])];
      const pos = ids.indexOf(slot.id);
      if (pos >= 0) ids[pos] = attempt.id;
      else ids.push(attempt.id);
      // The dressed card inherits the slot's text/image mode (text is the
      // transfer default — photoreal images trip the filter).
      const textIds = new Set(f.textLookIds ?? []);
      if (textIds.has(slot.id) || pos < 0) {
        textIds.delete(slot.id);
        textIds.add(attempt.id);
      }
      return {
        imgAttempts: [...f.imgAttempts, attempt],
        confirmedImgIds: ids,
        confirmedImgId: undefined,
        textLookIds: [...textIds],
      };
    });
    // The outfit changed — distill a fresh identity for the new card.
    autoDescribe(attempt, flow.id);
    preview({
      kind: "image",
      src: attempt.image,
      aspect: flow.aspect,
      label: `dancer ${slotIdx + 1} · ${outfitLabel}`,
    });
  };

  /** Outfit as an IMAGE (custom card / upload) → /api/dress composites it
   *  onto the slot's person, same face/pose (~$0.04, Gemini image). */
  const dressSlotWithImage = async (slotIdx: number, outfitImg: string, label: string) => {
    const slot = activeCast[slotIdx];
    if (!flow || !slot || dressBusy != null) return;
    setDressBusy(slotIdx);
    setError(null);
    try {
      const r = await fetch("/api/dress", {
        method: "POST",
        headers: headers("GEMINI_API_KEY"),
        body: JSON.stringify({
          character: splitDataUrl(slot.image),
          outfit: splitDataUrl(outfitImg),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Outfit swap failed");
      applyDressed(slotIdx, slot, b.base64, b.mimeType, label);
      setOutfitFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outfit swap failed");
    } finally {
      setDressBusy(null);
    }
  };

  /** Outfit as TEXT (a FASHION preset) → Gemini edit on the slot's card. */
  const dressSlotWithText = async (slotIdx: number, desc: string, label: string) => {
    const slot = activeCast[slotIdx];
    if (!flow || !slot || dressBusy != null) return;
    setDressBusy(slotIdx);
    setError(null);
    try {
      const r = await fetch("/api/image", {
        method: "POST",
        headers: headers("GEMINI_API_KEY"),
        body: JSON.stringify({
          prompt: `Same person — identical face, hair, expression, pose, framing and background — now wearing ${desc}. Photorealistic, natural fabric drape, lighting unchanged.`,
          engine: "gemini",
          aspect: flow.aspect,
          image: splitDataUrl(slot.image),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Outfit swap failed");
      applyDressed(slotIdx, slot, b.base64, b.mimeType, label);
      setOutfitFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outfit swap failed");
    } finally {
      setDressBusy(null);
    }
  };

  /** FAL key status for the restyle step — shown inline, with the same
   *  paste-to-.env.local onboarding as the studio's provider key panel. */
  const [falKey, setFalKey] = useState<{ present: boolean; writable: boolean } | null>(null);
  const [falInput, setFalInput] = useState("");
  const [falSaving, setFalSaving] = useState(false);
  const [falMsg, setFalMsg] = useState("");
  const [falPanelHidden, setFalPanelHidden] = useState(false);
  /** Restyle prompt: collapsed read-only card by default (the template is
   *  complete as-is — owner call); ✎ Edit prompt expands it. */
  const [restyleEditing, setRestyleEditing] = useState(false);
  useEffect(() => {
    if (!isRestyle || falKey) return;
    void (async () => {
      try {
        const pw = storedPw();
        const r = await fetch("/api/keys", {
          headers: pw ? { "x-app-password": pw } : {},
        });
        const b = await r.json();
        setFalKey({
          present: Boolean(b?.keys?.FAL_KEY) || Boolean(localKeyFlags().FAL_KEY),
          writable: Boolean(b?.writable),
        });
      } catch {
        setFalKey({ present: Boolean(localKeyFlags().FAL_KEY), writable: false });
      }
    })();
  }, [isRestyle, falKey]);
  const saveFalKey = async () => {
    const v = falInput.trim();
    if (!v || falSaving) return;
    setFalSaving(true);
    setFalMsg("");
    try {
      if (falKey?.writable) {
        const pw = storedPw();
        const r = await fetch("/api/keys", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(pw ? { "x-app-password": pw } : {}),
          },
          body: JSON.stringify({ envVar: "FAL_KEY", value: v }),
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Could not save the key");
        setFalMsg("Saved to .env.local — ready.");
      } else {
        // Hosted BYOK: the key lives in this browser only and rides each
        // request as a header (lib/client-keys) — never the server.
        setLocalKey("FAL_KEY", v);
        setFalMsg("Saved in this browser — rides each request as a header.");
      }
      setFalInput("");
      setFalKey((k) => (k ? { ...k, present: true } : k));
    } catch (e) {
      setFalMsg(e instanceof Error ? e.message : "Could not save the key");
    } finally {
      setFalSaving(false);
    }
  };

  /** Which MUSIC FROM candidate is playing right now (audition). */
  const [auditionUrl, setAuditionUrl] = useState<string | null>(null);
  /** Identity-text editor: which look id is open + its draft. */
  const [idEditFor, setIdEditFor] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState("");
  const [describeBusy, setDescribeBusy] = useState(false);

  /** Cards currently being auto-described (chip shows ✨). */
  const [describingIds, setDescribingIds] = useState<Set<string>>(new Set());

  /** AUTO identity distillation — fires on every transfer confirm (owner
   *  call: always process, no manual step): Gemini reads the CARD and the
   *  face-first description becomes the text that rides. Never clobbers a
   *  user-edited override; failures just leave the old prompt riding. */
  const autoDescribe = (a: FlowImageAttempt, flowId: string) => {
    if (flows.find((f) => f.id === flowId)?.textOverrides?.[a.id]) return;
    setDescribingIds((s) => new Set(s).add(a.id));
    void (async () => {
      try {
        const r = await fetch("/api/describe", {
          method: "POST",
          headers: headers("GEMINI_API_KEY"),
          body: JSON.stringify({ image: splitDataUrl(a.image) }),
        });
        const b = await r.json();
        if (r.ok && typeof b.text === "string" && b.text) {
          patchFlow(flowId, (f) =>
            f.textOverrides?.[a.id]
              ? {}
              : { textOverrides: { ...(f.textOverrides ?? {}), [a.id]: b.text } },
          );
        }
      } catch {
        /* the raw prompt rides, as before */
      } finally {
        setDescribingIds((s) => {
          const n = new Set(s);
          n.delete(a.id);
          return n;
        });
      }
    })();
  };

  /** ✨ From card — Gemini describes the CARD image (face-first), the
   *  closest text to what the user actually picked (~free). */
  const describeCard = async (a: FlowImageAttempt) => {
    if (describeBusy) return;
    setDescribeBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/describe", {
        method: "POST",
        headers: headers("GEMINI_API_KEY"),
        body: JSON.stringify({ image: splitDataUrl(a.image) }),
      });
      const b = await r.json();
      if (!r.ok || typeof b.text !== "string") {
        throw new Error(b.error ?? "describe failed");
      }
      setIdDraft(b.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Describe failed");
    } finally {
      setDescribeBusy(false);
    }
  };
  /** Media-src auth — <video>/<audio> can't send headers, so the password
   *  rides as ?pw= (the app's existing URL convention for the owner's own
   *  secret). */
  const withPw = (url: string): string => {
    const pw = storedPw();
    return pw
      ? `${url}${url.includes("?") ? "&" : "?"}pw=${encodeURIComponent(pw)}`
      : url;
  };

  /** Retro-mux: lay the reference soundtrack over an ALREADY-finished take
   *  (takes rendered before the audio source was known/linked). The muxed
   *  file replaces the take + its Library entry. */
  const [muxBusyId, setMuxBusyId] = useState<string | null>(null);
  const muxTake = async (a: FlowMotionAttempt) => {
    if (!flow || muxBusyId || !a.videoUrl || !isLocalVideoUrl(a.videoUrl)) return;
    const audioSrc = audioSrcOf(flow.refClip);
    if (!audioSrc) return;
    setMuxBusyId(a.id);
    setError(null);
    try {
      const pw = storedPw();
      const mr = await fetch("/api/grab", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(pw ? { "x-app-password": pw } : {}),
        },
        body: JSON.stringify({ action: "mux-audio", video: a.videoUrl, audio: audioSrc }),
      });
      const mb = await mr.json();
      if (!mr.ok || typeof mb.url !== "string") {
        throw new Error(mb.error ?? "audio mux failed");
      }
      patchAttempt(flow.id, a.id, { videoUrl: mb.url });
      try {
        const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
        const hit = gallery.find((c) => c.jobId === a.jobId);
        if (hit) {
          hit.videoUrl = mb.url;
          store.set(GALLERY_KEY, JSON.stringify(gallery));
        }
      } catch {
        /* library share is best-effort */
      }
      preview({
        kind: "video",
        src: mb.url,
        aspect: a.aspectRatio,
        label: `${a.modelLabel} · take ♪`,
        compareSrc: flow.refClip?.url,
        compareLabel: flow.refClip?.label,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio mux failed");
    } finally {
      setMuxBusyId(null);
    }
  };

  /** Save a user scene card into hooklab.customAssets.settings (this tab
   *  owns the store cache — safe) and surface it in the carousel. */
  const saveCustomScene = () => {
    if (!sceneName.trim() || (!sceneText.trim() && !sceneImg)) return;
    try {
      const cur = JSON.parse(store.get(ASSETS_KEY) ?? "{}");
      const entry = {
        id: `cs${Date.now()}`,
        label: sceneName.trim().slice(0, 40),
        prompt: sceneText.trim() || sceneName.trim(),
        image: sceneImg ?? undefined,
      };
      store.set(
        ASSETS_KEY,
        JSON.stringify({
          characters: Array.isArray(cur.characters) ? cur.characters : [],
          settings: [...(Array.isArray(cur.settings) ? cur.settings : []), entry],
          fashion: Array.isArray(cur.fashion) ? cur.fashion : [],
        }),
      );
      setCustomScenes((cs) => [...cs, customToScene(entry)]);
      if (flow) {
        patchFlow(flow.id, {
          motionPrompt: applyDepthScene(flow.motionPrompt, customToScene(entry)),
        });
      }
      setSceneFormOpen(false);
      setSceneName("");
      setSceneText("");
      setSceneImg(null);
    } catch {
      setError("Couldn't save the scene");
    }
  };

  /** Click a thumbnail: look flows single-select; transfer flows toggle
   *  membership (one identity per person in the reference clip). */
  const toggleConfirm = (id: string) => {
    if (!flow) return;
    const cur =
      flow.confirmedImgIds ?? (flow.confirmedImgId ? [flow.confirmedImgId] : []);
    const adding = isTransfer && !cur.includes(id);
    const next = isTransfer
      ? cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id]
      : cur.length === 1 && cur[0] === id
        ? []
        : [id];
    patchFlow(flow.id, (f) => ({
      confirmedImgIds: next,
      confirmedImgId: undefined,
      // Transfer identities default to TEXT — photoreal reference_images
      // trip Seedance's filter even beside a depth video (verified live
      // 2026-07-18). The ↳ chip flips back for stylized looks.
      textLookIds: adding
        ? [...new Set([...(f.textLookIds ?? []), id])]
        : f.textLookIds,
    }));
    // A confirm fills a slot — collapse the prompt form back down, and
    // distill the identity text from the card automatically. Restyle's
    // single-select confirms distill too (the identity rides the prompt).
    if (adding || (isRestyle && !cur.includes(id) && next.includes(id))) {
      setGenOpen(false);
      const a = flow.imgAttempts.find((x) => x.id === id);
      if (a) autoDescribe(a, flow.id);
    }
    const shown = flow.imgAttempts.find(
      (a) => a.id === (next[next.length - 1] ?? id),
    );
    if (shown) {
      preview({
        kind: "image",
        src: shown.image,
        aspect: flow.aspect,
        label: "look",
      });
    }
  };
  const effSecs = flow
    ? effectiveSeconds(motionModel.provider, flow.duration, flow.resolution)
    : 5;
  const motionCost = flow
    ? estimateModelCost(motionModel, flow.resolution, flow.duration)
    : null;

  /** Password + the hosted pass-through provider key (lib/client-keys) —
   *  which envVar rides depends on what the request actually spends. */
  const headers = useCallback(
    (envVar?: string | null): Record<string, string> => {
      const pw = storedPw();
      return keyHeader(envVar, {
        "content-type": "application/json",
        ...(pw ? { "x-app-password": pw } : {}),
      });
    },
    [],
  );

  /* hydrate flows from the shared store */
  useEffect(() => {
    void (async () => {
      await store.hydrate();
      try {
        const list = JSON.parse(store.get(FLOWS_KEY) ?? "[]") as Flow[];
        if (Array.isArray(list) && list.length) {
          const migrated = list.map((f) => {
            // Legacy tabs said "Flow N" — rename to the pipeline they are.
            const title = /^Flow \d+$/.test(f.title)
              ? f.title.replace(/^Flow /, "Image → Motion ")
              : f.title;
            // Collapse duplicate attempt thumbnails (same image imported
            // several times by the pre-0.6.3 shared-look bug), keeping the
            // first id; repoint confirmations onto the survivor.
            const byImage = new Map<string, string>(); // image → surviving id
            const remap = new Map<string, string>(); // old id → surviving id
            const attempts: FlowImageAttempt[] = [];
            for (const a of f.imgAttempts) {
              const keep = byImage.get(a.image);
              if (keep) {
                remap.set(a.id, keep);
              } else {
                byImage.set(a.image, a.id);
                attempts.push(a);
              }
            }
            const legacyIds =
              f.confirmedImgIds ?? (f.confirmedImgId ? [f.confirmedImgId] : []);
            const confirmedImgIds = [
              ...new Set(legacyIds.map((id) => remap.get(id) ?? id)),
            ];
            return { ...f, title, imgAttempts: attempts, confirmedImgIds, confirmedImgId: undefined };
          });
          setFlows(migrated);
          setFlowId(migrated[migrated.length - 1].id);
        } else {
          const f = newFlow(1, sessionId || undefined);
          setFlows([f]);
          setFlowId(f.id);
        }
      } catch {
        const f = newFlow(1, sessionId || undefined);
        setFlows([f]);
        setFlowId(f.id);
      }
      // MOVES candidates: any Library entry with a playable video —
      // GRABbed references first (that's what they're FOR), then takes.
      try {
        const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
        setLibClips(
          gallery
            .filter((c) => c.videoUrl)
            .sort((a, b) =>
              a.provider === "grab" === (b.provider === "grab")
                ? b.createdAt - a.createdAt
                : a.provider === "grab"
                  ? -1
                  : 1,
            ),
        );
      } catch {
        /* empty library */
      }
      // Custom scene/outfit cards (shared with the chat starters).
      try {
        const assets = JSON.parse(store.get(ASSETS_KEY) ?? "{}") as {
          settings?: { id: string; label: string; prompt?: string; image?: string }[];
          fashion?: { id: string; label: string; image?: string }[];
        };
        setCustomScenes(
          (assets.settings ?? [])
            .filter((s) => s?.id && s.label)
            .map(customToScene),
        );
        setCustomFashion(
          (assets.fashion ?? []).filter(
            (f): f is { id: string; label: string; image: string } =>
              Boolean(f?.id && f.label && f.image),
          ),
        );
      } catch {
        /* no custom assets */
      }
      setHydrated(true);
    })();
  }, []);

  /* persist */
  useEffect(() => {
    if (!hydrated) return;
    store.set(FLOWS_KEY, JSON.stringify(flows));
  }, [flows, hydrated]);

  /* Adopt a depth clip parked by the /depth tool (plain localStorage — the
   * tool tab must never write the store, its full-cache flush would clobber
   * ours). THIS tab owns the cache, so the Library entry is written here;
   * if the pointer names one of our transfer flows, it becomes that flow's
   * MOVES reference directly. Runs on mount + every window focus (the tool
   * lives in another tab, so focus is exactly the "I'm back" moment). */
  useEffect(() => {
    if (!hydrated) return;
    const adopt = () => {
      try {
        const raw = localStorage.getItem(PENDING_DEPTH_KEY);
        if (!raw) return;
        localStorage.removeItem(PENDING_DEPTH_KEY);
        const p = JSON.parse(raw) as {
          jobId?: string;
          url?: string;
          label?: string;
          flowId?: string | null;
          audioUrl?: string;
          aspect?: AspectRatio;
          durationSeconds?: number;
        };
        if (!p?.jobId || !p.url) return;
        const label = p.label ?? "depth reference";
        const clip: Clip = {
          jobId: p.jobId,
          sessionId: sessionId || undefined,
          provider: "grab",
          prompt: label,
          note: `Reference · ${label}`,
          variantLabel: "Depth ref",
          createdAt: Date.now(),
          status: "done",
          aspectRatio: p.aspect ?? "9:16",
          durationSeconds: p.durationSeconds ?? 0,
          resolution: "720p",
          videoUrl: p.url,
          costUsd: 0,
        };
        try {
          const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
          if (!gallery.some((c) => c.jobId === clip.jobId)) {
            store.set(GALLERY_KEY, JSON.stringify([clip, ...gallery]));
          }
        } catch {
          /* library share is best-effort */
        }
        setLibClips((cs) =>
          cs.some((c) => c.jobId === clip.jobId) ? cs : [clip, ...cs],
        );
        if (p.flowId) {
          setFlows((fs) =>
            fs.map((f) =>
              f.id === p.flowId && f.kind === "transfer"
                ? {
                    ...f,
                    refClip: {
                      url: p.url!,
                      label: label.slice(0, 60),
                      // The original's url — the depth clip's soundtrack.
                      audioUrl: p.audioUrl,
                    },
                  }
                : f,
            ),
          );
        }
      } catch {
        /* a malformed pointer is not worth a fault */
      }
    };
    adopt();
    window.addEventListener("focus", adopt);
    return () => window.removeEventListener("focus", adopt);
  }, [hydrated, sessionId]);

  /* Tell the studio what work happened in this session's flows — attempt
   *  prompts only (typing alone doesn't count as work), oldest first, so
   *  auto-title can name a flow-only session and blend chat + flow. */
  useEffect(() => {
    if (!hydrated) return;
    const msgs: string[] = [];
    for (const f of visibleFlows) {
      for (const a of f.imgAttempts) {
        const p = a.prompt.trim();
        // "(uploaded …)" / "(shared …)" placeholders describe nothing
        if (p && !p.startsWith("(")) msgs.push(`[look] ${p}`);
      }
      // motionAttempts are stored newest-first — restore chronology
      for (const a of [...f.motionAttempts].reverse()) {
        const p = a.prompt.trim();
        if (p) msgs.push(`[motion] ${p}`);
      }
    }
    onDigest(sessionId ?? "", msgs);
  }, [flows, sessionId, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A fresh look renders at the LEFT end of the pick carousel (newest
   *  first) — scroll it into view when one lands, so it's never hidden
   *  off the far edge. */
  const thumbsRef = useRef<HTMLDivElement>(null);
  const lastImgCount = useRef<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!flow) return;
    const prev = lastImgCount.current;
    if (prev && prev.id === flow.id && flow.imgAttempts.length > prev.n) {
      thumbsRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    }
    lastImgCount.current = { id: flow.id, n: flow.imgAttempts.length };
  }, [flow]);

  const patchFlow = useCallback(
    (id: string, p: Partial<Flow> | ((f: Flow) => Partial<Flow>)) => {
      setFlows((fs) =>
        fs.map((f) =>
          f.id === id ? { ...f, ...(typeof p === "function" ? p(f) : p) } : f,
        ),
      );
    },
    [],
  );

  const patchAttempt = useCallback(
    (fid: string, aid: string, p: Partial<FlowMotionAttempt>) => {
      setFlows((fs) =>
        fs.map((f) =>
          f.id === fid
            ? {
                ...f,
                motionAttempts: f.motionAttempts.map((a) =>
                  a.id === aid ? { ...a, ...p } : a,
                ),
              }
            : f,
        ),
      );
    },
    [],
  );

  /** onPreview wrapper that remembers the last REAL preview, so a failed
   *  job can put the frame back instead of leaving a stuck busy screen. */
  const lastShown = useRef<FlowPreview | null>(null);
  const preview = useCallback(
    (p: FlowPreview | null) => {
      if (!p || p.kind !== "busy") lastShown.current = p;
      onPreview(p);
    },
    [onPreview],
  );

  /* ── stage 1: still generation ─────────────────── */

  const generateImage = async () => {
    if (!flow || !flow.imgPrompt.trim() || busyImg) return;
    setArmed(null);
    setBusyImg(true);
    preview({
      kind: "busy",
      src: "",
      aspect: flow.aspect,
      label: `${imgEngine.label} — generating a still · usually ~10s`,
      startedAt: Date.now(),
    });
    setError(null);
    try {
      const r = await fetch("/api/image", {
        method: "POST",
        // Edits route through Gemini image server-side regardless of engine.
        headers: headers(
          editFrom
            ? "GEMINI_API_KEY"
            : imgEngine.key === "gpt"
              ? "OPENAI_API_KEY"
              : imgEngine.key === "gemini"
                ? "GEMINI_API_KEY"
                : "XAI_API_KEY",
        ),
        body: JSON.stringify({
          prompt: flow.imgPrompt,
          engine: imgEngine.key,
          aspect: flow.aspect,
          // EDIT mode: the picked attempt rides as reference (server
          // routes edits through Gemini image regardless of engine)
          image: editFrom ? splitDataUrl(editFrom.image) : undefined,
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        setError(b.error ?? "Image generation failed");
        preview(lastShown.current); // un-stick the busy frame
        return;
      }
      const attempt: FlowImageAttempt = {
        id: `i${Date.now()}`,
        prompt: flow.imgPrompt,
        image: `data:${b.mimeType};base64,${b.base64}`,
        createdAt: Date.now(),
        engine: editFrom ? "gemini" : imgEngine.key,
      };
      patchFlow(flow.id, (f) => ({
        imgAttempts: [...f.imgAttempts, attempt],
      }));
      setEditFrom(null); // one-shot, like chat attachments
      preview({
        kind: "image",
        src: attempt.image,
        aspect: flow.aspect,
        label: `${imgEngine.label} · draft`,
      });
    } catch {
      setError("Network error — try again");
      preview(lastShown.current);
    } finally {
      setBusyImg(false);
    }
  };

  const uploadImage = (file: File) => {
    if (!flow) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl.startsWith("data:image/")) return;
      const attempt: FlowImageAttempt = {
        id: `i${Date.now()}`,
        prompt: "(uploaded)",
        image: dataUrl,
        createdAt: Date.now(),
      };
      patchFlow(flow.id, (f) => ({ imgAttempts: [...f.imgAttempts, attempt] }));
      preview({
        kind: "image",
        src: dataUrl,
        aspect: flow.aspect,
        label: "uploaded still",
      });
    };
    reader.readAsDataURL(file);
  };

  const saveAsCard = () => {
    if (!flow || !confirmedImg) return;
    try {
      const cur = JSON.parse(store.get("hooklab.customAssets") ?? "{}") as {
        characters?: unknown[];
        settings?: unknown[];
        fashion?: unknown[];
      };
      const characters = Array.isArray(cur.characters)
        ? (cur.characters as Record<string, unknown>[])
        : [];
      // Never overwrite an existing card — bump a numeric suffix instead
      // ("Flow 1", "Flow 1 · 2", "Flow 1 · 3", …).
      const base = flow.title.slice(0, 20);
      const taken = new Set(characters.map((c) => c.label));
      let label = base;
      for (let n = 2; taken.has(label); n++) label = `${base} · ${n}`;
      characters.push({
        id: `flow-${confirmedImg.id}-${Date.now()}`,
        label,
        desc: "FROM FLOW",
        prompt: confirmedImg.prompt,
        image: confirmedImg.image,
      });
      store.set(
        "hooklab.customAssets",
        JSON.stringify({
          characters,
          settings: Array.isArray(cur.settings) ? cur.settings : [],
          fashion: Array.isArray(cur.fashion) ? cur.fashion : [],
        }),
      );
      setSavedCard(true);
      setTimeout(() => setSavedCard(false), 2500);
    } catch {
      setError("Couldn't save the card");
    }
  };

  /** Upload a local video into the clip vault → a real Library entry →
   *  set it as this transfer flow's MOVES reference. */
  const uploadRefClip = async (file: File) => {
    if (!flow || uploadBusy) return;
    setUploadBusy(true);
    setError(null);
    try {
      const pw = storedPw();
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: pw ? { "x-app-password": pw } : {},
        body: fd,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Upload failed");
      const clip: Clip = {
        jobId: b.name,
        sessionId: sessionId || undefined,
        provider: "grab",
        prompt: file.name,
        note: `Reference · uploaded · ${file.name}`,
        variantLabel: "Reference",
        createdAt: Date.now(),
        status: "done",
        aspectRatio: flow.aspect,
        durationSeconds: 0,
        resolution: flow.resolution,
        videoUrl: b.url,
        costUsd: 0,
      };
      try {
        const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
        store.set(GALLERY_KEY, JSON.stringify([clip, ...gallery]));
      } catch {
        /* library share is best-effort */
      }
      setLibClips((cs) => [clip, ...cs]);
      patchFlow(flow.id, { refClip: { url: b.url, label: file.name } });
      preview({ kind: "video", src: b.url, aspect: flow.aspect, label: "MOVES reference" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  };

  /** Trim the selected MOVES clip in place (server ffmpeg) → a new short
   *  Library clip, set as the reference. */
  const trimRefClip = async () => {
    if (!flow?.refClip || trimBusy) return;
    const start = parseClock(trimFrom);
    const end = parseClock(trimTo);
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
      setError("Trim needs a start and end — m:ss like 0:05 → 0:18 (or seconds).");
      return;
    }
    if (end <= start) {
      setError("Trim end must be after the start.");
      return;
    }
    if (end - start > 15.2) {
      setError(`That's ${Math.round(end - start)}s — keep the trim ≤15s (Seedance's reference cap).`);
      return;
    }
    setTrimBusy(true);
    setError(null);
    try {
      const pw = storedPw();
      const r = await fetch("/api/grab", {
        method: "POST",
        headers: { "content-type": "application/json", ...(pw ? { "x-app-password": pw } : {}) },
        body: JSON.stringify({ action: "trim-local", src: flow.refClip.url, start, end }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Trim failed");
      const label = `${flow.refClip.label.replace(/ · .*$/, "")} · ${trimFrom}–${trimTo}`;
      const clip: Clip = {
        jobId: b.name,
        sessionId: sessionId || undefined,
        provider: "grab",
        prompt: label,
        note: `Reference · trimmed · ${label}`,
        variantLabel: "Reference",
        createdAt: Date.now(),
        status: "done",
        aspectRatio: flow.aspect,
        durationSeconds: Math.round(end - start),
        resolution: flow.resolution,
        videoUrl: b.url,
        costUsd: 0,
      };
      try {
        const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
        store.set(GALLERY_KEY, JSON.stringify([clip, ...gallery]));
      } catch {
        /* library share is best-effort */
      }
      setLibClips((cs) => [clip, ...cs]);
      patchFlow(flow.id, { refClip: { url: b.url, label } });
      setTrimFrom("");
      setTrimTo("");
      preview({ kind: "video", src: b.url, aspect: flow.aspect, label: "MOVES reference (trimmed)" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trim failed");
    } finally {
      setTrimBusy(false);
    }
  };

  /* ── stage 2: motion generation (i2v on the confirmed still) ── */

  const generateMotion = async () => {
    if (!flow || !flow.motionPrompt.trim()) return;
    // Look flows need a confirmed still (it IS the i2v input). Transfer flows
    // need the MOVES clip; the identity look is OPTIONAL — describing a
    // fictional character in the prompt (no image) sidesteps Seedance's
    // real-person filter entirely (motion from the depth clip, identity from
    // text).
    if (flow.kind === "transfer" ? !flow.refClip : !confirmedImg) return;
    // In-flight lock: the bar only hides after the request resolves, so a
    // second click in that window would fire a duplicate take. Guard it.
    if (firingRef.current) return;
    firingRef.current = true;
    setBarHidden(true); // hide immediately, don't wait for the network
    setArmed(null);
    setError(null);
    // Jump to the top so the rendering preview (left frame) is in view.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    const m = resolveModel(flow.motionModelKey);
    // i2v (look flow) sends the confirmed still as the image. Transfer splits
    // each confirmed look by its chip mode: IMAGE looks ride as
    // reference_image; TEXT looks contribute their prompt to the character
    // description (prepended below) — the real-person-filter workaround.
    const stillImage = confirmedImg ? splitDataUrl(confirmedImg.image) : undefined;
    const textIds = new Set(flow.textLookIds ?? []);
    // Only the ACTIVE cast rides (first castCount confirms, in order) —
    // benched looks are kept in state but never sent.
    const imageLooks = activeCast.filter((a) => !textIds.has(a.id));
    const refImages = imageLooks.map((a) => splitDataUrl(a.image));
    const textChars = activeCast
      .filter((a) => textIds.has(a.id))
      .map((a) =>
        (
          flow.textOverrides?.[a.id] ??
          // "(uploaded …)" / "(shared …)" markers are not identities —
          // ride nothing until the auto-describe lands.
          (/^\((uploaded|shared)/.test(a.prompt.trim()) ? "" : a.prompt)
        ).trim(),
      )
      .filter(Boolean);

    // Transfer flows carry the MOVES clip as a Library pointer — fetch and
    // encode it now (same-origin, password header as query param not needed
    // for fetch()).
    let drivingVideo: { base64: string; mimeType: string } | undefined;
    if ((flow.kind === "transfer" || flow.kind === "restyle") && flow.refClip) {
      preview({
        kind: "busy",
        src: "",
        aspect: flow.aspect,
        label: "loading the MOVES reference…",
        startedAt: Date.now(),
      });
      try {
        const pw = storedPw();
        const r = await fetch(flow.refClip.url, {
          headers: pw ? { "x-app-password": pw } : {},
        });
        if (!r.ok) throw new Error();
        const blob = await r.blob();
        // ModelArk r2v hard-caps the reference video at 15.2s (verified
        // live 2026-07-15: content[2] rejection) — catch it before the
        // upload instead of after.
        const dur = await new Promise<number>((res) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () => {
            URL.revokeObjectURL(v.src);
            res(v.duration);
          };
          v.onerror = () => {
            URL.revokeObjectURL(v.src);
            res(0);
          };
          v.src = URL.createObjectURL(blob);
        });
        if (flow.kind === "transfer" && dur > 15.2) {
          setError(
            `The MOVES reference is ${Math.round(dur)}s — Seedance reads at most 15s of reference. Trim the beat you want with GRAB (Library ⤓, m:ss trim like 0:05 → 0:18) and pick the trimmed clip here.`,
          );
          preview(lastShown.current);
          firingRef.current = false;
          setBarHidden(false);
          return;
        }
        /* ── DEPTH PASS (default ON) — convert the reference to a depth
           video before the render: pure motion, zero identity, passes
           Seedance's real-person filter. Cached per reference (depthClip),
           so iterating motion never reconverts; switching the reference
           invalidates the cache. Skipped when the picked clip is already
           a depth conversion or the toggle is off. ── */
        let sendBlob = blob;
        let sendMime = "video/mp4";
        const wantDepth =
          flow.depthRef !== false && !/^depth\b/i.test(flow.refClip.label);
        // "adaptive-*" invalidates pre-adaptive caches once (the algorithm
        // changed under the same detail knob).
        const depthMode = flow.depthDetail !== false ? "adaptive-1.2" : "plain";
        if (flow.kind === "transfer" && wantDepth) {
          let reused = false;
          if (
            flow.depthClip &&
            flow.depthClip.srcUrl === flow.refClip.url &&
            (flow.depthClip.mode ?? "plain") === depthMode
          ) {
            const dr = await fetch(flow.depthClip.url, {
              headers: pw ? { "x-app-password": pw } : {},
            }).catch(() => null);
            if (dr?.ok) {
              const cached = await dr.blob();
              // A depth pass converted before the floor was known (432×768
              // era) must be REMADE at full quality, not reused.
              const px = await probeVideoPx(cached);
              if (px >= R2V_PX_FLOOR) {
                sendBlob = cached;
                sendMime = cached.type || "video/mp4";
                reused = true;
                setDepthNote("⬗ depth pass already cached for this reference — reusing it, no reconvert");
              } else {
                setDepthNote("⬗ cached depth pass is below Seedance's size floor — reconverting at a higher resolution…");
              }
            }
            // vault cleared / too small → fall through and reconvert
          }
          if (!reused) {
            try {
              setDepthNote(
                "⬗ DEPTH PASS running — converting the reference to pure motion in this browser ($0)…",
              );
              const { extractDepthVideo } = await import("@/lib/depth-extract");
              let depthPct = 0;
              let lastFramePush = 0;
              const res = await extractDepthVideo(blob, {
                // ModelArk r2v rejects references under 409,600 px — aim
                // comfortably above (576×1024 for 9:16).
                maxSide: 1024,
                minPixels: 480_000,
                // +EXPRESSION (default): local-contrast boost so faces and
                // hands survive the depth flattening.
                detail: flow.depthDetail !== false ? 1.2 : 0,
                onProgress: (p) => {
                  depthPct = p.pct;
                  setDepthNote(
                    `⬗ DEPTH PASS ${p.pct}% — ${p.note} · then ${m.short} gets called`,
                  );
                },
                // Live depth frames in the shared OUTPUT frame — the user
                // SEES the depth pass running before the render submits.
                onFrame: (canvas) => {
                  const now = Date.now();
                  if (now - lastFramePush < 400) return;
                  lastFramePush = now;
                  preview({
                    kind: "image",
                    src: canvas.toDataURL("image/jpeg", 0.7),
                    aspect: flow.aspect,
                    label: `DEPTH PASS · ${depthPct}% — extracting motion, identity stays out`,
                  });
                },
              });
              if (!res.blob) throw new Error("depth pass returned nothing");
              sendBlob = res.blob;
              sendMime = `video/${res.container}`;
              // Vault + Library + cache — best-effort: if the vault is
              // unavailable (hosted), the in-memory depth still rides this
              // render; it just can't be reused next take.
              try {
                const fd = new FormData();
                fd.append(
                  "file",
                  new File([res.blob], `depth.${res.container}`, { type: sendMime }),
                );
                const vr = await fetch("/api/clips", {
                  method: "POST",
                  headers: pw ? { "x-app-password": pw } : {},
                  body: fd,
                });
                const vb = await vr.json();
                if (vr.ok) {
                  const label = `depth · ${flow.refClip.label.replace(/ · .*$/, "").slice(0, 48)}`;
                  const clip: Clip = {
                    jobId: vb.name,
                    sessionId: sessionId || undefined,
                    provider: "grab",
                    prompt: label,
                    note: `Reference · ${label}`,
                    variantLabel: "Depth ref",
                    createdAt: Date.now(),
                    status: "done",
                    aspectRatio: flow.aspect,
                    durationSeconds: Math.round(dur),
                    resolution: flow.resolution,
                    videoUrl: vb.url,
                    costUsd: 0,
                  };
                  try {
                    const gallery = JSON.parse(store.get(GALLERY_KEY) ?? "[]") as Clip[];
                    store.set(GALLERY_KEY, JSON.stringify([clip, ...gallery]));
                  } catch {
                    /* library share is best-effort */
                  }
                  setLibClips((cs) => [clip, ...cs]);
                  patchFlow(flow.id, {
                    depthClip: {
                      srcUrl: flow.refClip.url,
                      url: vb.url,
                      label,
                      mode: depthMode,
                    },
                  });
                }
              } catch {
                /* vault unavailable — proceed with the in-memory depth */
              }
            } catch (e) {
              setDepthNote(null);
              setError(
                `The depth pass failed — ${e instanceof Error ? e.message : "processing error"}. ` +
                  "Retry, or switch DEPTH REF off on this step to send the raw clip as-is.",
              );
              preview(lastShown.current);
              firingRef.current = false;
              setBarHidden(false);
              return;
            }
          }
        }
        // UNIVERSAL floor guard — whatever is about to ride (fresh depth,
        // cached depth, a hand-picked "depth · …" Library clip, a raw
        // clip with DEPTH REF off) must clear ModelArk's r2v pixel floor.
        // Below it: a fast pure-resize re-encode (no AI). This is what
        // catches the already-depth reference the depth pass skips.
        // (ModelArk-specific — Lucy restyle skips it.)
        try {
          const px =
            flow.kind === "transfer" ? await probeVideoPx(sendBlob) : 0;
          if (px > 0 && px < R2V_PX_FLOOR) {
            setDepthNote("⤢ reference is under Seedance's size floor — upscaling (no AI, just a resize)…");
            const { resizeVideoToFloor } = await import("@/lib/depth-extract");
            const up = await resizeVideoToFloor(sendBlob, 480_000, 30, (p) =>
              setDepthNote(`⤢ upscaling ${p.pct}% — ${p.note} · then ${m.short} gets called`),
            );
            sendBlob = up.blob;
            sendMime = `video/${up.container}`;
          }
        } catch (e) {
          setDepthNote(null);
          setError(
            `Couldn't upscale the reference to Seedance's minimum size — ${e instanceof Error ? e.message : "resize error"}.`,
          );
          preview(lastShown.current);
          firingRef.current = false;
          setBarHidden(false);
          return;
        }
        const b64 = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
          fr.onerror = rej;
          fr.readAsDataURL(sendBlob);
        });
        drivingVideo = { base64: b64, mimeType: sendMime };
      } catch {
        setDepthNote(null);
        setError(
          "Couldn't load the MOVES reference — the saved file may have been cleared. Pick or upload it again.",
        );
        preview(lastShown.current);
        firingRef.current = false;
        setBarHidden(false);
        return;
      }
    }
    if (flow.kind === "transfer" || flow.kind === "restyle") {
      setDepthNote(
        `✓ ${flow.kind === "restyle" ? "clip" : "reference"} ready → calling ${m.short} now — the render usually takes 60–180s, hang tight`,
      );
    }
    preview({
      kind: "busy",
      src: "",
      aspect: flow.aspect,
      label: `${m.short} — rendering motion · usually 60–180s`,
      startedAt: Date.now(),
    });
    try {
      // Strip the user-only marker, then prepend any TEXT-mode character
      // descriptions so the identity rides in words (no reference_image).
      const cleanPrompt = flow.motionPrompt.replace(
        /\s*\(← direct the performance here\)/g,
        "",
      );
      // Restyle: ONE identity, folded into the prompt as the "become"
      // target (Lucy Edit is text-guided; no image inputs).
      const restyleIdentity =
        flow.kind === "restyle" && confirmedImg
          ? (
              flow.textOverrides?.[confirmedImg.id] ??
              (/^\((uploaded|shared)/.test(confirmedImg.prompt.trim())
                ? ""
                : confirmedImg.prompt)
            ).trim()
          : "";
      const sentPrompt = flow.kind === "restyle"
        ? restyleIdentity
          ? `${cleanPrompt}\nCharacter — who the dancer becomes: ${restyleIdentity}`
          : cleanPrompt
        : textChars.length
        ? `${textChars
            .map((d, i) =>
              textChars.length > 1
                ? `Reference person ${i + 1}: ${d}`
                : `Character: ${d}`,
            )
            .join("\n")}\n${
            // Text identities give the model nothing to anchor faces to —
            // without this line it happily reuses ONE face for everyone
            // (verified on the owner's two-dancer take).
            textChars.length > 1
              ? "The reference people are DIFFERENT individuals — give each one a clearly distinct face, hairstyle and features; never reuse the same face twice.\n"
              : ""
          }${cleanPrompt}`
        : cleanPrompt;
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: headers(m.envVar),
        body: JSON.stringify({
          prompt: sentPrompt,
          provider: m.provider,
          modelId: m.modelId,
          aspectRatio: flow.aspect,
          durationSeconds: flow.duration,
          resolution: flow.resolution,
          // Look flow: the still is the i2v input. Transfer/restyle: no
          // first-frame image (identity is reference_image or pure text).
          image: isTransfer || flow.kind === "restyle" ? undefined : stillImage,
          // Transfer: each confirmed look rides as a reference_image (one per
          // person). Empty ⇒ text-only identity (skips the real-person filter).
          images: isTransfer && refImages.length ? refImages : undefined,
          drivingVideo,
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        setDepthNote(null);
        setError(humanizeError(b.error ?? "Submit failed", m.provider));
        preview(lastShown.current); // un-stick the busy frame
        setBarHidden(false); // failed — let them retry
        return;
      }
      setDepthNote(null); // submitted — the pending-attempt line takes over
      const attempt: FlowMotionAttempt = {
        id: `m${Date.now()}`,
        prompt: flow.motionPrompt,
        modelKey: m.key,
        modelLabel: m.short,
        provider: m.provider,
        jobId: b.jobId,
        status: "pending",
        costUsd:
          estimateModelCost(m, flow.resolution, flow.duration) ?? undefined,
        durationSeconds: effectiveSeconds(
          m.provider,
          flow.duration,
          flow.resolution,
        ),
        resolution: flow.resolution,
        aspectRatio: flow.aspect,
        createdAt: Date.now(),
      };
      patchFlow(flow.id, (f) => ({
        motionAttempts: [attempt, ...f.motionAttempts],
      }));
      setBarHidden(true); // fired — hide the bar until an input changes
      setMotionEditing(false); // collapse the prompt back to read-only
    } catch {
      setDepthNote(null);
      setError("Network error — try again");
      preview(lastShown.current);
      setBarHidden(false);
    } finally {
      firingRef.current = false;
    }
  };

  /* poll pending motion attempts; vault + share finished ones */
  useEffect(() => {
    if (!hydrated) return;
    const pending = flows.flatMap((f) =>
      f.motionAttempts
        .filter((a) => a.status === "pending")
        .map((a) => ({ f, a })),
    );
    if (!pending.length) return;
    const tick = setInterval(() => {
      for (const { f, a } of pending) {
        void (async () => {
          try {
            const r = await fetch(
              `/api/status?id=${encodeURIComponent(a.jobId)}&provider=${a.provider}`,
              {
                headers: headers(
                  PROVIDERS[a.provider as ProviderName]?.envVar ?? null,
                ),
              },
            );
            const b = await r.json();
            if (!r.ok || b.state === "error" || b.state === "failed") {
              patchAttempt(f.id, a.id, {
                status: "error",
                error: humanizeError(b.error ?? "Render failed", a.provider),
              });
              preview(lastShown.current); // un-stick the busy frame
              return;
            }
            if (b.state === "done" && b.videoUrl) {
              const local = await persistRemoteVideo(
                a.jobId,
                a.provider,
                b.videoUrl,
                headers(),
              );
              let url = local ?? b.videoUrl;
              // REF AUDIO (default on): the reference clip's soundtrack
              // drops onto the finished take — the choreography tracks the
              // ref 1:1, so it lands on beat. Depth-labeled refs are
              // silent (nothing to lay); any failure keeps the take as-is.
              const audioSrc = audioSrcOf(f.refClip);
              if (
                (f.kind === "transfer" || f.kind === "restyle") &&
                f.keepAudio !== false &&
                local &&
                audioSrc
              ) {
                try {
                  const pw = storedPw();
                  const mr = await fetch("/api/grab", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      ...(pw ? { "x-app-password": pw } : {}),
                    },
                    body: JSON.stringify({
                      action: "mux-audio",
                      video: local,
                      audio: audioSrc,
                    }),
                  });
                  const mb = await mr.json();
                  if (mr.ok && typeof mb.url === "string") url = mb.url;
                } catch {
                  /* silent take is still a take */
                }
              }
              patchAttempt(f.id, a.id, { status: "done", videoUrl: url });
              preview({
                kind: "video",
                src: url,
                aspect: a.aspectRatio,
                label: `${a.modelLabel} · done`,
                compareSrc:
                  (f.kind ?? "look") !== "look" ? f.refClip?.url : undefined,
                compareLabel: f.refClip?.label,
              });
              try {
                const gallery = JSON.parse(
                  store.get(GALLERY_KEY) ?? "[]",
                ) as Clip[];
                if (!gallery.some((c) => c.jobId === a.jobId)) {
                  gallery.push({
                    jobId: a.jobId,
                    sessionId: f.id,
                    provider: a.provider as Clip["provider"],
                    prompt: a.prompt,
                    note: `Flow · ${f.title}`,
                    variantLabel: "Flow",
                    modelLabel: a.modelLabel,
                    createdAt: a.createdAt,
                    status: "done",
                    aspectRatio: a.aspectRatio,
                    durationSeconds: a.durationSeconds,
                    resolution: a.resolution,
                    videoUrl: url,
                    remoteUrl: local ? b.videoUrl : undefined,
                    costUsd: a.costUsd,
                  });
                  store.set(GALLERY_KEY, JSON.stringify(gallery));
                }
              } catch {
                /* gallery share is best-effort; the flow keeps its copy */
              }
            }
          } catch {
            /* transient poll failure — next tick retries */
          }
        })();
      }
    }, 5000);
    return () => clearInterval(tick);
  }, [flows, hydrated, headers, patchAttempt, onPreview]);

  // Never a mysterious blank: if there's no active flow (transient, or a
  // corrupted hot-reload state), show a real Start button instead of an
  // empty div so the user can always begin.
  if (!hydrated) return <div className="flow-panel" />;
  if (!flow) {
    return (
      <div className="flow-panel fade">
        <div className="flow-empty-start">
          <p className="flow-sub">Start a flow to generate here.</p>
          <button
            className="btn-primary"
            onClick={() => {
              const f = newFlow(visibleFlows.length + 1, sessionId || undefined);
              setFlows((fs) => [...fs, f]);
              setFlowId(f.id);
            }}
          >
            ＋ New flow
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flow-panel fade">
      {/* current session's flows — single row, scrolls horizontally on
          overflow; ＋ New flow stays pinned at the far left. */}
      <div className="flow-tabs">
        <button
          className="spec-chip flow-new"
          onClick={() => setNewPick((v) => !v)}
        >
          ＋ New flow
        </button>
        {[...visibleFlows].reverse().map((f) => (
          <button
            key={f.id}
            className={`spec-chip ${f.id === flowId ? "sel" : ""}`}
            onClick={() => setFlowId(f.id)}
          >
            {f.title}
            <span
              role="button"
              className="flow-del"
              title="Delete this flow"
              onClick={(e) => {
                e.stopPropagation();
                setDelAsk(f);
              }}
            >
              ✕
            </span>
          </button>
        ))}
      </div>
      {newPick && (
        <div className="flow-kind-wrap fade">
        <div className="flow-kind-pick">
          {(
            [
              {
                kind: "look" as FlowKind,
                title: "IMAGE → MOTION",
                desc: "Make a look, confirm it, then iterate motion on it forever.",
              },
              {
                kind: "transfer" as FlowKind,
                title: "MOVES → IMAGE → MOTION",
                desc: "Pick a reference video's choreography, confirm a look, and have them perform it in a scene you rebuild.",
              },
              // restyle (Lucy v2v) — hidden behind RESTYLE_ENABLED; the
              // offline model isn't shippable yet (see the flag).
              ...(RESTYLE_ENABLED
                ? [
                    {
                      kind: "restyle" as FlowKind,
                      title: "VIDEO → IMAGE",
                      desc: "Restyle a clip in place — the video drives everything, your look/prompt says what the dancer becomes (Lucy Edit v2v · no depth pass needed).",
                    },
                  ]
                : []),
            ]
          ).map((opt) => (
            <button
              key={opt.kind}
              className="flow-kind-opt"
              onClick={() => {
                setNewPick(false);
                // an untouched flow OF THIS KIND is reused, not cloned
                const empty = visibleFlows.find(
                  (f) =>
                    (f.kind ?? "look") === opt.kind &&
                    !f.imgAttempts.length &&
                    !f.motionAttempts.length &&
                    !f.imgPrompt.trim() &&
                    !f.refClip &&
                    (opt.kind !== "look" || !f.motionPrompt.trim()),
                );
                if (empty) {
                  setFlowId(empty.id);
                  return;
                }
                const n =
                  visibleFlows.filter((f) => (f.kind ?? "look") === opt.kind)
                    .length + 1;
                const f = newFlow(n, sessionId || undefined, opt.kind);
                setFlows((fs) => [...fs, f]);
                setFlowId(f.id);
              }}
            >
              <span className="spec-head">{opt.title}</span>
              <span className="flow-kind-desc">{opt.desc}</span>
            </button>
          ))}
        </div>
        {/* opened by mistake? close without creating anything — BELOW the
            carousel, never scrolling with it */}
        <button
          className="btn-ghost flow-kind-cancel"
          onClick={() => setNewPick(false)}
        >
          Cancel
        </button>
        </div>
      )}
      {/* the working surface for the selected flow — a distinct workbench,
          visually set apart from the flow-tab carousel above */}
      <div className="flow-workspace">
      {/* wizard step chips (segmented tabs) — click to jump between stages */}
      <div className="wiz-steps">
        {flowSteps.map((s, i) => (
          <button
            key={s.stage}
            type="button"
            className={`wiz-step ${i === activeStepIdx ? "cur" : ""} ${s.done ? "done" : ""}`}
            onClick={() => setStepIdx(i)}
          >
            <span className="wiz-step-n">{s.done ? "✓" : i + 1}</span>
            {s.label}
            {!s.required && <span className="wiz-step-opt">opt</span>}
          </button>
        ))}
      </div>

      {error && <div className="error-box fade">{error}</div>}

      {/* RESTYLE needs a FAL key — parked BETWEEN the step chips and the
          stage card (owner call 2026-07-19) so it can't be missed on
          either step. Same key-popover kit as the chat method's panels. */}
      {isRestyle && falKey && !falKey.present && !falPanelHidden && (
        <div className="stub-note key-popover key-inline fade">
          <button
            className="side-del key-popover-close"
            onClick={() => setFalPanelHidden(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
          <span className="label">Lucy Edit Pro · API key required</span>
          <div className="key-row">
            <input
              type="password"
              value={falInput}
              onChange={(e) => setFalInput(e.target.value)}
              placeholder="Paste FAL_KEY"
              aria-label="FAL_KEY"
              onKeyDown={(e) => e.key === "Enter" && void saveFalKey()}
            />
            <button
              className="btn-ghost"
              onClick={() => void saveFalKey()}
              disabled={falSaving || !falInput.trim()}
            >
              {falSaving ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="key-hint">
            {falKey.writable
              ? "Writes to .env.local, effective immediately · "
              : "Stays in this browser, rides each request as a header · "}
            <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          </p>
          {falMsg && <p className="key-msg">{falMsg}</p>}
        </div>
      )}

      {/* ── MOVES stage (transfer flows only) ───── */}
      {activeStage === "moves" && (
        <section className={`flow-stage ${flow.refClip ? "locked" : ""}`}>
          <div className="flow-stage-head">
            <span className="spec-head">
              STAGE 1 · {isRestyle ? "VIDEO — THE SOURCE" : "MOVES — THE REFERENCE"}{" "}
              {flow.refClip ? "· SET ✓" : ""}
            </span>
            <span className="flow-engine mono">
              {isRestyle
                ? "Lucy reads the RAW clip — motion, camera and timing come free; no depth pass"
                : "any clip works — ANIMATE auto-converts it to a depth pass (pure motion, zero identity)"}
            </span>
          </div>
          <p className="flow-locked-hint">
            {flow.refClip
              ? "Click another to switch, click the selected one to replay it in the frame."
              : isRestyle
                ? "Pick the clip to restyle — it uploads to a temp host for the job (raw frames, so use footage you have rights to). GRAB from the Library or upload a local file."
                : "Pick the clip whose motion gets performed — ≤15s (Seedance's reference cap). GRAB from the Library (⤓ pulls YouTube/X with a m:ss trim), or upload a local file."}
          </p>
          {/* candidates as a thumbnail CAROUSEL (same kit as MUSIC FROM) —
              first frames beat filenames. Cards STAY after picking; the
              chosen one badges ▶ SET so it's always obvious which is live. */}
          <div className="flow-scene-carousel" style={{ paddingTop: 8 }}>
            {(() => {
              // Recency window, but the selected clip always stays in view.
              const shown = libClips.slice(0, 10);
              const sel = flow.refClip
                ? libClips.find((c) => c.videoUrl === flow.refClip!.url)
                : null;
              return sel && !shown.includes(sel) ? [sel, ...shown.slice(0, 9)] : shown;
            })().map((c) => {
              const raw = (c.note ?? c.prompt ?? c.jobId) || c.jobId;
              // Every Library note starts "Reference · " — drop the shared
              // prefix so the distinctive part survives truncation.
              const label = raw.replace(/^Reference · /, "");
              const isSel = flow.refClip?.url === c.videoUrl;
              return (
                <button
                  key={c.jobId}
                  className={`flow-scene-card flow-audio-card ${isSel ? "sel" : ""}`}
                  title={raw}
                  onClick={() => {
                    if (!isSel) {
                      patchFlow(flow.id, {
                        refClip: { url: c.videoUrl!, label: label.slice(0, 60) },
                        // Restyle bills by the clip's length — sync the
                        // duration so the ANIMATE cost estimate is honest.
                        ...(isRestyle && c.durationSeconds
                          ? { duration: Math.round(c.durationSeconds) }
                          : {}),
                      });
                    }
                    preview({
                      kind: "video",
                      src: c.videoUrl!,
                      aspect: flow.aspect,
                      label: isRestyle ? "source clip" : "MOVES reference",
                    });
                  }}
                >
                  <video src={withPw(c.videoUrl!)} muted playsInline preload="metadata" />
                  {isSel && <span className="flow-thumb-badge">▶ SET</span>}
                  <span className="flow-cast-tag mono">{label.slice(0, 14)}</span>
                </button>
              );
            })}
            <button
              className="flow-scene-card textonly"
              disabled={uploadBusy}
              onClick={() => refFileRef.current?.click()}
            >
              <span className="flow-scene-desc" style={{ fontSize: 18 }}>
                {uploadBusy ? "…" : "↥"}
              </span>
              <span className="flow-cast-tag mono">
                {uploadBusy ? "UPLOADING" : "Upload"}
              </span>
            </button>
            {/* /depth converts a real-person clip into a pure-motion depth
                reference (in-browser, $0) — the way past Seedance's
                real-person filter. Saving there lands back HERE on focus.
                (Restyle doesn't need it — Lucy reads the raw clip.) */}
            {!isRestyle && (
            <a
              className="flow-scene-card textonly"
              href={
                flow.refClip
                  ? `/depth?src=${encodeURIComponent(flow.refClip.url)}&label=${encodeURIComponent(flow.refClip.label)}&flow=${encodeURIComponent(flow.id)}`
                  : `/depth?flow=${encodeURIComponent(flow.id)}`
              }
              target="_blank"
              rel="noreferrer"
              title={
                flow.refClip
                  ? "Preview/tune the depth pass on the selected reference (ANIMATE already runs it automatically — this is the manual tool with style knobs)"
                  : "Open the depth tool — preview any clip as a pure-motion depth reference (ANIMATE runs the pass automatically)"
              }
            >
              <span className="flow-scene-desc" style={{ fontSize: 18 }}>⬗</span>
              <span className="flow-cast-tag mono">Depth tool</span>
            </a>
            )}
            <input
              ref={refFileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadRefClip(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Inline trim — cut the selected reference to ≤15s right here,
              no round-trip to the Library. Result becomes the reference. */}
          {flow.refClip && (
            <div className="grab-row grab-trim" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <span className="label">Trim to a beat (optional)</span>
              <input
                className="grab-num"
                type="text"
                inputMode="numeric"
                placeholder="from 0:05"
                value={trimFrom}
                onChange={(e) => setTrimFrom(e.target.value)}
                disabled={trimBusy}
              />
              <span className="mono">→</span>
              <input
                className="grab-num"
                type="text"
                inputMode="numeric"
                placeholder="to 0:18"
                value={trimTo}
                onChange={(e) => setTrimTo(e.target.value)}
                disabled={trimBusy}
              />
              <button
                className="btn-ghost"
                onClick={() => void trimRefClip()}
                disabled={trimBusy || !trimFrom.trim() || !trimTo.trim()}
              >
                {trimBusy ? "TRIMMING…" : "✂ Trim"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── STILL / LOOK stage ──────────────────────── */}
      {/* Transfer flows stay OPEN after confirming — you may add a second
          person's look. Look flows collapse to locked on the single confirm. */}
      {activeStage === "look" && (
      <section className={`flow-stage ${confirmedImg && !isTransfer ? "locked" : ""}`}>
        <div className="flow-stage-head">
          <span className="spec-head">
            {isTransfer
              ? "STAGE 2 · IMAGE (OPTIONAL)"
              : isRestyle
                ? "STAGE 2 · IMAGE — WHO THEY BECOME"
                : "STAGE 1 · STILL"}{" "}
            — THE LOOK{" "}
            {confirmedImgs.length
              ? isTransfer
                ? `· CAST ${activeCast.length} ✓`
                : "· CONFIRMED ✓"
              : ""}
          </span>
          {isTransfer && (
            <span className="flow-engine mono">
              identities ride as TEXT by default (photoreal images trip the filter — verified). Seedream cards preview the render best; the ↳ chip can send a stylized look as an image.
            </span>
          )}
          {isRestyle && (
            <span className="flow-engine mono">
              optional — pick a look and its identity text rides the restyle prompt; or skip and describe the change in the prompt alone. ANIMATE runs Lucy Edit Pro (~$0.15/s of clip).
            </span>
          )}
        </div>


        {/* CAST — slots GROW with each picked look, one dancer per look
            (max 3). A card carries face + outfit TOGETHER; the 👕 button
            swaps the garment on that dancer while the face stays. */}
        {isTransfer && (
          <div className="flow-cast">
            <div className="flow-cast-head">
              <span className="label">CAST · {activeCast.length || "0"} DANCER{activeCast.length === 1 ? "" : "S"}</span>
              <span className="flow-engine mono">
                pick one look per dancer in the clip — slot order = &quot;first / second reference person&quot; in the prompt
              </span>
            </div>
            <div className="flow-cast-row">
              {activeCast.map((a, i) => (
                <div key={a.id} className={`flow-cast-slot ${dressBusy === i ? "busy" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.image} alt="" onClick={() => toggleConfirm(a.id)} title="Click to remove this dancer" />
                  {dressBusy === i && <span className="flow-cast-busy mono">DRESSING…</span>}
                  <button
                    className="flow-cast-outfit"
                    title="Swap this dancer's outfit — same face, new garment (~$0.04)"
                    disabled={dressBusy != null}
                    onClick={() => setOutfitFor(outfitFor === i ? null : i)}
                  >
                    👕
                  </button>
                  <span className="flow-cast-tag mono">DANCER {i + 1}</span>
                </div>
              ))}
              {activeCast.length < 3 && (
                <div className="flow-cast-slot empty">
                  <span className="flow-cast-tag mono">
                    DANCER {activeCast.length + 1}
                  </span>
                  <span className="flow-cast-hint">
                    {activeCast.length === 0 ? "pick a look ↓" : "optional — pick ↓"}
                  </span>
                </div>
              )}
              {benchedCast.length > 0 && (
                <span className="flow-engine mono flow-cast-bench">
                  +{benchedCast.length} benched — 3 dancers max, the first 3
                  ride (unconfirm one to swap)
                </span>
              )}
            </div>

            {/* OUTFIT strip — garment sources for the armed slot: custom
                outfit cards (image → /api/dress) + preset garments (text →
                Gemini edit) + a direct upload. */}
            {outfitFor != null && activeCast[outfitFor] && (
              <div className="flow-outfit">
                <span className="label">
                  OUTFIT → DANCER {outfitFor + 1} · face stays, garment swaps
                  (~$0.04)
                </span>
                <div className="chips-row" style={{ flexWrap: "wrap" }}>
                  {customFashion.map((f) => (
                    <button
                      key={f.id}
                      className="flow-outfit-card"
                      title={`${f.label} — your outfit card`}
                      disabled={dressBusy != null}
                      onClick={() => void dressSlotWithImage(outfitFor, f.image, f.label)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.image} alt="" />
                      <span className="flow-cast-tag mono">{f.label.slice(0, 12)}</span>
                    </button>
                  ))}
                  {FASHION.map((f) => (
                    <button
                      key={f.id}
                      className="spec-chip"
                      title={garmentDesc(f.prompt)}
                      disabled={dressBusy != null}
                      onClick={() =>
                        void dressSlotWithText(outfitFor, garmentDesc(f.prompt), f.label)
                      }
                    >
                      {f.gender === "She" ? "♀" : "♂"} {f.label}
                    </button>
                  ))}
                  <button
                    className="spec-chip"
                    disabled={dressBusy != null}
                    onClick={() => outfitFileRef.current?.click()}
                  >
                    ⤒ Upload outfit
                  </button>
                  <input
                    ref={outfitFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f || outfitFor == null) return;
                      const fr = new FileReader();
                      fr.onload = () =>
                        void dressSlotWithImage(
                          outfitFor,
                          String(fr.result),
                          f.name.replace(/\.[^.]+$/, "").slice(0, 24),
                        );
                      fr.readAsDataURL(f);
                    }}
                  />
                  <button className="link-btn" onClick={() => setOutfitFor(null)}>
                    ✕ close
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* One carousel to PICK from: this flow's own generated looks
            (newest first) + looks reused from other flows/cards. A selected
            look STAYS in the carousel with a ✓ badge (owner call — it used
            to vanish into the chip tray); clicking it again unselects. */}
        {(() => {
          const attemptImgs = new Set(flow.imgAttempts.map((a) => a.image));
          // Transfer: Seedream-made cards lead (same family as the video
          // model — the card predicts the render); others follow, badged.
          const pickAttempts = [...flow.imgAttempts].reverse();
          if (isTransfer) {
            pickAttempts.sort(
              (a, b) =>
                Number(b.engine === "seedream") - Number(a.engine === "seedream"),
            );
          }
          const pickShared = sharedLooks.filter((l) => !attemptImgs.has(l.image));
          // Restyle keeps the carousel visible even when empty — its
          // trailing ＋ Custom card IS the way into the generation form.
          if (!isRestyle && !pickAttempts.length && !pickShared.length) return null;
          return (
          <>
            <p className="flow-locked-hint" style={{ marginBottom: 8 }}>
              Pick a look (or reuse one you already made):
            </p>
            <div className="flow-thumbs" style={{ marginBottom: 14 }} ref={thumbsRef}>
              {pickAttempts.map((a) => {
                const isSel = confirmedIds.includes(a.id);
                return (
                <button
                  key={a.id}
                  className={`flow-thumb ${isSel ? "sel" : ""}`}
                  title={
                    isSel
                      ? "Selected — click to unselect"
                      : isTransfer
                        ? "Click to add this person to the transfer"
                        : "Click to CONFIRM this look"
                  }
                  onClick={() => toggleConfirm(a.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.image} alt="" />
                  {isSel && (
                    <span className="flow-thumb-badge">
                      ✓ {isTransfer ? "SELECTED" : "CONFIRMED"}
                    </span>
                  )}
                  {/* Non-Seedream cards in a transfer flow: honest note —
                      the text identity may render differently on Seedance. */}
                  {isTransfer && a.engine && a.engine !== "seedream" && (
                    <span className="flow-thumb-engine mono">
                      {a.engine.toUpperCase()}
                    </span>
                  )}
                  <span
                    role="button"
                    className="flow-thumb-edit"
                    title="Edit from this look — same person, describe only the change"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditFrom(a);
                      patchFlow(flow.id, { imgPrompt: "" });
                    }}
                  >
                    ✎
                  </span>
                </button>
                );
              })}
              {pickShared.map((l) => (
                <button
                  key={l.image.slice(-24)}
                  className="flow-thumb"
                  title={`Reuse this look · ${l.label}`}
                  onClick={() => useSharedLook(l)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.image} alt={l.label} />
                  <span className="flow-thumb-tag">{l.label.slice(0, 18)}</span>
                </button>
              ))}
              {/* Restyle: ＋ Custom at the END of the row (owner call
                  2026-07-19) — opens the Seedream generation form. */}
              {isRestyle && !genOpen && (
                <button
                  className="flow-thumb flow-thumb-custom"
                  title="Generate a look with a prompt (Seedream)"
                  onClick={() => setGenOpen(true)}
                >
                  <span className="flow-thumb-plus">＋</span>
                  <span className="flow-thumb-tag">Custom</span>
                </button>
              )}
            </div>
          </>
          );
        })()}

        {/* Selected looks as compact removable chips (the thumbnail also
            stays ✓-badged in the carousel above). Transfer flows: each
            chip can go as the IMAGE (default) or ↳ its TEXT (the prompt that
            made it, avoiding the real-person filter). */}
        {confirmedImgs.length > 0 && (
          <div className="flow-selected-chips">
            {confirmedImgs.map((a, n) => {
              const hasText =
                Boolean(flow.textOverrides?.[a.id]) ||
                (a.prompt.trim().length >= 12 &&
                  !/^\((uploaded|shared)/.test(a.prompt.trim()));
              const asText = (flow.textLookIds ?? []).includes(a.id);
              const distilling = describingIds.has(a.id);
              return (
                <span key={a.id} className={`flow-sel-chip ${asText ? "text-mode" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.image} alt="" />
                  {isTransfer && confirmedImgs.length > 1 ? `#${n + 1} · ` : ""}
                  {a.prompt.startsWith("(") ? "look" : a.prompt.slice(0, 18)}
                  {/* Sent as… toggle: IMAGE (default) vs TEXT (its prompt).
                      TEXT sidesteps Seedance's real-person filter. */}
                  {isTransfer && hasText && (
                    <button
                      className="flow-sel-mode"
                      title={
                        asText
                          ? "Sent as TEXT (this look's identity description). Click to send the IMAGE instead."
                          : "Sent as the IMAGE. Click to send its identity as text (avoids Seedance's real-person filter)."
                      }
                      onClick={() => toggleLookText(a)}
                    >
                      {asText ? "↳ text" : "🖼 image"}
                    </button>
                  )}
                  {/* Edit WHAT rides as the identity — auto-distilled from
                      the card on confirm (✨ while running); this opens it
                      for hand-tuning. */}
                  {isTransfer && asText && (
                    <button
                      className="flow-sel-mode"
                      title={
                        distilling
                          ? "Distilling the identity from the card (Gemini) — done in a few seconds"
                          : "View/edit this dancer's identity text — the exact words that ride the render"
                      }
                      onClick={() => {
                        setIdEditFor(idEditFor === a.id ? null : a.id);
                        setIdDraft(flow.textOverrides?.[a.id] ?? a.prompt);
                      }}
                    >
                      {distilling ? "✨ identity…" : "✎ identity"}
                    </button>
                  )}
                  <button
                    className="flow-sel-x"
                    title="Remove from selection"
                    onClick={() => toggleConfirm(a.id)}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Identity-text editor — the text that ACTUALLY rides for this
            dancer. ✨ From card distills a face-first description from the
            picked image (Gemini, ~free): the strongest way to make two
            dancers render as different people. */}
        {isTransfer &&
          idEditFor &&
          (() => {
            const a = confirmedImgs.find((x) => x.id === idEditFor);
            if (!a) return null;
            const slotNo = activeCast.findIndex((x) => x.id === a.id) + 1;
            return (
              <div className="flow-id-editor">
                <span className="label">
                  DANCER {slotNo || "?"} · IDENTITY TEXT — this exact text rides
                  the render
                </span>
                <textarea
                  rows={4}
                  value={idDraft}
                  onChange={(e) => setIdDraft(e.target.value)}
                  placeholder="face shape, eyes, hair color/style, skin tone, vibe, outfit — distinctive features first"
                />
                <div className="chips-row">
                  <button
                    className="btn-ghost"
                    disabled={describeBusy}
                    onClick={() => void describeCard(a)}
                    title="Gemini looks at the card and writes a face-first description (~free)"
                  >
                    {describeBusy ? "✨ describing…" : "✨ From card"}
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!idDraft.trim()}
                    onClick={() => {
                      patchFlow(flow.id, (f) => ({
                        textOverrides: {
                          ...(f.textOverrides ?? {}),
                          [a.id]: idDraft.trim(),
                        },
                      }));
                      setIdEditFor(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="link-btn" onClick={() => setIdEditFor(null)}>
                    ✕ cancel
                  </button>
                </div>
              </div>
            );
          })()}

        {/* RESTYLE: image first (the carousel above), then the prompt —
            which ships collapsed (the template is complete; the identity
            text folds in automatically). The KEY panel lives up between
            the step chips and this stage card. */}
        {isRestyle && (
          <div className="flow-gen-row" style={{ marginBottom: 14 }}>
            {!restyleEditing ? (
              <div className="flow-motion-collapsed">
                <p className="flow-take-prompt clamp3">{flow.motionPrompt}</p>
                <button className="link-btn" onClick={() => setRestyleEditing(true)}>
                  ✎ Edit prompt
                </button>
              </div>
            ) : (
              <>
                <textarea
                  rows={5}
                  value={flow.motionPrompt}
                  onChange={(e) => patchFlow(flow.id, { motionPrompt: e.target.value })}
                  placeholder="What should change — 'Transform the dancer into …; keep the choreography, camera and timing exactly'"
                />
                <div className="flow-gen-actions">
                  <button
                    className="link-btn"
                    onClick={() =>
                      patchFlow(flow.id, {
                        motionPrompt: randomFrom(RESTYLE_PRESETS, flow.motionPrompt),
                      })
                    }
                    title="Cycle restyle templates — in-place swap / scene-swap variant"
                  >
                    🎲 Template
                  </button>
                  <button className="link-btn" onClick={() => setRestyleEditing(false)}>
                    ✓ Done
                  </button>
                </div>
              </>
            )}
            <span className="flow-engine mono">
              Lucy Edit Pro (fal) · $0.15/s of OUTPUT — first run produced ~4s
              from a 15s source (~$0.60; Wan-family length cap, observed
              2026-07-19). Strongest at STYLE transforms (claymation/anime);
              photoreal identity swaps come out doll-faced — use the depth
              flow for those.{falKey?.present ? " · FAL_KEY ✓" : ""}
            </span>
          </div>
        )}

        {/* The generation form collapses by default on transfer/restyle —
            the common path is pick-from-carousel; prompting is the explicit
            side door (owner call 2026-07-18; restyle showed TWO textareas
            without this, 2026-07-19). */}
        {isTransfer && activeCast.length > 0 && !genOpen && !editFrom && (
          <button
            className="link-btn"
            style={{ marginBottom: 8 }}
            onClick={() => setGenOpen(true)}
          >
            ✎ Generate a look with a prompt…
          </button>
        )}
        {(isTransfer
          ? activeCast.length === 0 || genOpen || Boolean(editFrom)
          : isRestyle
            ? genOpen || Boolean(editFrom)
            : !confirmedImg || Boolean(editFrom)) && (
          <>
            {editFrom && (
              <div className="chips-row" style={{ marginBottom: 8 }}>
                <span className="sel-chip fade">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={editFrom.image} alt="" />
                  editing this look — describe ONLY the change
                  <button
                    className="link-btn danger"
                    onClick={() => setEditFrom(null)}
                    aria-label="Cancel edit context"
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}
            <div className="flow-params">
              <label className="mono">
                IMAGE MODEL{" "}
                <select
                  value={imgEngine.key}
                  onChange={(e) =>
                    patchFlow(flow.id, { imgEngine: e.target.value })
                  }
                >
                  {IMG_ENGINES.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label} · ~${e.cost.toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flow-gen-row">
              <textarea
                rows={2}
                value={flow.imgPrompt}
                onChange={(e) =>
                  patchFlow(flow.id, { imgPrompt: e.target.value })
                }
                placeholder={
                  editFrom
                    ? "Describe ONLY the change — e.g. 'same person, same room, change the top to an oversized red hoodie'"
                    : "Describe the person/look — e.g. 'woman in her 20s, dewy glass skin, pink slip dress, dressing-room vanity light, photoreal 9:16 portrait'"
                }
              />
              <div className="flow-gen-actions">
                <button
                  className="btn-primary flow-btn"
                  disabled={!flow.imgPrompt.trim() || busyImg}
                  onClick={() =>
                    armed === "img" ? void generateImage() : setArmed("img")
                  }
                >
                  {busyImg
                    ? "Generating…"
                    : armed === "img"
                      ? `Confirm · ~$${editFrom ? "0.04" : imgEngine.cost.toFixed(2)}`
                      : editFrom
                        ? "Edit look · Gemini"
                        : "Generate look"}
                </button>
                <button
                  className="link-btn"
                  onClick={() =>
                    patchFlow(flow.id, {
                      imgPrompt: randomFrom(LOOK_PRESETS, flow.imgPrompt),
                    })
                  }
                  title="Fill with a random starter draft — edit from there"
                >
                  🎲 Random
                </button>
                {/* Bake the MOTION step's scene into the look prompt — the
                    identity card gets generated in the world (and light) it
                    will dance in, which locks better than a studio portrait. */}
                {activeScene && (
                  <button
                    className="link-btn"
                    disabled={flow.imgPrompt.includes(activeScene.setting)}
                    title={`Append the picked scene so the look is lit for it — ${activeScene.setting}`}
                    onClick={() =>
                      patchFlow(flow.id, {
                        imgPrompt: `${
                          flow.imgPrompt.trim()
                            ? `${flow.imgPrompt.trim().replace(/[\s,.]+$/, "")}, `
                            : ""
                        }standing in ${activeScene.setting}, lit to match: ${activeScene.light}`,
                      })
                    }
                  >
                    {flow.imgPrompt.includes(activeScene.setting)
                      ? `✓ scene matched`
                      : `⛯ Match scene · ${activeScene.label}`}
                  </button>
                )}
                <button
                  className="link-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  ⤒ Upload
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* (candidate looks now live in the single pick carousel above) */}

        {confirmedImg && (
          <div className="flow-confirm-row">
            <button className="link-btn" onClick={saveAsCard}>
              {savedCard
                ? "✓ Saved as Character card"
                : "＋ Save as Character card (use in chat)"}
            </button>
            <button
              className="link-btn"
              onClick={() =>
                patchFlow(flow.id, { confirmedImgIds: [], confirmedImgId: undefined })
              }
            >
              {isTransfer && confirmedImgs.length > 1
                ? "✕ Clear selection"
                : "✎ Change look"}
            </button>
          </div>
        )}
      </section>
      )}

      {/* ── MOTION stage ────────────────────────────── */}
      {activeStage === "motion" && (
      <section className={`flow-stage ${canAnimate ? "" : "disabled"}`}>
        <div className="flow-stage-head">
          <span className="spec-head">
            {isTransfer
              ? "STAGE 3 · MOTION — PERFORM THE MOVES"
              : "STAGE 2 · MOTION — MAKE IT MOVE"}
          </span>
          <span className="flow-engine mono">
            {isTransfer
              ? "clip-reading models only — Seedance 2.0 today (i2v models can't take a video ref); ≤15s, Mini is cheapest"
              : "recommended: Kling 3.0 (most natural motion per dollar)"}
          </span>
        </div>

        {isTransfer && activeCast.length > 1 && (
          <p className="flow-locked-hint" style={{ marginBottom: 12 }}>
            {activeCast.length} dancers cast — in the prompt, refer to them
            in slot order (&quot;the first reference person… the
            second…&quot;) and say where each one is (left / right) so the
            clip&apos;s dancers map to the right identity.
          </p>
        )}

        {/* DEPTH REF — the default transfer path: ANIMATE first converts the
            MOVES clip to a depth pass (pure motion, zero identity → passes
            the real-person filter), then submits the render with it. */}
        {isTransfer && (
          <div className="flow-depth-row">
            {(() => {
              const on = flow.depthRef !== false;
              const alreadyDepth = flow.refClip
                ? /^depth\b/i.test(flow.refClip.label)
                : false;
              const cached =
                on &&
                !alreadyDepth &&
                flow.depthClip?.srcUrl === flow.refClip?.url;
              return (
                <>
                  <span className={`zt ${on ? "on" : ""} ${alreadyDepth ? "disabled" : ""}`}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label="Depth ref"
                      className="zt-switch"
                      disabled={alreadyDepth}
                      onClick={() => {
                        // The toggle drives the prompt DEFAULT: an untouched
                        // template swaps to the other set's lead; user-typed
                        // text is never eaten.
                        const next = !on;
                        patchFlow(flow.id, {
                          depthRef: next,
                          ...(isPresetPrompt(flow.motionPrompt)
                            ? {
                                motionPrompt: next
                                  ? TRANSFER_PRESETS_DEPTH[0]
                                  : TRANSFER_PRESETS_RAW[0],
                              }
                            : {}),
                        });
                      }}
                    >
                      <span className="zt-track">
                        <span className="zt-knob" />
                      </span>
                      <span className="zt-label">DEPTH REF</span>
                    </button>
                  </span>
                  <span className="flow-engine mono">
                    {alreadyDepth
                      ? "the picked reference is already a depth clip — sent as-is"
                      : !on
                        ? "raw clip rides as the reference — real people in it will trip Seedance's filter"
                        : cached
                          ? "depth pass cached for this reference — reused, no reconvert"
                          : "ANIMATE runs a depth pass on the reference first (in-browser, $0), then renders"}
                  </span>
                  {/* +EXPRESSION — unsharp the depth so faces/hands read;
                      the model can only follow what exists in the ref. */}
                  {on && !alreadyDepth && (
                    <span className={`zt ${flow.depthDetail !== false ? "on" : ""}`}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={flow.depthDetail !== false}
                        aria-label="Expression detail"
                        className="zt-switch"
                        title="Boost local contrast in the depth pass so head direction, expressions and fingers survive the flattening"
                        onClick={() =>
                          patchFlow(flow.id, {
                            depthDetail: flow.depthDetail === false,
                          })
                        }
                      >
                        <span className="zt-track">
                          <span className="zt-knob" />
                        </span>
                        <span className="zt-label">+EXPRESSION</span>
                      </button>
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}
        {/* REF AUDIO — the reference clip's music lands back on the finished
            take (the depth pass strips it; the choreography is 1:1 so it
            drops on beat). Local ffmpeg, free. A depth-labeled reference is
            silent — its ORIGINAL speaks for it (linked by /depth, or picked
            right here). */}
        {isTransfer && (
          <div className="flow-depth-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            {(() => {
              const on = flow.keepAudio !== false;
              const depthRefPicked = flow.refClip
                ? /^depth\b/i.test(flow.refClip.label)
                : false;
              const audioSrc = audioSrcOf(flow.refClip);
              const needsPick = depthRefPicked && !audioSrc;
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span className={`zt ${on ? "on" : ""} ${needsPick ? "disabled" : ""}`}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label="Ref audio"
                        className="zt-switch"
                        disabled={needsPick}
                        onClick={() => patchFlow(flow.id, { keepAudio: !on })}
                      >
                        <span className="zt-track">
                          <span className="zt-knob" />
                        </span>
                        <span className="zt-label">REF AUDIO</span>
                      </button>
                    </span>
                    <span className="flow-engine mono">
                      {needsPick
                        ? "the depth reference is silent — pick which clip's soundtrack rides ↓"
                        : !on
                          ? "the take keeps whatever audio the model generated"
                          : depthRefPicked
                            ? "music comes from the linked original clip — lands on beat (local ffmpeg, $0)"
                            : "the reference's music lands on the finished take (local ffmpeg, $0) — beats match, the moves follow the same timeline"}
                    </span>
                  </div>
                  {/* Soundtrack source picker — thumbnail carousel of
                      non-depth Library clips: ▶ auditions the sound, the
                      card itself picks it. */}
                  {depthRefPicked && on && (
                    <div className="flow-scenes">
                      <span className="label">
                        MUSIC FROM — ▶ to listen · tap the card to use it
                      </span>
                      <div className="flow-scene-carousel">
                        {libClips
                          .filter(
                            (c) =>
                              c.videoUrl &&
                              !/depth/i.test(`${c.note ?? ""}${c.prompt ?? ""}`),
                          )
                          .slice(0, 12)
                          .map((c) => {
                            const raw = (c.note ?? c.prompt ?? c.jobId) || c.jobId;
                            const label = raw.replace(/^Reference · /, "");
                            const isSel = flow.refClip?.audioUrl === c.videoUrl;
                            const listening = auditionUrl === c.videoUrl;
                            return (
                              <button
                                key={c.jobId}
                                className={`flow-scene-card flow-audio-card ${isSel ? "sel" : ""}`}
                                title={raw}
                                onClick={() =>
                                  patchFlow(flow.id, {
                                    refClip: flow.refClip
                                      ? {
                                          ...flow.refClip,
                                          audioUrl: isSel ? undefined : c.videoUrl,
                                        }
                                      : flow.refClip,
                                  })
                                }
                              >
                                <video
                                  src={withPw(c.videoUrl!)}
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                                <span
                                  role="button"
                                  className={`flow-audio-listen ${listening ? "live" : ""}`}
                                  title={listening ? "Stop listening" : "Listen to this clip's sound"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAuditionUrl(listening ? null : c.videoUrl!);
                                  }}
                                >
                                  {listening ? "◼" : "▶"}
                                </span>
                                {isSel && (
                                  <span className="flow-thumb-badge">♪ IN USE</span>
                                )}
                                <span className="flow-cast-tag mono">
                                  {label.slice(0, 14)}
                                </span>
                              </button>
                            );
                          })}
                      </div>
                      {auditionUrl && (
                        <audio
                          src={withPw(auditionUrl)}
                          autoPlay
                          onEnded={() => setAuditionUrl(null)}
                        />
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* model/params always visible & editable */}
        <div className="flow-params">
          <label className="mono">
            MODEL{" "}
            <select
              value={flow.motionModelKey}
              onChange={(e) =>
                patchFlow(flow.id, { motionModelKey: e.target.value })
              }
            >
              {(isTransfer ? TRANSFER_MODELS : MOTION_MODELS).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.short}
                  {!isTransfer && m.key === "kling" ? " ★" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="mono">
            ASPECT{" "}
            <select
              value={flow.aspect}
              onChange={(e) =>
                patchFlow(flow.id, { aspect: e.target.value as AspectRatio })
              }
            >
              {ASPECT_RATIOS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="mono">
            RES{" "}
            <select
              value={flow.resolution}
              onChange={(e) =>
                patchFlow(flow.id, {
                  resolution: e.target.value as Resolution,
                })
              }
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="mono">
            DURATION{" "}
            <input
              type="number"
              min={1}
              max={15}
              value={flow.duration}
              onChange={(e) =>
                patchFlow(flow.id, { duration: Number(e.target.value) || 5 })
              }
            />{" "}
            → {effSecs}s
          </label>
        </div>

        {canAnimate ? (
          <>
            {/* After a take has been sent, collapse the long prompt to a
                3-line read-only view with ✎ Edit → textarea (owner call). */}
            {flow.motionAttempts.length > 0 && !motionEditing ? (
              <div className="flow-motion-collapsed">
                <p className="flow-take-prompt clamp3">{flow.motionPrompt}</p>
                <button
                  className="link-btn"
                  onClick={() => setMotionEditing(true)}
                >
                  ✎ Edit prompt
                </button>
              </div>
            ) : (
            <div className="flow-gen-row">
              {/* SETTING — the scene is the depth transfer's main creative
                  control (the depth ref brings no world of its own). One
                  card carousel: built-ins (starter photos where we have
                  them), your custom scenes, ＋ add your own. A card swaps
                  ONLY the prompt's Setting:/Light: pair in place. */}
              {isTransfer && flow.depthRef !== false && (
                <div className="flow-scenes">
                  <span className="label">SETTING</span>
                  <div className="flow-scene-carousel">
                    {[...DEPTH_SCENES, ...customScenes].map((s) => {
                      const isSel = flow.motionPrompt.includes(s.setting);
                      return (
                        <button
                          key={s.id}
                          className={`flow-scene-card ${isSel ? "sel" : ""} ${s.img ? "" : "textonly"}`}
                          title={`${s.setting}. Light: ${s.light}.`}
                          onClick={() =>
                            patchFlow(flow.id, {
                              motionPrompt: applyDepthScene(flow.motionPrompt, s),
                            })
                          }
                        >
                          {s.img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.img} alt="" loading="lazy" />
                          ) : (
                            <span className="flow-scene-desc">{s.setting}</span>
                          )}
                          {isSel && <span className="flow-thumb-badge">▶ SET</span>}
                          <span className="flow-cast-tag mono">{s.label}</span>
                        </button>
                      );
                    })}
                    <button
                      className="flow-scene-card textonly add"
                      title="Add your own scene — a name, the setting line, optionally a photo card"
                      onClick={() => setSceneFormOpen((v) => !v)}
                    >
                      <span className="flow-scene-desc">＋</span>
                      <span className="flow-cast-tag mono">Custom</span>
                    </button>
                  </div>
                  {sceneFormOpen && (
                    <div className="flow-scene-form">
                      <input
                        type="text"
                        value={sceneName}
                        onChange={(e) => setSceneName(e.target.value)}
                        placeholder="Name — e.g. Han River park"
                      />
                      <input
                        type="text"
                        value={sceneText}
                        onChange={(e) => setSceneText(e.target.value)}
                        placeholder="Setting line — 'Han River park at dusk — bridge lights on the water, joggers blurred behind'"
                      />
                      <div className="chips-row">
                        <button
                          className="spec-chip"
                          onClick={() => sceneFileRef.current?.click()}
                        >
                          {sceneImg ? "✓ photo attached" : "⤒ Photo (optional)"}
                        </button>
                        <input
                          ref={sceneFileRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            const fr = new FileReader();
                            fr.onload = () => {
                              // Downscale to a small card — customAssets
                              // lives in the store, keep entries light.
                              const img = new Image();
                              img.onload = () => {
                                const scale = Math.min(1, 360 / Math.max(img.width, img.height));
                                const c = document.createElement("canvas");
                                c.width = Math.round(img.width * scale);
                                c.height = Math.round(img.height * scale);
                                c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
                                setSceneImg(c.toDataURL("image/jpeg", 0.8));
                              };
                              img.src = String(fr.result);
                            };
                            fr.readAsDataURL(f);
                          }}
                        />
                        <button
                          className="btn-ghost"
                          disabled={!sceneName.trim() || (!sceneText.trim() && !sceneImg)}
                          onClick={saveCustomScene}
                        >
                          Save scene
                        </button>
                        <button className="link-btn" onClick={() => setSceneFormOpen(false)}>
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <textarea
                rows={isTransfer ? 7 : 2}
                value={flow.motionPrompt}
                onChange={(e) =>
                  patchFlow(flow.id, { motionPrompt: e.target.value })
                }
                placeholder="Describe ONLY the motion — 'subtle breathing, slow blink, hair moving in a soft breeze, a small head tilt and a smile at the lens'"
              />
              {/* ANIMATE lives ONLY in the floating bottom bar now — the
                  inline button was a confusing duplicate. This row keeps just
                  the template/random helper. */}
              <div className="flow-gen-actions">
                <button
                  className="link-btn"
                  onClick={() =>
                    patchFlow(flow.id, {
                      motionPrompt: randomFrom(
                        isTransfer
                          ? flow.depthRef !== false
                            ? TRANSFER_PRESETS_DEPTH
                            : TRANSFER_PRESETS_RAW
                          : MOTION_PRESETS,
                        flow.motionPrompt,
                      ),
                    })
                  }
                  title={
                    isTransfer
                      ? flow.depthRef !== false
                        ? "Cycle depth-reference templates (scene rebuilds — beach / neon night); swap the Setting: line for your world"
                        : "Cycle raw-clip templates — camera-lock / green-screen composite"
                      : "Fill with a random motion draft — edit from there"
                  }
                >
                  🎲 {isTransfer ? "Template" : "Random"}
                </button>
              </div>
            </div>
            )}
          </>
        ) : (
          <p className="flow-locked-hint">
            {isTransfer
              ? "Set the MOVES reference (Stage 1) — then generate here. A look (Stage 2) is optional: skip it and describe the character in the prompt below."
              : "Confirm a look in Stage 1 first — then iterate motion here as many times as you want without touching the still."}
          </p>
        )}
      </section>
      )}

      {/* minimal step progress — below the stage, not competing with the chips */}
      <div className="wiz-progress">
        <span className="wiz-progress-label">
          STEP {activeStepIdx + 1} / {flowSteps.length}
        </span>
        <div className="wiz-dots">
          {flowSteps.map((s, i) => (
            <span
              key={s.stage}
              className={`wiz-dot ${i === activeStepIdx ? "cur" : ""} ${s.done ? "done" : ""}`}
            />
          ))}
        </div>
      </div>

      {/* wizard nav footer — manual prev/next; Animate lives on the motion step */}
      <div className="wiz-nav">
        <button
          type="button"
          className="btn-ghost wiz-prev"
          disabled={activeStepIdx === 0}
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
        >
          ← Back
        </button>
        {activeStage === "motion" ||
        (isRestyle && activeStepIdx === flowSteps.length - 1) ? (
          <button
            className="btn-primary wiz-animate"
            disabled={!animateReady || rendering}
            onClick={() => void generateMotion()}
            title={
              animateReady
                ? undefined
                : isRestyle
                  ? "Pick a source clip on the VIDEO step first"
                  : isTransfer
                    ? "Set a MOVES reference and write the prompt first"
                    : "Confirm a look and write the motion prompt first"
            }
          >
            {rendering
              ? "Rendering…"
              : hasTake
                ? "↻ Animate again"
                : "▶ Animate"}
            {!rendering && animateReady && motionCost && fmtCost(motionCost)
              ? ` — ${fmtCost(motionCost)}`
              : ""}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary wiz-next"
            disabled={
              Boolean(flowSteps[activeStepIdx]?.required) &&
              !flowSteps[activeStepIdx]?.done
            }
            onClick={() =>
              setStepIdx((i) => Math.min(flowSteps.length - 1, i + 1))
            }
          >
            Next →
          </button>
        )}
      </div>

      {/* Take history — stacks chat-style below the wizard, visible on any
          step. Newest first; click a take to replay it in the shared frame. */}
      {flow.motionAttempts.length > 0 && (
        <div className="flow-history">
          <span className="flow-history-label">
            Takes · {flow.motionAttempts.length}
          </span>
          <div className="flow-takes">
            {flow.motionAttempts.map((a) => (
              <div
                key={a.id}
                className={`flow-take ${a.videoUrl ? "playable" : ""}`}
                onClick={() =>
                  a.videoUrl &&
                  preview({
                    kind: "video",
                    src: a.videoUrl,
                    aspect: a.aspectRatio,
                    label: `${a.modelLabel} · take`,
                    compareSrc:
                      (flow.kind ?? "look") !== "look" ? flow.refClip?.url : undefined,
                    compareLabel: flow.refClip?.label,
                  })
                }
              >
                <div className="spec-head">
                  {a.modelLabel.toUpperCase()} · {a.durationSeconds}s ·{" "}
                  {a.status.toUpperCase()}
                  {fmtCost(a.costUsd) ? ` · ${fmtCost(a.costUsd)}` : ""}
                </div>
                {/* prune the history — a finished take stays in the Library
                    (the spend ledger), only this list entry goes */}
                {a.status !== "pending" && (
                  <button
                    className="flow-take-x"
                    title="Remove from this list — a finished take stays in the Library"
                    onClick={(e) => {
                      e.stopPropagation();
                      patchFlow(flow.id, (f) => ({
                        motionAttempts: f.motionAttempts.filter(
                          (x) => x.id !== a.id,
                        ),
                      }));
                    }}
                  >
                    ✕
                  </button>
                )}
                {a.status === "pending" && (
                  <div className="spec-busy">
                    <span className="dot live" /> RENDERING — lands in the
                    Library automatically
                  </div>
                )}
                {a.status === "error" && (
                  <div className="turn-error">{a.error}</div>
                )}
                {a.videoUrl && (
                  <span className="flow-take-view mono">
                    ▶ view in the frame
                  </span>
                )}
                {/* Retro-mux — lay the ref soundtrack over a take rendered
                    before the audio source existed/was linked. */}
                {a.status === "done" &&
                  a.videoUrl &&
                  isLocalVideoUrl(a.videoUrl) &&
                  isTransfer &&
                  Boolean(audioSrcOf(flow.refClip)) && (
                    <button
                      className="link-btn"
                      disabled={muxBusyId != null}
                      title="Replace this take's audio with the reference soundtrack (local ffmpeg, $0)"
                      onClick={(e) => {
                        e.stopPropagation();
                        void muxTake(a);
                      }}
                    >
                      {muxBusyId === a.id ? "♪ muxing…" : "♪ Add ref audio"}
                    </button>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
      {/* /flow-workspace */}

      {/* delete-flow confirmation (owner call: modal, not two-click) */}
      {delAsk && (
        <div className="confirm-backdrop" onClick={() => setDelAsk(null)}>
          <div
            className="confirm-card"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="label">Delete “{delAsk.title}”?</span>
            <p className="pitch-copy">
              The flow&apos;s prompts and stills are removed. Finished takes
              already saved to the Library are NOT deleted.
            </p>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setDelAsk(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const id = delAsk.id;
                  setDelAsk(null);
                  setFlows((fs) => {
                    const rest = fs.filter((x) => x.id !== id);
                    if (flowId === id) {
                      const vis = rest.filter(
                        (x) =>
                          !x.sessionId || !sessionId || x.sessionId === sessionId,
                      );
                      setFlowId(vis[vis.length - 1]?.id ?? null);
                    }
                    return rest;
                  });
                  preview(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
