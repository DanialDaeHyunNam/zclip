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
import { keyHeader } from "@/lib/client-keys";
import * as store from "@/lib/store";
import { type Clip, fmtCost, GALLERY_KEY, PW_KEY } from "@/lib/clip";
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
] as const;

interface FlowImageAttempt {
  id: string;
  prompt: string;
  image: string; // dataURL — file-backed store has no 5MB quota problem
  createdAt: number;
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

/** What a flow is FOR — picked at ＋ New flow (docs: two pipelines):
 *   "look"     · LOOK → MOTION (classic still → i2v iterate)
 *   "transfer" · MOVES → LOOK → TRANSFER (a reference video's choreography
 *                performed by your confirmed look — clip-reading models
 *                only, Seedance 2.0 today, Kling Motion Control later). */
type FlowKind = "look" | "transfer";

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
   *  never base64: the file-backed store must not swallow 35MB clips. */
  refClip?: { url: string; label: string } | null;
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
  motionPrompt: string;
  motionModelKey: string;
  motionAttempts: FlowMotionAttempt[];
  aspect: AspectRatio;
  duration: number;
  resolution: Resolution;
}

/** Distilled from the two-dancer depth-reference field prompt (2026-07-15):
 *  camera lock + wardrobe hold are what keep motion transfer usable; the
 *  green-screen variant generates pre-keyed footage for compositing. */
const TRANSFER_PRESETS = [
  "Reproduce the reference video's body motion beat-for-beat on the same timeline. The camera stays completely fixed — every framing change comes from the dancer stepping toward or away from the lens; do NOT move, zoom or reframe the camera. The subject is the person from the reference image, outfit and hair held identical in every frame.\nActing: lively natural facial expressions throughout — playful energy, eyes to the lens. (← direct the performance here)\nAvoid: camera drift, face morphing, distorted hands, extra people, text, watermark.",
  "Reproduce the reference video's motion one-to-one. Locked camera — no zoom, pan or pull-back. The subject is the person from the reference image, outfit held identical in every frame. Every pixel around the subject is one flat solid green (#00FF00), a pure 2D color fill edge to edge, as if already keyed out — no green-screen studio set, no floor shadows, no wall-floor seam, no green cast on the subject, crisp silhouette edges.\nActing: confident and playful, eyes to the lens. (← direct the performance here)\nAvoid: camera movement, gradients in the green, reflections, extra people, text, watermark.",
];

