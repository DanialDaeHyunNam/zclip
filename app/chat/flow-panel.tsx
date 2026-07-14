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
  kind: "image" | "video";
  src: string;
  aspect: AspectRatio;
  label: string;
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

interface Flow {
  id: string;
  title: string;
  createdAt: number;
  /** Chat session this flow belongs to — a flow is a METHOD used inside
   *  a session, not a parallel world. Legacy flows (undefined) show in
   *  every session. */
  sessionId?: string;
  imgEngine?: string;
  imgPrompt: string;
  imgAttempts: FlowImageAttempt[];
  confirmedImgId: string | null;
  motionPrompt: string;
  motionModelKey: string;
  motionAttempts: FlowMotionAttempt[];
  aspect: AspectRatio;
  duration: number;
  resolution: Resolution;
}

const newFlow = (n: number, sessionId?: string): Flow => ({
  id: `f${Date.now()}`,
  title: `Flow ${n}`,
  createdAt: Date.now(),
  sessionId,
  imgEngine: "grok",
  imgPrompt: "",
  imgAttempts: [],
  confirmedImgId: null,
  motionPrompt: "",
  motionModelKey: "kling", // the recommended "make it move" engine
  motionAttempts: [],
  aspect: "9:16",
  duration: 5,
  resolution: "720p",
});

/** i2v-capable models only — Act-Two needs a driving video, not a still. */
const MOTION_MODELS = MODELS.filter((m) => !m.transferOnly);

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

