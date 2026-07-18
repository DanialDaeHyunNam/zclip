"use client";

/**
 * In-browser depth-video extraction — the shared engine behind the /depth
 * tool page AND the transfer flow's automatic depth pass (ANIMATE runs this
 * on the MOVES clip before submitting the render).
 *
 * Depth Anything V2 Small via transformers.js: WebGPU when a REAL adapter
 * exists, WASM otherwise. Frames are sampled at the target fps and encoded
 * through WebCodecs with exact i/fps timestamps, so the output always plays
 * at the full frame rate no matter how slow inference is. EMA temporal
 * smoothing kills the per-frame normalization flicker.
 *
 * Two lazy-init traps this module guards (learned headless, DEVLOG #34):
 *  - ONNX backends initialize on the FIRST INFERENCE, not at pipeline
 *    construction — warm up inside the fallback try.
 *  - transformers.js memoizes the model load per id, so a failed webgpu
 *    attempt poisons the wasm retry — probe requestAdapter() FIRST and
 *    pick the right device on the first attempt.
 */

export interface DepthProgress {
  done: number;
  total: number;
  pct: number;
  note: string;
}

export interface DepthOptions {
  /** Output frame rate (default 30 — the "keep it ≥30fps" contract). */
  fps?: number;
  /** Long-side cap for processing/output (default 768). */
  maxSide?: number;
  /** Minimum W×H pixel count — UPSCALES past maxSide if needed (ModelArk's
   *  r2v floor is 409,600 px; a 432×768 depth pass gets rejected). */
  minPixels?: number;
  /** EMA weight of history, 0–0.8 (default 0.35). */
  smoothing?: number;
  /** near = white (default true — the model's native direction). */
  nearWhite?: boolean;
  style?: "grayscale" | "inferno";
  /** Adaptive local-contrast amount on the depth map, 0–2 (default 0).
   *  Faces and hands span only a few depth values, so they flatten into a
   *  blob — this equalizes LOCAL variance (flat regions get the biggest
   *  gain, already-contrasty silhouette edges get ~none, so no halos)
   *  while the global near/far ramp stays intact. */
  detail?: number;
  /** Depth model size (default "small", ~50MB). "base" (~370MB) resolves
   *  meaningfully more facial/hand structure — worth it on WebGPU. */
  model?: "small" | "base";
  onLog?: (line: string) => void;
  onProgress?: (p: DepthProgress) => void;
  /** Fires after each frame lands on the output canvas — live preview hook. */
  onFrame?: (canvas: HTMLCanvasElement, frameIndex: number, total: number) => void;
  /** Poll-style cancel — return true to stop; resolves with canceled:true. */
  isCanceled?: () => boolean;
}

export interface DepthResult {
  blob: Blob | null;
  container: "mp4" | "webm";
  width: number;
  height: number;
  frames: number;
  fps: number;
  canceled?: boolean;
}

const MODEL_IDS = {
  small: "onnx-community/depth-anything-v2-small",
  base: "onnx-community/depth-anything-v2-base",
} as const;
const MODEL_SIZES = { small: "~50MB", base: "~370MB" } as const;

/** Codec ladder — H.264/mp4 first (what providers and QuickTime expect),
 *  VP9/VP8-webm for Chromium builds without the proprietary encoder. */
const CODEC_CANDIDATES = [
  { codec: "avc1.640028", container: "mp4" }, // High 4.0 — 1080p30
  { codec: "avc1.4d0028", container: "mp4" }, // Main 4.0
  { codec: "avc1.42e01e", container: "mp4" }, // Constrained Baseline
  { codec: "vp09.00.40.08", container: "webm" },
  { codec: "vp8", container: "webm" },
] as const;