const newFlow = (n: number, sessionId?: string, kind: FlowKind = "look"): Flow => ({
  id: `f${Date.now()}`,
  title: kind === "transfer" ? `Moves → Image → Motion ${n}` : `Image → Motion ${n}`,
  createdAt: Date.now(),
  sessionId,
  kind,
  refClip: null,
  imgEngine: "grok",
  imgPrompt: "",
  imgAttempts: [],
  confirmedImgIds: [],
  // Transfer flows open with the distilled template — editing a working
  // draft beats a blank box (same philosophy as 🎲 starters).
  motionPrompt: kind === "transfer" ? TRANSFER_PRESETS[0] : "",
  motionModelKey: kind === "transfer" ? "seedance-2" : "kling",
  motionAttempts: [],
  aspect: "9:16",
  duration: kind === "transfer" ? 10 : 5,
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
const humanizeError = (raw: string): string => {
  // Always keep the provider's exact words so there's no doubt WHICH error
  // this is (a credit/quota error reads nothing like a safety block).
  const verbatim = ` (Seedance said: "${raw}")`;
  if (/real person|may contain real/i.test(raw)) {
    return (
      "Seedance's safety filter blocked the REFERENCE — it reads the driving video's frames and flags real people in it (this fires on the video, not just an identity image, so text-only looks don't dodge it). The depth-render references that pass carry pure motion, zero identity. For a raw real-person dance clip, Kling Motion Control (pose-extracted) or Runway Act-Two is the path." +
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
}: {
  /** Surface an image/video in the studio's shared left frame. */
  onPreview: (p: FlowPreview | null) => void;
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
      return {
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
  // Motion is generatable when: look flow has a confirmed still, OR transfer
  // flow has its MOVES clip (the identity look is optional there).
  const canAnimate = isTransfer ? Boolean(flow?.refClip) : Boolean(confirmedImg);
  const motionReady = Boolean(flow?.motionPrompt.trim());
  const animateReady = canAnimate && motionReady;
  // Hide the bar while a take is actually rendering (any pending attempt) —
  // there's nothing to fire until it lands.
  const rendering = Boolean(
    flow?.motionAttempts.some((a) => a.status === "pending"),
  );
  // Any edit to a generation input re-shows the bar (it hid after ANIMATE).
  const inputSig = flow
    ? `${flow.motionPrompt}|${confirmedIds.join(",")}|${(flow.textLookIds ?? []).join(",")}|${flow.refClip?.url ?? ""}|${flow.motionModelKey}|${flow.aspect}|${flow.duration}|${flow.resolution}`
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
      preview({ kind: "video", src: done.videoUrl, aspect: done.aspectRatio, label: `${done.modelLabel} · take` });
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
    const desc = a.prompt.trim();
    if (desc.length < 12 || /^\((uploaded|shared)/.test(desc)) {
      setError(
        "This look has no text description to switch to (it was uploaded, not generated from a prompt).",
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

  /** Click a thumbnail: look flows single-select; transfer flows toggle
   *  membership (one identity per person in the reference clip). */
  const toggleConfirm = (id: string) => {
    if (!flow) return;
    const cur =
      flow.confirmedImgIds ?? (flow.confirmedImgId ? [flow.confirmedImgId] : []);
    const next = isTransfer
      ? cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id]
      : cur.length === 1 && cur[0] === id
        ? []
        : [id];
    patchFlow(flow.id, { confirmedImgIds: next, confirmedImgId: undefined });
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
      setHydrated(true);
    })();
  }, []);

  /* persist */
  useEffect(() => {
    if (!hydrated) return;
    store.set(FLOWS_KEY, JSON.stringify(flows));
  }, [flows, hydrated]);

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
    const imageLooks = confirmedImgs.filter((a) => !textIds.has(a.id));
    const refImages = imageLooks.map((a) => splitDataUrl(a.image));
    const textChars = confirmedImgs
      .filter((a) => textIds.has(a.id))
      .map((a) => a.prompt.trim())
      .filter(Boolean);

    // Transfer flows carry the MOVES clip as a Library pointer — fetch and
    // encode it now (same-origin, password header as query param not needed
    // for fetch()).
    let drivingVideo: { base64: string; mimeType: string } | undefined;
    if (flow.kind === "transfer" && flow.refClip) {
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
        if (dur > 15.2) {
          setError(
            `The MOVES reference is ${Math.round(dur)}s — Seedance reads at most 15s of reference. Trim the beat you want with GRAB (Library ⤓, m:ss trim like 0:05 → 0:18) and pick the trimmed clip here.`,
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
          fr.readAsDataURL(blob);
        });
        drivingVideo = { base64: b64, mimeType: "video/mp4" };
      } catch {
        setError(
          "Couldn't load the MOVES reference — the saved file may have been cleared. Pick or upload it again.",
        );
        preview(lastShown.current);
        firingRef.current = false;
        setBarHidden(false);
        return;
      }
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
      const sentPrompt = textChars.length
        ? `${textChars
            .map((d, i) =>
              textChars.length > 1
                ? `Reference person ${i + 1}: ${d}`
                : `Character: ${d}`,
            )
            .join("\n")}\n${cleanPrompt}`
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
          // Look flow: the still is the i2v input. Transfer: no first-frame
          // image (identity is reference_image or pure text).
          image: isTransfer ? undefined : stillImage,
          // Transfer: each confirmed look rides as a reference_image (one per
          // person). Empty ⇒ text-only identity (skips the real-person filter).
          images: isTransfer && refImages.length ? refImages : undefined,
          drivingVideo,
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        setError(humanizeError(b.error ?? "Submit failed"));
        preview(lastShown.current); // un-stick the busy frame
        setBarHidden(false); // failed — let them retry
        return;
      }
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
                error: humanizeError(b.error ?? "Render failed"),
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
              const url = local ?? b.videoUrl;
              patchAttempt(f.id, a.id, { status: "done", videoUrl: url });
              preview({
                kind: "video",
                src: url,
                aspect: a.aspectRatio,
                label: `${a.modelLabel} · done`,
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
        <div className="flow-kind-pick fade">
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
                desc: "Pick a reference video's choreography, confirm a look, and have them perform it (Seedance 2.0 · opens with a working template).",
              },
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
                    (opt.kind === "transfer" || !f.motionPrompt.trim()),
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
          {/* opened by mistake? close without creating anything */}
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

      {/* ── MOVES stage (transfer flows only) ───── */}
      {activeStage === "moves" && (
        <section className={`flow-stage ${flow.refClip ? "locked" : ""}`}>
          <div className="flow-stage-head">
            <span className="spec-head">
              STAGE 1 · MOVES — THE REFERENCE {flow.refClip ? "· SET ✓" : ""}
            </span>
            <span className="flow-engine mono">
              tip: depth-render references carry pure motion, zero identity bleed
            </span>
          </div>
          <p className="flow-locked-hint">
            {flow.refClip
              ? "Click another to switch, click the selected one to replay it in the frame."
              : "Pick the clip whose motion gets performed — ≤15s (Seedance's reference cap). GRAB from the Library (⤓ pulls YouTube/X with a m:ss trim), or upload a local file."}
          </p>
          {/* candidates STAY visible after picking — the chosen one
              highlights (▶ + sel), so with many similar references it's
              always obvious which is live */}
          <div className="chips-row" style={{ flexWrap: "wrap", paddingTop: 8 }}>
            {(() => {
              // Top 6, but the selected clip always stays in view even if
              // it has scrolled out of the recency window.
              const shown = libClips.slice(0, 6);
              const sel = flow.refClip
                ? libClips.find((c) => c.videoUrl === flow.refClip!.url)
                : null;
              return sel && !shown.includes(sel) ? [sel, ...shown.slice(0, 5)] : shown;
            })().map((c) => {
              const raw = (c.note ?? c.prompt ?? c.jobId) || c.jobId;
              // Every Library note starts "Reference · " — drop the shared
              // prefix so the distinctive part survives truncation.
              const label = raw.replace(/^Reference · /, "");
              const isSel = flow.refClip?.url === c.videoUrl;
              return (
                <button
                  key={c.jobId}
                  className={`spec-chip ${isSel ? "sel" : ""}`}
                  title={raw}
                  onClick={() => {
                    if (!isSel) {
                      patchFlow(flow.id, {
                        refClip: { url: c.videoUrl!, label: label.slice(0, 60) },
                      });
                    }
                    preview({
                      kind: "video",
                      src: c.videoUrl!,
                      aspect: flow.aspect,
                      label: "MOVES reference",
                    });
                  }}
                >
                  {isSel ? "▶ " : ""}
                  {label.slice(0, 34)}
                </button>
              );
            })}
            <button
              className="spec-chip"
              disabled={uploadBusy}
              onClick={() => refFileRef.current?.click()}
            >
              {uploadBusy ? "UPLOADING…" : "↥ Upload a video"}
            </button>
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
            {isTransfer ? "STAGE 2 · IMAGE (OPTIONAL)" : "STAGE 1 · STILL"} — THE LOOK{" "}
            {confirmedImgs.length
              ? isTransfer
                ? `· ${confirmedImgs.length} SELECTED ✓`
                : "· CONFIRMED ✓"
              : ""}
          </span>
          {isTransfer && (
            <span className="flow-engine mono">
              OPTIONAL — or describe the character in the prompt (no image → no real-person filter). A photoreal look gets blocked; a stylized one (anime/3DCG) works.
            </span>
          )}
        </div>

        {/* One carousel to PICK from: this flow's own generated looks
            (newest first) + looks reused from other flows/cards. A selected
            look STAYS in the carousel with a ✓ badge (owner call — it used
            to vanish into the chip tray); clicking it again unselects. */}
        {(() => {
          const attemptImgs = new Set(flow.imgAttempts.map((a) => a.image));
          const pickAttempts = [...flow.imgAttempts].reverse();
          const pickShared = sharedLooks.filter((l) => !attemptImgs.has(l.image));
          if (!pickAttempts.length && !pickShared.length) return null;
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
                a.prompt.trim().length >= 12 &&
                !/^\((uploaded|shared)/.test(a.prompt.trim());
              const asText = (flow.textLookIds ?? []).includes(a.id);
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
                          ? "Sent as TEXT (this look's prompt). Click to send the IMAGE instead."
                          : "Sent as the IMAGE. Click to send its PROMPT as text (avoids Seedance's real-person filter)."
                      }
                      onClick={() => toggleLookText(a)}
                    >
                      {asText ? "↳ text" : "🖼 image"}
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

        {(!confirmedImg || editFrom || isTransfer) && (
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
              ? "Seedance 2.0 family — reference ≤15s; Mini is cheapest"
              : "recommended: Kling 3.0 (most natural motion per dollar)"}
          </span>
        </div>

        {isTransfer && confirmedImgs.length > 1 && (
          <p className="flow-locked-hint" style={{ marginBottom: 12 }}>
            {confirmedImgs.length} looks selected — in the prompt, refer to
            them in order (&quot;the first reference person… the second…&quot;)
            and say where each one is (left / right) so the clip&apos;s
            dancers map to the right identity.
          </p>
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
                        isTransfer ? TRANSFER_PRESETS : MOTION_PRESETS,
                        flow.motionPrompt,
                      ),
                    })
                  }
                  title={
                    isTransfer
                      ? "Cycle transfer templates — plain vs green-screen composite"
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
          ← 이전
        </button>
        {activeStage === "motion" ? (
          <button
            className="btn-primary wiz-animate"
            disabled={!animateReady || rendering}
            onClick={() => void generateMotion()}
            title={
              animateReady
                ? undefined
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
            다음 →
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
