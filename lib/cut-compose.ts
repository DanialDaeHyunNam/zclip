/**
 * CUT assembly engine (docs/CUT-FLOW.md) — composes scene videos + per-scene
 * voiceover audio + burned captions into ONE vertical mp4, entirely in the
 * browser. Sibling of lib/depth-extract.ts and built on the same proven
 * spine: seek-based frames with timestamps MINTED at i/fps (deterministic,
 * never inference/playback-paced), WebCodecs → mp4-muxer.
 *
 * MPT principle carried over verbatim: THE VOICEOVER OWNS THE TIMELINE.
 * Each scene runs exactly as long as its narration audio; the scene's video
 * is cover-cropped and LOOPED to fill that duration.
 *
 * Audio track: this is the part depth-extract never needed — decoded mp3s
 * are concatenated at 44.1kHz mono and AAC-encoded via AudioEncoder into the
 * same muxer. No AudioEncoder / no aac support → loud refusal (Chrome/Edge).
 */

export interface ComposeScene {
  /** The scene's footage, already fetched as a Blob (CORS-clean). */
  videoBlob: Blob;
  /** Narration text — burned as wrapped caption chunks. */
  text: string;
  /** This scene's voiceover, as encoded audio bytes (mp3 from /api/tts). */
  audioData: ArrayBuffer;
}

export interface ComposeProgress {
  phase: "audio" | "frames" | "mux";
  pct: number;
  note: string;
}

export interface ComposeOptions {
  width?: number;
  height?: number;
  fps?: number;
  captions?: boolean;
  onProgress?: (p: ComposeProgress) => void;
  isCanceled?: () => boolean;
}

const AVC_CANDIDATES = [
  "avc1.640028", // High 4.0
  "avc1.4d0028", // Main 4.0
  "avc1.42e01e", // Constrained Baseline
];
const SAMPLE_RATE = 44100;
const AAC = "mp4a.40.2";

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
    // Identical currentTime never fires "seeked" — a timeout failsafe keeps
    // frame 0 and slow keyframe seeks from hanging (depth-extract lesson).
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

const loadVideo = (blob: Blob): Promise<{ v: HTMLVideoElement; url: string }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = () => resolve({ v, url });
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("scene video failed to load"));
    };
    v.src = url;
  });

/** Split narration into caption chunks (word-safe, ≲38 chars) and give each
 *  a share of the scene's duration proportional to its length. */
function captionCues(
  text: string,
  durationSec: number,
): { text: string; start: number; end: number }[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 38 && cur) {
      chunks.push(cur.trim());
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) chunks.push(cur.trim());
  const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
  let t = 0;
  return chunks.map((c) => {
    const d = (c.length / total) * durationSec;
    const cue = { text: c, start: t, end: t + d };
    t += d;
    return cue;
  });
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  W: number,
  H: number,
) {
  const size = Math.round(W * 0.052);
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  // wrap to the safe width
  const maxW = W * 0.86;
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = (cur + " " + w).trim();
    if (ctx.measureText(trial).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = trial;
  }
  if (cur) lines.push(cur);
  const lineH = size * 1.25;
  let y = H * 0.82;
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.lineWidth = Math.max(4, size * 0.18);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineJoin = "round";
    ctx.strokeText(lines[i], W / 2, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(lines[i], W / 2, y);
    y -= lineH;
  }
}

