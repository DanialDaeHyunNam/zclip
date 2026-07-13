"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MODELS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  resolveModel,
  effectiveSeconds,
  estimateModelCost,
  type AspectRatio,
  type Resolution,
} from "@/lib/config";
import * as store from "@/lib/store";
import { Rail } from "../rail";
import {
  type Clip,
  fmtCost,
  GALLERY_KEY,
  PW_KEY,
} from "@/lib/clip";
import { persistRemoteVideo } from "@/lib/persist-clip";

/**
 * FLOW method — the pipeline alternative to the chat loop (owner spec,
 * 2026-07-13, inspired by the still→motion AI-influencer pipelines):
 *
 *   Stage 1 · STILL  — generate/upload the look, iterate, CONFIRM one.
 *   Stage 2 · MOTION — animate the confirmed still (i2v), iterate the
 *                      motion endlessly while the still stays locked.
 *
 * Interop with the chat method (deliberate, both directions):
 *  - finished motion takes are vaulted + appended to the SHARED gallery
 *    (they show up in the Library like any chat take, sessionId = flow id);
 *  - a confirmed still can be saved as a custom Character card
 *    (hooklab.customAssets) and used in the chat studio immediately.
 * State lives in `hooklab.flows` via lib/store (file-backed, port-proof).
 */

const FLOWS_KEY = "hooklab.flows";
const IMG_COST = 0.05; // Grok image step, $/shot (config note)

interface FlowImageAttempt {
  id: string;
  prompt: string;
  /** dataURL — the file-backed store has no 5MB quota problem. */
  image: string;
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

const newFlow = (n: number): Flow => ({
  id: `f${Date.now()}`,
  title: `Flow ${n}`,
  createdAt: Date.now(),
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

export function FlowStudio() {
  const router = useRouter();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busyImg, setBusyImg] = useState(false);
  const [armed, setArmed] = useState<"img" | "motion" | null>(null);
  /** Two-click tab delete (browser confirm dialogs are banned). */
  const [delArm, setDelArm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const flow = flows.find((f) => f.id === flowId) ?? null;
  const motionModel = resolveModel(flow?.motionModelKey ?? "kling");
  const confirmedImg =
    flow?.imgAttempts.find((a) => a.id === flow.confirmedImgId) ?? null;
  const effSecs = flow
    ? effectiveSeconds(motionModel.provider, flow.duration, flow.resolution)
    : 5;
  const motionCost = flow
    ? estimateModelCost(motionModel, flow.resolution, flow.duration)
    : null;

  const headers = useCallback((): Record<string, string> => {
    const pw = storedPw();
    return {
      "content-type": "application/json",
      ...(pw ? { "x-app-password": pw } : {}),
    };
  }, []);

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
        headers: headers(),
        body: JSON.stringify({ prompt: flow.imgPrompt }),
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
        // a fresh look is auto-selected but NOT confirmed
        confirmedImgId: f.confirmedImgId,
      }));
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
      patchFlow(flow.id, (f) => ({
        imgAttempts: [...f.imgAttempts, attempt],
      }));
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
      const characters = Array.isArray(cur.characters) ? cur.characters : [];
      characters.push({
        id: `flow-${confirmedImg.id}`,
        label: flow.title.slice(0, 24),
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
    const attemptId = `m${Date.now()}`;
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: headers(),
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
        id: attemptId,
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
              { headers: headers() },
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
              // vault first (provider URLs die in ~a day), then share to
              // the common gallery so the Library sees it like any take
              const local = await persistRemoteVideo(
                a.jobId,
                a.provider,
                b.videoUrl,
                headers(),
              );
              const url = local ?? b.videoUrl;
              patchAttempt(f.id, a.id, { status: "done", videoUrl: url });
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
  }, [flows, hydrated, headers, patchAttempt]);

  if (!hydrated || !flow) {
    return <main className="flow-root" />;
  }

