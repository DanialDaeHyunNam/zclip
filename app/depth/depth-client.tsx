"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PW_KEY, PENDING_DEPTH_KEY } from "@/lib/clip";
import { useHosted } from "@/lib/use-version";
import { extractDepthVideo, probeWebGpu } from "@/lib/depth-extract";

/**
 * Depth Video Extractor — the standalone UI over lib/depth-extract (the
 * shared engine the transfer flow's automatic depth pass also uses). Turns
 * any short clip into a depth-map video ENTIRELY in the browser: no server,
 * no API key, $0. Since the flow's ANIMATE now runs the depth pass
 * automatically, this page is for manual/preview/one-off use — tuning the
 * style knobs, checking what a reference looks like as depth, or batch
 * prepping Library refs.
 *
 * Handoff contract: this page NEVER touches lib/store (a second tab's
 * full-cache flush would clobber the studio tab). Saving writes the vault
 * file via /api/clips, then parks a pointer in plain localStorage
 * (PENDING_DEPTH_KEY); the studio tab adopts it on focus.
 */

type Phase = "idle" | "model" | "processing" | "encoding" | "done" | "error";

interface Loaded {
  url: string;
  label: string;
  duration: number;
  width: number;
  height: number;
}

const MAX_SIDES = [512, 768, 1024] as const;
const FPS_OPTIONS = [24, 30] as const;