/* ── inferno colormap (8 anchors, lerped into a LUT) ── */
const INFERNO_STOPS: [number, number, number][] = [
  [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
  [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164],
];
const INFERNO = (() => {
  const lut = new Uint8Array(256 * 3);
  const n = INFERNO_STOPS.length - 1;
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * n;
    const lo = Math.min(Math.floor(pos), n - 1);
    const t = pos - lo;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(
        INFERNO_STOPS[lo][c] * (1 - t) + INFERNO_STOPS[lo + 1][c] * t,
      );
    }
  }
  return lut;
})();

/* ── device probe + memoized model load ── */

let gpuProbe: Promise<boolean> | null = null;

/** True only when a REAL WebGPU adapter exists — `"gpu" in navigator` lies
 *  on headless/driver-less Chromium, and a failed webgpu session poisons
 *  transformers.js' memoized model load, so this must be right first try. */
export function probeWebGpu(): Promise<boolean> {
  if (!gpuProbe) {
    gpuProbe = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gpu = (navigator as any).gpu;
        if (!gpu?.requestAdapter) return false;
        return Boolean(await gpu.requestAdapter());
      } catch {
        return false;
      }
    })();
  }
  return gpuProbe;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeCache: { key: string; pipe: any } | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeLoading: Promise<any> | null = null;

async function loadPipeline(
  model: "small" | "base",
  onLog?: (l: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const wantDevice = (await probeWebGpu()) ? "webgpu" : "wasm";
  const cacheKey = `${wantDevice}:${model}`;
  if (pipeCache?.key === cacheKey) return pipeCache.pipe;
  if (pipeLoading) return pipeLoading;
  const MODEL_ID = MODEL_IDS[model];

  pipeLoading = (async () => {
    const tf = await import("@huggingface/transformers");
    onLog?.(
      `loading Depth Anything V2 ${model === "base" ? "Base" : "Small"} (${MODEL_SIZES[model]}, ${wantDevice}) — cached after the first run …`,
    );
    let lastPct = -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progress = (p: any) => {
      if (p?.status === "progress" && typeof p.progress === "number") {
        const rounded = Math.round(p.progress);
        if (rounded !== lastPct && rounded % 10 === 0) {
          lastPct = rounded;
          onLog?.(`model download ${rounded}% — ${p.file ?? ""}`);
        }
      }
    };
    // ONNX backends init lazily on the first inference — warm up HERE so a
    // broken adapter fails inside this try, where the fallback can catch it.
    const build = async (device: "webgpu" | "wasm") => {
      const pipe = await tf.pipeline("depth-estimation", MODEL_ID, {
        device,
        progress_callback: progress,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await pipe(new tf.RawImage(new Uint8ClampedArray(16 * 16 * 4).fill(128), 16, 16, 4));
      return pipe;
    };
    try {
      pipeCache = { key: cacheKey, pipe: await build(wantDevice) };
    } catch (e) {
      if (wantDevice === "webgpu") {
        onLog?.(
          `WebGPU init failed (${e instanceof Error ? e.message : "error"}) — falling back to WASM`,
        );
        pipeCache = { key: `wasm:${model}`, pipe: await build("wasm") };
      } else throw e;
    }
    onLog?.(`model ready (${pipeCache.key})`);
    return pipeCache.pipe;
  })();
  try {
    return await pipeLoading;
  } finally {
    pipeLoading = null;
  }
}

/* ── helpers ── */

const seekTo = (v: HTMLVideoElement, t: number): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done, { once: true });
    // Assigning an identical currentTime never fires "seeked" — resolve on a
    // short timeout either way so frame 0 (and slow keyframe seeks) can't hang.
    setTimeout(done, 2000);
    v.currentTime = t;
    if (!v.seeking) setTimeout(done, 0);
  });

const drainQueue = (enc: VideoEncoder): Promise<void> =>
  new Promise((resolve) => {
    if (enc.encodeQueueSize <= 4) return resolve();
    const iv = setInterval(() => {
      if (enc.encodeQueueSize <= 4) {
        clearInterval(iv);
        resolve();
      }
    }, 15);
  });

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Separable box blur (running-sum, O(N)) — the smoothing base for the
 *  unsharp detail boost. Edges clamp. */
