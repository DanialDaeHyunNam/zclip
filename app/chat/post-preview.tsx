"use client";

/**
 * ✂ POST live preview — a WebGL2 canvas over the (hidden, still playing)
 * take video that draws every frame through the SAME math the ffmpeg render
 * uses (owner 2026-10-28: "like Lightroom"): crop window + handheld shake +
 * roll (lib/post-frame.ts), the colour grade as a 3D LUT (lib/post-grade.ts,
 * trilinear like the render's lut3d), light × vignette, a 3×3 sharpen and
 * grain — and finally shown the way Apple devices play a bt709 video, so
 * it matches the rendered file in the <video> next to it. Only the phone
 * re-encode, 30fps and room tone are render-only.
 *
 * Per-frame state lives in refs — React re-renders only when a knob moves.
 * Click the canvas to play / pause (the video's own controls are under it).
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { LUT_SIZE, lutTexture, type Grade } from "@/lib/post-grade";
import { shakeAt, VIGNETTE_MAX, type LightSide, type PostShake } from "@/lib/post-frame";

export type PostLook = {
  win: { span: number; left: number; top: number };
  shake: PostShake;
  trimStart: number;
  trimEnd: number | null;
  grade: Grade;
  light: number;
  lightSide: LightSide;
  vignette: number;
  sharpen: number;
  /** ffmpeg noise strength (alls), 0–25 — see grainStrength(). */
  grainStrength: number;
};

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform sampler3D u_lut;
uniform vec2 u_src;
uniform vec3 u_win;
uniform vec3 u_shake;
uniform float u_light;
uniform float u_left;
uniform float u_vig;
uniform float u_sharp;
uniform float u_grain;
uniform float u_seed;
uniform float u_bypass;
const float N = ${LUT_SIZE}.0;

// Output pixel → source: the crop window (+ shake) in the rolled frame,
// then undo the roll about the source centre — the render's rotate → crop.
vec2 toSrc(vec2 uv) {
  vec2 q = u_win.xy + u_shake.xy + uv * u_win.z;
  vec2 p = (q - 0.5) * u_src;
  float c = cos(-u_shake.z), s = sin(-u_shake.z);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  return p / u_src + 0.5;
}
vec3 graded(vec2 uv) {
  vec2 st = toSrc(uv);
  if (any(lessThan(st, vec2(0.0))) || any(greaterThan(st, vec2(1.0)))) return vec3(0.0);
  vec3 c = texture(u_video, st).rgb;
  if (u_bypass > 0.5) return c;
  return texture(u_lut, (c * (N - 1.0) + 0.5) / N).rgb;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// How Apple devices SHOW a bt709 video (Mac Chrome/QuickTime, iPhone): the
// code values decode with gamma ≈1.961 and re-encode for an sRGB screen —
// lighter and flatter than the raw values. A canvas shows raw values, so
// without this the preview looked more contrasty than the rendered file
// playing right next to it (measured 2026-10-28: decode identical, display
// not).
vec3 asPlayed(vec3 c) {
  vec3 l = pow(c, vec3(1.961));
  return mix(12.92 * l, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}
void main() {
  vec3 c = graded(v_uv);
  if (u_bypass < 0.5) {
    if (u_sharp > 0.0) {
      // The render's 3×3 convolution at 1080×1920: c + a·(c − box).
      vec2 px = vec2(1.0 / 1080.0, 1.0 / 1920.0);
      vec3 sum = vec3(0.0);
      for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) sum += graded(v_uv + vec2(float(i), float(j)) * px);
      c = clamp(c + u_sharp * (c - sum / 9.0), 0.0, 1.0);
    }
    float u = u_left > 0.5 ? v_uv.x : 1.0 - v_uv.x;
    float k = pow(u, 1.4);
    float base = 1.0 - u_light * k;
    vec3 m = vec3(base, base * (1.0 - 0.05 * u_light), (1.0 - u_light * 1.15 * k) * (1.0 - 0.15 * u_light));
    float d = length(v_uv * 2.0 - 1.0) / 1.41421;
    float s = clamp((d - 0.35) / 0.65, 0.0, 1.0);
    c *= m * (1.0 - u_vig * s * s);
    if (u_grain > 0.0) {
      vec2 g = gl_FragCoord.xy + u_seed;
      float nl = hash(g) - 0.5;
      vec3 nc = vec3(hash(g + 17.0), hash(g + 31.0), hash(g + 47.0)) - 0.5;
      c += (nl + 0.5 * nc) * 2.0 * u_grain;
    }
  }
  o = vec4(asPlayed(clamp(c, 0.0, 1.0)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
  }
  return sh;
}

export function PostPreview({
  videoRef,
  look,
  bypass,
  trimDragRef,
}: {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  look: PostLook;
  /** Before/after: true = the raw crop, no grade or effects. */
  bypass: boolean;
  /** Set while a trim handle is dragged — the loop then parks on that frame. */
  trimDragRef: MutableRefObject<string | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const bypassRef = useRef(bypass);
  bypassRef.current = bypass;
  const gradeKey = JSON.stringify(look.grade);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lut = useMemo(() => lutTexture(look.grade), [gradeKey]);
  const lutRef = useRef<{ data: Uint8Array; dirty: boolean }>({ data: lut, dirty: true });
  if (lutRef.current.data !== lut) lutRef.current = { data: lut, dirty: true };

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { premultipliedAlpha: false });
    if (!canvas || !gl) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);

    const vidTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vidTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    }
    gl.uniform1i(U("u_video"), 0);
    gl.uniform1i(U("u_lut"), 1);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const L = lookRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      // Trim loop (parked while a handle is dragged).
      const end = L.trimEnd ?? v.duration;
      if (
        !trimDragRef.current &&
        Number.isFinite(end) &&
        (v.currentTime > end || v.currentTime < L.trimStart - 0.05)
      ) {
        v.currentTime = L.trimStart;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vidTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      if (lutRef.current.dirty) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutRef.current.data);
        lutRef.current.dirty = false;
      }
      const s = shakeAt(L.shake, Math.max(0, v.currentTime - L.trimStart));
      gl.uniform2f(U("u_src"), v.videoWidth, v.videoHeight);
      gl.uniform3f(U("u_win"), L.win.left, L.win.top, L.win.span);
      gl.uniform3f(U("u_shake"), s.dx, s.dy, s.roll);
      gl.uniform1f(U("u_light"), L.light);
      gl.uniform1f(U("u_left"), L.lightSide === "left" ? 1 : 0);
      gl.uniform1f(U("u_vig"), (L.vignette / 100) * VIGNETTE_MAX);
      gl.uniform1f(U("u_sharp"), L.sharpen / 100);
      gl.uniform1f(U("u_grain"), L.grainStrength / 255);
      gl.uniform1f(U("u_seed"), (v.currentTime * 997) % 1000);
      gl.uniform1f(U("u_bypass"), bypassRef.current ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(vidTex);
      gl.deleteTexture(lutTex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [videoRef, trimDragRef]);

  return (
    <canvas
      ref={canvasRef}
      onClick={() => {
        const v = videoRef.current;
        if (v) void (v.paused ? v.play().catch(() => {}) : v.pause());
      }}
      title="Click to play / pause"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }}
    />
  );
}