const storedPw = (): string | null => {
  try {
    const raw = localStorage.getItem(PW_KEY);
    return raw ? raw.replace(/^"|"$/g, "") : null;
  } catch {
    return null;
  }
};

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function DepthClient() {
  const hosted = useHosted();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [pct, setPct] = useState(0);
  const [frameNote, setFrameNote] = useState("");
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "busy" | "saved" | "failed">("idle");
  const [webgpu, setWebgpu] = useState<boolean | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // settings
  // 1024 default — Seedance's r2v reference floor is 409,600 px, which a
  // 768-long-side 9:16 clip (432×768) misses.
  const [maxSide, setMaxSide] = useState<(typeof MAX_SIDES)[number]>(1024);
  const [fps, setFps] = useState<(typeof FPS_OPTIONS)[number]>(30);
  const [style, setStyle] = useState<"grayscale" | "inferno">("grayscale");
  const [nearWhite, setNearWhite] = useState(true);
  const [smoothing, setSmoothing] = useState(0.35);
  // Local-contrast boost so faces/hands survive the depth flattening —
  // 1.2 default matches the flow's +EXPRESSION mode.
  const [detail, setDetail] = useState(1.2);
  const [model, setModel] = useState<"small" | "base">("small");

  const videoRef = useRef<HTMLVideoElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const outVideoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const srcBlobRef = useRef<Blob | null>(null);
  /** The Library url this clip was fetched FROM (?src=) — rides the
   *  handoff as the depth clip's soundtrack source (a depth video is
   *  silent; its original speaks for it). */
  const srcUrlRef = useRef<string | null>(null);
  const outBlobRef = useRef<Blob | null>(null);
  const outExtRef = useRef<"mp4" | "webm">("mp4");
  const flowIdRef = useRef<string | null>(null);

  const log = useCallback((s: string) => {
    setLines((ls) => [...ls.slice(-7), s]);
  }, []);

  useEffect(() => {
    void probeWebGpu().then(setWebgpu);
  }, []);

  const adoptFile = useCallback((file: File | Blob, label: string) => {
    const url = URL.createObjectURL(file);
    srcBlobRef.current = file;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      setLoaded({
        url,
        label,
        duration: probe.duration,
        width: probe.videoWidth,
        height: probe.videoHeight,
      });
      setOutUrl(null);
      outBlobRef.current = null;
      setSaveState("idle");
      setPhase("idle");
      setPct(0);
      setLines([
        `loaded: ${label} — ${probe.videoWidth}×${probe.videoHeight}, ${fmtClock(probe.duration)}`,
      ]);
    };
    probe.onerror = () => log("could not read that file as a video");
    probe.src = url;
  }, [log]);

  /* ?src=/api/clips?f=… — arrive pre-loaded from the studio's MOVES stage. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const src = q.get("src");
    flowIdRef.current = q.get("flow");
    if (!src || !src.startsWith("/api/")) return;
    srcUrlRef.current = src;
    const label = q.get("label") || "studio clip";
    const pw = storedPw();
    log(`fetching from the Library: ${label} …`);
    fetch(src, { headers: pw ? { "x-app-password": pw } : {} })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => adoptFile(b, label))
      .catch((e) =>
        log(`Library fetch failed (${e instanceof Error ? e.message : "error"}) — pick the file manually`),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    const srcBlob = srcBlobRef.current;
    const outCanvas = outCanvasRef.current;
    if (!loaded || !srcBlob || !outCanvas || phase === "processing" || phase === "model") return;
    abortRef.current = false;
    setOutUrl(null);
    outBlobRef.current = null;
    setSaveState("idle");
    setPhase("model");

    try {
      const outCtx = outCanvas.getContext("2d")!;
      const result = await extractDepthVideo(srcBlob, {
        fps,
        maxSide,
        // Seedance's r2v floor — small sources upscale past it so a saved
        // depth ref never bounces at submit.
        minPixels: 480_000,
        smoothing,
        nearWhite,
        style,
        detail,
        model,
        onLog: log,
        isCanceled: () => abortRef.current,
        onProgress: (p) => {
          setPhase((cur) => (cur === "model" ? "processing" : cur));
          setPct(p.pct);
          setFrameNote(p.note);
        },
        onFrame: (canvas) => {
          if (outCanvas.width !== canvas.width || outCanvas.height !== canvas.height) {
            outCanvas.width = canvas.width;
            outCanvas.height = canvas.height;
          }
          outCtx.drawImage(canvas, 0, 0);
          // The seek loop runs on the engine's own hidden element — mirror
          // the timeline on the visible input player so processing is
          // visibly stepping through the source.
          const v = videoRef.current;
          if (v && loaded) {
            const t = Math.min((v.duration || loaded.duration), v.currentTime + 1 / fps);
            if (Number.isFinite(t)) v.currentTime = t;
          }
        },
      });

      if (result.canceled || !result.blob) {
        setPhase("idle");
        setPct(0);
        setFrameNote("");
        return;
      }
      outExtRef.current = result.container;
      outBlobRef.current = result.blob;
      setOutUrl(URL.createObjectURL(result.blob));
      setPhase("done");
      setFrameNote("");
    } catch (e) {
      setPhase("error");
      log(`FAULT: ${e instanceof Error ? e.message : "processing failed"}`);
    }
  };

  const cancel = () => {
    abortRef.current = true;
  };

  /** Vault the depth clip (dev-only /api/clips), then park the pointer for
   *  the studio tab to adopt on focus — Library entry + MOVES reference. */
  const saveToLibrary = async () => {
    const blob = outBlobRef.current;
    if (!blob || !loaded || saveState === "busy") return;
    setSaveState("busy");
    try {
      const pw = storedPw();
      const fd = new FormData();
      fd.append(
        "file",
        new File([blob], `depth.${outExtRef.current}`, { type: `video/${outExtRef.current}` }),
      );
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: pw ? { "x-app-password": pw } : {},
        body: fd,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "save failed");
      const baseLabel = loaded.label.replace(/ · .*$/, "").slice(0, 48);
      localStorage.setItem(
        PENDING_DEPTH_KEY,
        JSON.stringify({
          jobId: b.name,
          url: b.url,
          label: `depth · ${baseLabel}`,
          flowId: flowIdRef.current,
          // The original's Library url — the depth clip's soundtrack source.
          audioUrl: srcUrlRef.current ?? undefined,
          aspect: loaded.height >= loaded.width ? "9:16" : "16:9",
          durationSeconds: Math.round(loaded.duration),
        }),
      );
      setSaveState("saved");
      log("saved to the Library — switch to the studio tab and it lands in MOVES automatically");
    } catch (e) {
      setSaveState("failed");
      log(`save failed: ${e instanceof Error ? e.message : "error"}`);
    }
  };

  const playBoth = () => {
    const a = videoRef.current;
    const b = outVideoRef.current;
    if (!a || !b) return;
    a.currentTime = 0;
    b.currentTime = 0;
    void a.play();
    void b.play();
  };

  const busy = phase === "model" || phase === "processing" || phase === "encoding";
  const statusLine =
    phase === "idle"
      ? loaded
        ? "ready — press Start (the first run downloads the model, then it's cached in this browser)"
        : "waiting — pick a video (the first run downloads the AI model; it's cached in this browser afterwards)"
      : phase === "model"
        ? "loading model …"
        : phase === "processing"
          ? frameNote || "processing …"
          : phase === "encoding"
            ? "finalizing …"
            : phase === "done"
              ? "done — preview on the right, Download or Save to Library below"
              : "failed — see the log below";

  return (
    <div className="depth-root">
      <header className="depth-head">
        <div className="depth-brand">
          <span className="depth-kicker mono">ZCLIP · MOVES TOOL</span>
          <h1 className="depth-title">Depth Video Extractor</h1>
        </div>
        <span className="depth-chip mono">LOCAL ONLY</span>
        <span className="depth-chip mono">NO API · $0</span>
        <div className="depth-spacer" />
        <button
          className="depth-chip mono depth-chip-btn"
          disabled={!outUrl}
          onClick={playBoth}
          title="play the source and the depth result together"
        >
          ⛓ PLAY BOTH
        </button>
        <a className="depth-chip mono" href="/chat">
          ← STUDIO
        </a>
      </header>

      <main className="depth-grid">
        {/* INPUT */}
        <section className="depth-panel">
          <div className="depth-panel-head">
            <span className="spec-head">INPUT — SOURCE VIDEO</span>
            <span className="depth-badge mono">
              {loaded
                ? `${loaded.width}×${loaded.height} · ${fmtClock(loaded.duration)}`
                : "no video"}
            </span>
          </div>
          <div
            className={`depth-frame ${dragOver ? "drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && /^video\//.test(f.type)) adoptFile(f, f.name);
            }}
          >
            <video
              ref={videoRef}
              className="depth-media"
              style={{ display: loaded ? "block" : "none" }}
              src={loaded?.url}
              muted
              playsInline
              controls={!busy}
            />
            {!loaded && (
              <div className="depth-placeholder">
                <p>drag a video here, or use [Choose video…] below</p>
                <p className="mono dim">mp4 / webm / mov</p>
              </div>
            )}
          </div>
          <div className="depth-actions">
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              Choose video…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) adoptFile(f, f.name);
                e.target.value = "";
              }}
            />
          </div>
        </section>

        {/* OUTPUT */}
        <section className="depth-panel">
          <div className="depth-panel-head">
            <span className="spec-head">OUTPUT — DEPTH VIDEO</span>
            <span className="depth-badge mono">
              {phase === "done" ? `ready · ${fps}fps` : busy ? `${pct}%` : "waiting"}
            </span>
          </div>
          <div className="depth-frame">
            <canvas
              ref={outCanvasRef}
              className="depth-media"
              style={{ display: busy && phase !== "model" ? "block" : "none" }}
            />
            {outUrl && (
              <video
                ref={outVideoRef}
                className="depth-media"
                src={outUrl}
                muted
                playsInline
                controls
                loop
              />
            )}
            {!busy && !outUrl && (
              <div className="depth-placeholder">
                <p>press Start and the frames render here live</p>
              </div>
            )}
          </div>
          <div className="depth-actions">
            {outUrl && (
              <a className="btn-ghost" href={outUrl} download={`depth.${outExtRef.current}`}>
                ⤓ Download {outExtRef.current}
              </a>
            )}
            {outUrl && !hosted && (
              <button
                className="btn-ghost"
                onClick={() => void saveToLibrary()}
                disabled={saveState === "busy" || saveState === "saved"}
              >
                {saveState === "busy"
                  ? "SAVING…"
                  : saveState === "saved"
                    ? "✓ In the Library"
                    : saveState === "failed"
                      ? "↻ Retry save"
                      : "▦ Save to Library → FLOW"}
              </button>
            )}
          </div>
        </section>

        {/* SETTINGS */}
        <aside className="depth-rail">
          <div className="depth-group">
            <div className="spec-head">MODEL</div>
            <div className="depth-row">
              <span className="label">Depth model</span>
              <select
                value={model}
                disabled={busy}
                onChange={(e) => setModel(e.target.value as "small" | "base")}
              >
                <option value="small">DA V2 Small — ~50MB, fast</option>
                <option value="base">DA V2 Base — ~370MB, more face detail</option>
              </select>
            </div>
            <div className="depth-row">
              <span className="label">Accel</span>
              <span className="mono depth-fixed">
                {webgpu == null ? "…" : webgpu ? "WebGPU ✓" : "WASM (slow — use Chrome for WebGPU)"}
              </span>
            </div>
          </div>

          <div className="depth-group">
            <div className="spec-head">PROCESSING</div>
            <div className="depth-row">
              <span className="label">Resolution (long side)</span>
              <select
                value={maxSide}
                disabled={busy}
                onChange={(e) => setMaxSide(Number(e.target.value) as (typeof MAX_SIDES)[number])}
              >
                {MAX_SIDES.map((s) => (
                  <option key={s} value={s}>
                    {s}px{s === 1024 ? " (Seedance-ready)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="depth-row">
              <span className="label">Output FPS</span>
              <select
                value={fps}
                disabled={busy}
                onChange={(e) => setFps(Number(e.target.value) as (typeof FPS_OPTIONS)[number])}
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}{f === 30 ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="depth-group">
            <div className="spec-head">DEPTH STYLE</div>
            <div className="depth-row">
              <span className="label">Style</span>
              <select
                value={style}
                disabled={busy}
                onChange={(e) => setStyle(e.target.value as "grayscale" | "inferno")}
              >
                <option value="grayscale">Grayscale</option>
                <option value="inferno">Inferno</option>
              </select>
            </div>
            <div className="depth-row">
              <span className="label">Depth direction</span>
              <select
                value={nearWhite ? "1" : "0"}
                disabled={busy}
                onChange={(e) => setNearWhite(e.target.value === "1")}
              >
                <option value="1">near = white</option>
                <option value="0">near = black</option>
              </select>
            </div>
            <div className="depth-row">
              <span className="label">Expression detail</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={detail}
                disabled={busy}
                onChange={(e) => setDetail(Number(e.target.value))}
              />
              <span className="mono depth-num">{detail.toFixed(1)}</span>
            </div>
            <div className="depth-row">
              <span className="label">Temporal smoothing</span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={smoothing}
                disabled={busy}
                onChange={(e) => setSmoothing(Number(e.target.value))}
              />
              <span className="mono depth-num">{smoothing.toFixed(2)}</span>
            </div>
          </div>

          <div className="depth-start-row">
            <button
              className="btn-primary depth-start"
              onClick={() => void run()}
              disabled={!loaded || busy}
            >
              {busy ? `▸ ${pct}%` : "▸ Start"}
            </button>
            <button className="btn-ghost" onClick={cancel} disabled={!busy}>
              Cancel
            </button>
          </div>
        </aside>
      </main>

      <div className="depth-progress">
        <div className="depth-progress-fill" style={{ width: `${busy || phase === "done" ? pct : 0}%` }} />
      </div>
      <p className="depth-statusline mono">{statusLine}</p>

      <div className="depth-console mono">
        <div>
          Depth Video Extractor — everything runs inside this browser (no video ever uploads;
          Save to Library writes to YOUR machine&apos;s .zclip-data).
        </div>
        {lines.map((l, i) => (
          <div key={i} className={l.startsWith("FAULT") ? "depth-fault" : undefined}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