export async function composeCut(
  scenes: ComposeScene[],
  opts: ComposeOptions = {},
): Promise<{ blob: Blob; durationSec: number }> {
  const W = opts.width ?? 720;
  const H = opts.height ?? 1280;
  const fps = opts.fps ?? 30;
  const captions = opts.captions ?? true;
  const onProgress = opts.onProgress;
  if (!scenes.length) throw new Error("no scenes to compose");
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    throw new Error(
      "this browser has no WebCodecs audio+video encoders — use Chrome or Edge",
    );
  }

  /* ── 1. decode + concatenate the voiceover (it owns the timeline) ── */
  onProgress?.({ phase: "audio", pct: 0, note: "decoding voiceover" });
  const AC: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ac = new AC({ sampleRate: SAMPLE_RATE });
  const sceneAudio: Float32Array[] = [];
  const sceneDur: number[] = [];
  try {
    for (let i = 0; i < scenes.length; i++) {
      const buf = await ac.decodeAudioData(scenes[i].audioData.slice(0));
      // decodeAudioData resamples to the context rate; take channel 0 (mono).
      sceneAudio.push(Float32Array.from(buf.getChannelData(0)));
      sceneDur.push(buf.length / SAMPLE_RATE);
      onProgress?.({
        phase: "audio",
        pct: Math.round(((i + 1) / scenes.length) * 100),
        note: `decoded scene ${i + 1}/${scenes.length} voiceover`,
      });
    }
  } finally {
    void ac.close().catch(() => undefined);
  }
  const totalDur = sceneDur.reduce((a, b) => a + b, 0);
  if (totalDur < 0.5) throw new Error("voiceover is empty");
  const totalSamples = sceneAudio.reduce((n, a) => n + a.length, 0);
  const pcm = new Float32Array(totalSamples);
  {
    let off = 0;
    for (const a of sceneAudio) {
      pcm.set(a, off);
      off += a.length;
    }
  }

  /* ── 2. encoders + muxer ── */
  let avc: string | null = null;
  for (const c of AVC_CANDIDATES) {
    const sup = await VideoEncoder.isConfigSupported({
      codec: c,
      width: W,
      height: H,
      framerate: fps,
    });
    if (sup.supported) {
      avc = c;
      break;
    }
  }
  if (!avc) throw new Error("no H.264 encoder in this browser — use Chrome or Edge");
  const aacSup = await AudioEncoder.isConfigSupported({
    codec: AAC,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
  });
  if (!aacSup.supported) {
    throw new Error("no AAC audio encoder in this browser — use Chrome or Edge");
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    audio: { codec: "aac", sampleRate: SAMPLE_RATE, numberOfChannels: 1 },
    fastStart: "in-memory",
  });

  let vErr: Error | null = null;
  const vEnc = new VideoEncoder({
    output: (c, m) => muxer.addVideoChunk(c, m),
    error: (e) => {
      vErr = e instanceof Error ? e : new Error(String(e));
    },
  });
  vEnc.configure({
    codec: avc,
    width: W,
    height: H,
    framerate: fps,
    bitrate: Math.min(10_000_000, Math.round(W * H * fps * 0.12)),
    avc: { format: "avc" as const },
    latencyMode: "quality",
  });

  let aErr: Error | null = null;
  const aEnc = new AudioEncoder({
    output: (c, m) => muxer.addAudioChunk(c, m),
    error: (e) => {
      aErr = e instanceof Error ? e : new Error(String(e));
    },
  });
  aEnc.configure({
    codec: AAC,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: 96_000,
  });

  /* ── 3. video frames, scene by scene (timestamps minted at i/fps) ── */
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  const totalFrames = Math.ceil(totalDur * fps);
  let frameIdx = 0;
  let sceneStart = 0;
  for (let s = 0; s < scenes.length; s++) {
    const { v, url } = await loadVideo(scenes[s].videoBlob);
    const srcDur = Math.max(0.1, v.duration || 0.1);
    const cues = captions ? captionCues(scenes[s].text, sceneDur[s]) : [];
    const sceneFrames =
      s === scenes.length - 1
        ? totalFrames - frameIdx // last scene absorbs rounding
        : Math.round(sceneDur[s] * fps);
    try {
      for (let i = 0; i < sceneFrames; i++) {
        if (opts.isCanceled?.()) throw new Error("canceled");
        const local = i / fps;
        // loop the footage to fill the narration (never stretch, never freeze)
        const srcT = Math.min(local % srcDur, srcDur - 0.001);
        await seekTo(v, srcT);
        const vw = v.videoWidth || W;
        const vh = v.videoHeight || H;
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        if (captions) {
          const cue = cues.find((c) => local >= c.start && local < c.end);
          if (cue) drawCaption(ctx, cue.text, W, H);
        }
        const vf = new VideoFrame(canvas, {
          timestamp: Math.round((frameIdx * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        vEnc.encode(vf, { keyFrame: frameIdx % (fps * 2) === 0 });
        vf.close();
        if (vErr) throw vErr;
        await drainQueue(vEnc);
        frameIdx++;
        onProgress?.({
          phase: "frames",
          pct: Math.round((frameIdx / totalFrames) * 100),
          note: `scene ${s + 1}/${scenes.length} · frame ${frameIdx}/${totalFrames}`,
        });
      }
    } finally {
      v.removeAttribute("src");
      URL.revokeObjectURL(url);
    }
    sceneStart += sceneDur[s];
  }
  await vEnc.flush();
  vEnc.close();

  /* ── 4. audio chunks ── */
  onProgress?.({ phase: "mux", pct: 0, note: "encoding voiceover track" });
  const CHUNK = 1024;
  for (let off = 0; off < pcm.length; off += CHUNK) {
    const slice = pcm.subarray(off, Math.min(off + CHUNK, pcm.length));
    const ad = new AudioData({
      format: "f32-planar",
      sampleRate: SAMPLE_RATE,
      numberOfFrames: slice.length,
      numberOfChannels: 1,
      timestamp: Math.round((off / SAMPLE_RATE) * 1e6),
      data: Float32Array.from(slice),
    });
    aEnc.encode(ad);
    ad.close();
    if (aErr) throw aErr;
  }
  await aEnc.flush();
  aEnc.close();

  onProgress?.({ phase: "mux", pct: 100, note: "finalizing mp4" });
  muxer.finalize();
  return {
    blob: new Blob([muxer.target.buffer], { type: "video/mp4" }),
    durationSec: totalDur,
  };
}