  return (
    <>
      <Rail
        active="flow"
        onHome={() => router.push("/chat")}
        onDashboard={() => router.push("/dashboard")}
        onSessions={() => router.push("/chat")}
        onArchive={() => router.push("/archive")}
        onGrab={() => router.push("/archive")}
        onFlow={() => {}}
      />
      <main className="flow-root">
        <div className="flow-head">
          <span className="label">Flow — still → motion pipeline</span>
          <div className="flow-tabs">
            {flows.map((f) => (
              <button
                key={f.id}
                className={`spec-chip ${f.id === flowId ? "sel" : ""}`}
                onClick={() => {
                  setFlowId(f.id);
                  setDelArm(null);
                }}
              >
                {f.title}
                <span
                  role="button"
                  className={`flow-del ${delArm === f.id ? "armed" : ""}`}
                  title={
                    delArm === f.id
                      ? "Click again to delete (finished takes stay in the Library)"
                      : "Delete this flow"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (delArm !== f.id) {
                      setDelArm(f.id);
                      return;
                    }
                    setDelArm(null);
                    setFlows((fs) => {
                      const rest = fs.filter((x) => x.id !== f.id);
                      const next = rest.length ? rest : [newFlow(1)];
                      if (flowId === f.id) setFlowId(next[next.length - 1].id);
                      return next;
                    });
                  }}
                >
                  {delArm === f.id ? "✕?" : "✕"}
                </span>
              </button>
            ))}
            <button
              className="spec-chip"
              onClick={() => {
                // an untouched flow is reused instead of stacking clones
                const empty = flows.find(
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
                const f = newFlow(flows.length + 1);
                setFlows((fs) => [...fs, f]);
                setFlowId(f.id);
              }}
            >
              ＋ New flow
            </button>
            <button
              className="link-btn"
              onClick={() => router.push("/chat")}
              title="The conversational method — refine or SPEC-interview each take"
            >
              ↔ Chat method
            </button>
          </div>
        </div>
        <p className="flow-sub">
          Confirm the LOOK once, then iterate the MOTION forever — the still
          never re-rolls. Finished takes land in the shared Library; a
          confirmed still can become a Character card for the chat studio.
        </p>

        {error && <div className="error-box fade">{error}</div>}

        {/* ── Stage 1 · STILL ─────────────────────────── */}
        <section className={`flow-stage ${confirmedImg ? "locked" : ""}`}>
          <div className="flow-stage-head">
            <span className="spec-head">
              STAGE 1 · STILL — THE LOOK{" "}
              {confirmedImg ? "· CONFIRMED ✓" : ""}
            </span>
            <span className="flow-engine mono">
              Grok Imagine image · ~$0.05/shot · or upload your own
            </span>
          </div>

          {!confirmedImg && (
            <div className="flow-gen-row">
              <textarea
                rows={2}
                value={flow.imgPrompt}
                onChange={(e) =>
                  patchFlow(flow.id, { imgPrompt: e.target.value })
                }
                placeholder="Describe the person/look — e.g. 'Korean idol in her 20s, dewy glass skin, pink slip dress, dressing-room vanity light, photoreal 9:16 portrait'"
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
                      ? `Confirm · ~$${IMG_COST.toFixed(2)}`
                      : "Generate look"}
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
          )}

          {flow.imgAttempts.length > 0 && (
            <div className="flow-thumbs">
              {flow.imgAttempts.map((a) => (
                <button
                  key={a.id}
                  className={`flow-thumb ${flow.confirmedImgId === a.id ? "sel" : ""}`}
                  onClick={() =>
                    patchFlow(flow.id, {
                      confirmedImgId:
                        flow.confirmedImgId === a.id ? null : a.id,
                    })
                  }
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
                </button>
              ))}
            </div>
          )}

          {confirmedImg && (
            <div className="flow-confirm-row">
              <button className="link-btn" onClick={saveAsCard}>
                {savedCard ? "✓ Saved as Character card" : "＋ Save as Character card (use in chat)"}
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
            <span className="spec-head">
              STAGE 2 · MOTION — MAKE IT MOVE
            </span>
            <span className="flow-engine mono">
              recommended: Kling 3.0 (most natural motion per dollar)
            </span>
          </div>

          {/* model/params are ALWAYS visible & editable — pick the motion
              engine before or after confirming the look */}
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
                      patchFlow(flow.id, {
                        aspect: e.target.value as AspectRatio,
                      })
                    }
                  >
                    {ASPECT_RATIOS.map((a) => (
                      <option key={a} value={a}>{a}</option>
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
                      <option key={r} value={r}>{r}</option>
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
                      patchFlow(flow.id, {
                        duration: Number(e.target.value) || 5,
                      })
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
                  placeholder="Describe ONLY the motion — 'subtle breathing, slow blink, hair moving in a soft breeze, she tilts her head and smiles at the lens'"
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
                </div>
              </div>

              {flow.motionAttempts.length > 0 && (
                <div className="flow-takes">
                  {flow.motionAttempts.map((a) => (
                    <div key={a.id} className="flow-take">
                      <div className="spec-head">
                        {a.modelLabel.toUpperCase()} · {a.durationSeconds}s ·{" "}
                        {a.status.toUpperCase()}
                        {fmtCost(a.costUsd) ? ` · ${fmtCost(a.costUsd)}` : ""}
                      </div>
                      {a.status === "pending" && (
                        <div className="spec-busy">
                          <span className="dot live" /> RENDERING — lands in
                          the Library automatically
                        </div>
                      )}
                      {a.status === "error" && (
                        <div className="turn-error">{a.error}</div>
                      )}
                      {a.videoUrl && (
                        <video
                          src={a.videoUrl}
                          controls
                          playsInline
                          style={{ width: "100%", borderRadius: "var(--r-sm)" }}
                        />
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
      </main>
    </>
  );
}