function boxBlur(
  src: Float32Array,
  dst: Float32Array,
  tmp: Float32Array,
  W: number,
  H: number,
  r: number,
): void {
  const span = 2 * r + 1;
  // horizontal
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / span;
      const add = Math.min(W - 1, x + r + 1);
      const sub = Math.max(0, x - r);
      sum += src[row + add] - src[row + sub];
    }
  }
  // vertical
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = sum / span;
      const add = Math.min(H - 1, y + r + 1);
      const sub = Math.max(0, y - r);
      sum += tmp[add * W + x] - tmp[sub * W + x];
    }
  }
}

/* ── the extraction ── */

/** Pure resize re-encode — NO model. For references that are already the
 *  right KIND (a hand-made depth clip, a raw ref) but under ModelArk's
 *  409,600 px r2v floor: frames scale up on canvas and re-encode at the
 *  same timeline. Audio is dropped (WebCodecs video-only — depth refs
 *  never had audio; a sub-floor raw ref trades its audio for a submit
 *  that works). */
export async function resizeVideoToFloor(
  source: Blob,
  minPixels: number,
  fps = 30,
  onProgress?: (p: DepthProgress) => void,
): Promise<{ blob: Blob; container: "mp4" | "webm"; width: number; height: number }> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("this browser has no WebCodecs (VideoEncoder) — use Chrome or Edge");
  }
  const srcUrl = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("could not read the source as a video"));
      video.src = srcUrl;
    });
    const duration = video.duration;
    const px = video.videoWidth * video.videoHeight;
    const scale = Math.sqrt(Math.max(minPixels, px) / px);
    const W = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    const H = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const total = Math.max(1, Math.round(duration * fps));

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const outCtx = out.getContext("2d")!;
    outCtx.imageSmoothingQuality = "high";

    let picked: (typeof CODEC_CANDIDATES)[number] | null = null;
    for (const c of CODEC_CANDIDATES) {
      const sup = await VideoEncoder.isConfigSupported({
        codec: c.codec, width: W, height: H, framerate: fps,
      });
      if (sup.supported) { picked = c; break; }
    }
    if (!picked) throw new Error("no supported video encoder (H.264/VP9/VP8) in this browser");
    const container = picked.container;

    let addChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
    let finalize: () => Blob;
    if (container === "mp4") {
      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: W, height: H, frameRate: fps },
        fastStart: "in-memory",
      });
      addChunk = (c, m) => muxer.addVideoChunk(c, m);
      finalize = () => {
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: "video/mp4" });
      };
    } else {
      const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: picked.codec === "vp8" ? "V_VP8" : "V_VP9",
          width: W, height: H, frameRate: fps,
        },
      });
      addChunk = (c, m) => muxer.addVideoChunk(c, m);
      finalize = () => {
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: "video/webm" });
      };
    }

    let encError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => addChunk(chunk, meta),
      error: (e) => { encError = e instanceof Error ? e : new Error(String(e)); },
    });
    encoder.configure({
      codec: picked.codec, width: W, height: H, framerate: fps,
      bitrate: Math.min(12_000_000, Math.round(W * H * fps * 0.15)),
      ...(container === "mp4" ? { avc: { format: "avc" as const } } : {}),
      latencyMode: "quality",
    });

    for (let i = 0; i < total; i++) {
      const t = Math.min(i / fps, Math.max(0, duration - 0.001));
      await seekTo(video, t);
      outCtx.drawImage(video, 0, 0, W, H);
      const vf = new VideoFrame(out, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (encError) throw encError;
      await drainQueue(encoder);
      onProgress?.({
        done: i + 1,
        total,
        pct: Math.round(((i + 1) / total) * 100),
        note: `upscaling frame ${i + 1}/${total} → ${W}×${H}`,
      });
    }
    await encoder.flush();
    encoder.close();
    return { blob: finalize(), container, width: W, height: H };
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(srcUrl);
  }
}