export function FlowPanel({
  onPreview,
  sessionId,
}: {
  /** Surface an image/video in the studio's shared left frame. */
  onPreview: (p: FlowPreview | null) => void;
  /** Current chat session — flows are scoped to it (legacy flows without
   *  a sessionId stay visible everywhere). */
  sessionId: string | null;
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

  /* flows scoped to the current session (legacy flows show everywhere) */
  const visibleFlows = flows.filter(
    (f) => !f.sessionId || !sessionId || f.sessionId === sessionId,
  );
  const flow = visibleFlows.find((f) => f.id === flowId) ?? null;

  /* keep the selection inside the current session's flows */
  useEffect(() => {
    if (flow || !hydrated) return;
    const last = visibleFlows[visibleFlows.length - 1];
    if (last) {
      setFlowId(last.id);
    } else {
      const f = newFlow(1, sessionId ?? undefined);
      setFlows((fs) => [...fs, f]);
      setFlowId(f.id);
    }
    setEditFrom(null);
  }, [sessionId, flow, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps
  const motionModel = resolveModel(flow?.motionModelKey ?? "kling");
  const imgEngine =
    IMG_ENGINES.find((e) => e.key === (flow?.imgEngine ?? "grok")) ??
    IMG_ENGINES[0];
  const confirmedImg =
    flow?.imgAttempts.find((a) => a.id === flow.confirmedImgId) ?? null;
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
          setFlows(list);
          setFlowId(list[list.length - 1].id);
        } else {
          const f = newFlow(1);
          setFlows([f]);
          setFlowId(f.id);
        }
      } catch {
        const f = newFlow(1);
        setFlows([f]);
        setFlowId(f.id);
      }
      setHydrated(true);
    })();
  }, []);

  /* persist */
  useEffect(() => {
    if (!hydrated) return;
    store.set(FLOWS_KEY, JSON.stringify(flows));
  }, [flows, hydrated]);

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

  /* ── stage 1: still generation ─────────────────── */

  const generateImage = async () => {
    if (!flow || !flow.imgPrompt.trim() || busyImg) return;
    setArmed(null);
    setBusyImg(true);
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
      onPreview({
        kind: "image",
        src: attempt.image,
        aspect: flow.aspect,
        label: `${imgEngine.label} · draft`,
      });
    } catch {
      setError("Network error — try again");
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
      onPreview({
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

  /* ── stage 2: motion generation (i2v on the confirmed still) ── */

  const generateMotion = async () => {
    if (!flow || !confirmedImg || !flow.motionPrompt.trim()) return;
    setArmed(null);
    setError(null);
    const m = resolveModel(flow.motionModelKey);
    const { base64, mimeType } = splitDataUrl(confirmedImg.image);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: headers(m.envVar),
        body: JSON.stringify({
          prompt: flow.motionPrompt,
          provider: m.provider,
          modelId: m.modelId,
          aspectRatio: flow.aspect,
          durationSeconds: flow.duration,
          resolution: flow.resolution,
          image: { base64, mimeType },
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        setError(b.error ?? "Submit failed");
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
    } catch {
      setError("Network error — try again");
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
                error: b.error ?? "Render failed",
              });
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
              onPreview({
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
                    variantLabel: a.modelLabel,
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

  if (!hydrated || !flow) return <div className="flow-panel" />;

  return (
    <div className="flow-panel fade">
      <div className="flow-tabs">
        {visibleFlows.map((f) => (
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
        <button
          className="spec-chip"
          onClick={() => {
            // an untouched flow is reused instead of stacking clones
            const empty = visibleFlows.find(
              (f) =>
                !f.imgAttempts.length &&
                !f.motionAttempts.length &&
                !f.imgPrompt.trim() &&
                !f.motionPrompt.trim(),
            );
            if (empty) {
              setFlowId(empty.id);
              return;
            }
            const f = newFlow(visibleFlows.length + 1, sessionId ?? undefined);
            setFlows((fs) => [...fs, f]);
            setFlowId(f.id);
          }}
        >
          ＋ New flow
        </button>
      </div>
      <p className="flow-sub">
        Confirm the LOOK once, then iterate the MOTION forever — the still
        never re-rolls. Finished takes land in the Library; a confirmed
        still can become a Character card.
      </p>

      {error && <div className="error-box fade">{error}</div>}

      {/* ── Stage 1 · STILL ─────────────────────────── */}
      <section className={`flow-stage ${confirmedImg ? "locked" : ""}`}>
        <div className="flow-stage-head">
          <span className="spec-head">
            STAGE 1 · STILL — THE LOOK {confirmedImg ? "· CONFIRMED ✓" : ""}
          </span>
        </div>

        {(!confirmedImg || editFrom) && (
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

        {flow.imgAttempts.length > 0 && (
          <div className="flow-thumbs">
            {flow.imgAttempts.map((a) => (
              <button
                key={a.id}
                className={`flow-thumb ${flow.confirmedImgId === a.id ? "sel" : ""}`}
                onClick={() => {
                  patchFlow(flow.id, {
                    confirmedImgId:
                      flow.confirmedImgId === a.id ? null : a.id,
                  });
                  onPreview({
                    kind: "image",
                    src: a.image,
                    aspect: flow.aspect,
                    label:
                      flow.confirmedImgId === a.id
                        ? "still · unconfirmed"
                        : "still · CONFIRMED",
                  });
                }}
                title={
                  flow.confirmedImgId === a.id
                    ? "Confirmed — click to unconfirm"
                    : "Click to CONFIRM this look"
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.image} alt="" />
                {flow.confirmedImgId === a.id && (
                  <span className="flow-thumb-tag">CONFIRMED</span>
                )}
                <span
                  role="button"
                  className="flow-thumb-edit"
                  title="Edit from this look — same person, describe only the change (outfit, background…)"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditFrom(a);
                    patchFlow(flow.id, { imgPrompt: "" });
                  }}
                >
                  ✎
                </span>
              </button>
            ))}
          </div>
        )}

        {confirmedImg && (
          <div className="flow-confirm-row">
            <button className="link-btn" onClick={saveAsCard}>
              {savedCard
                ? "✓ Saved as Character card"
                : "＋ Save as Character card (use in chat)"}
            </button>
            <button
              className="link-btn"
              onClick={() => patchFlow(flow.id, { confirmedImgId: null })}
            >
              ✎ Change look
            </button>
          </div>
        )}
      </section>

      {/* ── Stage 2 · MOTION ────────────────────────── */}
      <section className={`flow-stage ${confirmedImg ? "" : "disabled"}`}>
        <div className="flow-stage-head">
          <span className="spec-head">STAGE 2 · MOTION — MAKE IT MOVE</span>
          <span className="flow-engine mono">
            recommended: Kling 3.0 (most natural motion per dollar)
          </span>
        </div>

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
              {MOTION_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.short}
                  {m.key === "kling" ? " ★" : ""}
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

        {confirmedImg ? (
          <>
            <div className="flow-gen-row">
              <textarea
                rows={2}
                value={flow.motionPrompt}
                onChange={(e) =>
                  patchFlow(flow.id, { motionPrompt: e.target.value })
                }
                placeholder="Describe ONLY the motion — 'subtle breathing, slow blink, hair moving in a soft breeze, a small head tilt and a smile at the lens'"
              />
              <div className="flow-gen-actions">
                <button
                  className="btn-primary flow-btn"
                  disabled={!flow.motionPrompt.trim()}
                  onClick={() =>
                    armed === "motion"
                      ? void generateMotion()
                      : setArmed("motion")
                  }
                >
                  {armed === "motion"
                    ? `Confirm · ${motionModel.short} · ${fmtCost(motionCost ?? undefined) ?? "$?"}`
                    : "Animate"}
                </button>
                <button
                  className="link-btn"
                  onClick={() =>
                    patchFlow(flow.id, {
                      motionPrompt: randomFrom(
                        MOTION_PRESETS,
                        flow.motionPrompt,
                      ),
                    })
                  }
                  title="Fill with a random motion draft — edit from there"
                >
                  🎲 Random
                </button>
              </div>
            </div>

            {flow.motionAttempts.length > 0 && (
              <div className="flow-takes">
                {flow.motionAttempts.map((a) => (
                  <div
                    key={a.id}
                    className="flow-take"
                    onClick={() =>
                      a.videoUrl &&
                      onPreview({
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
                    <p className="flow-take-prompt">{a.prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="flow-locked-hint">
            Confirm a look in Stage 1 first — then iterate motion here as
            many times as you want without touching the still.
          </p>
        )}
      </section>

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
                  onPreview(null);
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