export async function extractDepthVideo(
  source: Blob,
  opts: DepthOptions = {},
): Promise<DepthResult> {
  const fps = opts.fps ?? 30;
  const maxSide = opts.maxSide ?? 768;
  const smoothing = opts.smoothing ?? 0.35;
  const nearWhite = opts.nearWhite ?? true;
  const style = opts.style ?? "grayscale";
  const detail = Math.max(0, Math.min(2, opts.detail ?? 0));
  const { onLog, onProgress, onFrame, isCanceled } = opts;

  if (typeof VideoEncoder === "undefined") {
    throw new Error("this browser has no WebCodecs (VideoEncoder) — use Chrome or Edge");
  }

  const tf = await import("@huggingface/transformers");
  const pipe = await loadPipeline(opts.model ?? "small", onLog);

  /* source video (own hidden element — never touches the caller's DOM) */
  const srcUrl = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("could not read the source as a video"));
      video.src = srcUrl;
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("source video has no readable duration");
    }

    let scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const minPixels = opts.minPixels ?? 0;
    const scaledPx = video.videoWidth * video.videoHeight * scale * scale;
    if (minPixels > 0 && scaledPx < minPixels) {
      // The pixel floor WINS over the long-side cap — upscale if needed
      // (smooth depth data upscales cleanly).
      scale = Math.sqrt(minPixels / (video.videoWidth * video.videoHeight));
    }
    const W = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    const H = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const total = Math.max(1, Math.round(duration * fps));

    const work = document.createElement("canvas");
    work.width = W;
    work.height = H;
    const workCtx = work.getContext("2d", { willReadFrequently: true })!;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const outCtx = out.getContext("2d")!;

    /* encoder + muxer */
    let picked: (typeof CODEC_CANDIDATES)[number] | null = null;
    for (const c of CODEC_CANDIDATES) {
      const sup = await VideoEncoder.isConfigSupported({
        codec: c.codec, width: W, height: H, framerate: fps,
      });
      if (sup.supported) { picked = c; break; }
    }
    if (!picked) throw new Error("no supported video encoder (H.264/VP9/VP8) in this browser");
    const container = picked.container;

    let addChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
    let finalize: () => Blob;
    if (container === "mp4") {
      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: W, height: H, frameRate: fps },
        fastStart: "in-memory",
      });
      addChunk = (c, m) => muxer.addVideoChunk(c, m);
      finalize = () => {
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: "video/mp4" });
      };
    } else {
      const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: picked.codec === "vp8" ? "V_VP8" : "V_VP9",
          width: W, height: H, frameRate: fps,
        },
      });
      addChunk = (c, m) => muxer.addVideoChunk(c, m);
      finalize = () => {
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: "video/webm" });
      };
    }

    let encError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => addChunk(chunk, meta),
      error: (e) => { encError = e instanceof Error ? e : new Error(String(e)); },
    });
    encoder.configure({
      codec: picked.codec, width: W, height: H, framerate: fps,
      bitrate: Math.min(12_000_000, Math.round(W * H * fps * 0.15)),
      ...(container === "mp4" ? { avc: { format: "avc" as const } } : {}),
      latencyMode: "quality",
    });
    onLog?.(`encoder: ${picked.codec} → .${container}`);
    onLog?.(
      `processing ${total} frames @ ${fps}fps → ${W}×${H} (audio is dropped — the depth ref carries motion only)`,
    );

    /* frame loop */
    const smoothBuf = new Float32Array(W * H);
    // Adaptive local-contrast buffers — faces/hands span only a few depth
    // values; equalizing LOCAL variance (big gain where flat, none where
    // busy) makes expressions and finger poses readable without halos.
    const meanBuf = detail > 0 ? new Float32Array(W * H) : null;
    const sqSrc = detail > 0 ? new Float32Array(W * H) : null;
    const sqBuf = detail > 0 ? new Float32Array(W * H) : null;
    const blurTmp = detail > 0 ? new Float32Array(W * H) : null;
    const blurR = Math.max(2, Math.round(Math.min(W, H) / 40));
    let hasPrev = false;
    const outImage = outCtx.createImageData(W, H);
    const startedAt = performance.now();
    let canceled = false;

    for (let i = 0; i < total; i++) {
      if (isCanceled?.()) { canceled = true; break; }
      const t = Math.min(i / fps, Math.max(0, duration - 0.001));
      await seekTo(video, t);
      workCtx.drawImage(video, 0, 0, W, H);
      const frame = workCtx.getImageData(0, 0, W, H);
      const raw = new tf.RawImage(frame.data, W, H, 4);
      const result = (await pipe(raw)) as unknown as {
        depth: { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
      };
      const d = result.depth;
      // The pipeline interpolates the prediction back to input size, so
      // d is W×H single-channel — anything else is a bug worth surfacing.
      if (d.width !== W || d.height !== H) {
        throw new Error(`depth size mismatch (${d.width}×${d.height} vs ${W}×${H})`);
      }

      const alpha = hasPrev ? smoothing : 0;
      for (let p = 0; p < W * H; p++) {
        smoothBuf[p] = alpha * smoothBuf[p] + (1 - alpha) * d.data[p];
      }
      hasPrev = true;

      if (meanBuf && sqSrc && sqBuf && blurTmp) {
        for (let p = 0; p < W * H; p++) sqSrc[p] = smoothBuf[p] * smoothBuf[p];
        boxBlur(smoothBuf, meanBuf, blurTmp, W, H, blurR);
        boxBlur(sqSrc, sqBuf, blurTmp, W, H, blurR);
      }
      const px = outImage.data;
      const gainCap = 1 + 2.5 * detail; // detail 1.2 → up to 4×
      for (let p = 0; p < W * H; p++) {
        let v = smoothBuf[p];
        if (meanBuf && sqBuf) {
          const m = meanBuf[p];
          const sigma = Math.sqrt(Math.max(0, sqBuf[p] - m * m));
          // Flat neighborhood (a face) → big gain; busy silhouette edge
          // (huge sigma) → gain 1. Capped so noise can't explode.
          const gain = Math.min(gainCap, Math.max(1, 14 / (sigma + 2)));
          v = m + (v - m) * gain;
        }
        if (!nearWhite) v = 255 - v;
        const vi = v < 0 ? 0 : v > 255 ? 255 : v | 0;
        const o = p * 4;
        if (style === "inferno") {
          px[o] = INFERNO[vi * 3];
          px[o + 1] = INFERNO[vi * 3 + 1];
          px[o + 2] = INFERNO[vi * 3 + 2];
        } else {
          px[o] = px[o + 1] = px[o + 2] = vi;
        }
        px[o + 3] = 255;
      }
      outCtx.putImageData(outImage, 0, 0);
      onFrame?.(out, i, total);

      const vf = new VideoFrame(out, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (encError) throw encError;
      await drainQueue(encoder);

      const elapsed = (performance.now() - startedAt) / 1000;
      const rate = (i + 1) / Math.max(elapsed, 0.001);
      const eta = (total - i - 1) / Math.max(rate, 0.001);
      onProgress?.({
        done: i + 1,
        total,
        pct: Math.round(((i + 1) / total) * 100),
        note: `frame ${i + 1}/${total} · ${rate.toFixed(1)} fps processed · ETA ${fmtClock(eta)}`,
      });
    }

    if (canceled) {
      try { encoder.close(); } catch { /* already closed */ }
      onLog?.("canceled — nothing was written");
      return { blob: null, container, width: W, height: H, frames: 0, fps, canceled: true };
    }

    await encoder.flush();
    encoder.close();
    const blob = finalize();
    const secs = ((performance.now() - startedAt) / 1000).toFixed(0);
    onLog?.(
      `done — ${total} frames, ${(blob.size / 1e6).toFixed(1)}MB @ ${fps}fps (took ${secs}s)`,
    );
    return { blob, container, width: W, height: H, frames: total, fps };
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(srcUrl);
  }
}
