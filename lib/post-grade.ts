/**
 * ✂ POST colour grade — Lightroom-style sliders as ONE per-pixel function
 * (owner 2026-10-28: "like Lightroom, every kind of change"). The function
 * is baked into a 3D LUT: the studio preview samples it in WebGL, the render
 * writes the same table as a .cube for ffmpeg's lut3d (trilinear on both
 * sides), so what you dial is what gets baked.
 *
 * Only colour-in → colour-out work lives here. Anything that depends on
 * WHERE the pixel is (window light, vignette, sharpen, grain) can't be a
 * LUT — see lib/post-frame.ts.
 */

export type Grade = {
  /** EV stops, −2…+2 (applied in linear light, like a camera's exposure). */
  exposure: number;
  // The rest are Lightroom's −100…+100 sliders.
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temp: number;
  tint: number;
  vibrance: number;
  saturation: number;
  /** Split toning: a hue (0–360) and an amount (0–100) for each end. */
  shadowHue: number;
  shadowTint: number;
  highlightHue: number;
  highlightTint: number;
};

export const NEUTRAL_GRADE: Grade = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temp: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  shadowHue: 210,
  shadowTint: 0,
  highlightHue: 40,
  highlightTint: 0,
};

export const isNeutral = (g: Grade) =>
  (Object.keys(NEUTRAL_GRADE) as (keyof Grade)[]).every(
    (k) => k.endsWith("Hue") || g[k] === NEUTRAL_GRADE[k],
  );

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const bump = (x: number, centre: number) => Math.exp(-(((x - centre) / 0.17) ** 2));
/** Fully saturated colour for a hue, minus its own luma (pure chroma). */
const chroma = (hue: number) => {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] =
    h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  const l = luma(r, g, b);
  return [r - l, g - l, b - l] as const;
};

/** One pixel through the grade (sRGB 0…1 in and out). */
export function gradePixel(g: Grade, r0: number, g0: number, b0: number): [number, number, number] {
  // 1 · white balance + exposure, in linear light.
  const t = g.temp / 100;
  const tn = g.tint / 100;
  const gain = 2 ** g.exposure;
  let r = toSrgb(toLin(r0) * (1 + 0.18 * t) * (1 + 0.05 * tn) * gain);
  let gr = toSrgb(toLin(g0) * (1 - 0.12 * tn) * gain);
  let b = toSrgb(toLin(b0) * (1 - 0.18 * t) * (1 + 0.05 * tn) * gain);

  // 2 · tone: each slider bends only its band of the curve.
  const sh = g.shadows / 100;
  const hi = g.highlights / 100;
  const wh = g.whites / 100;
  const bk = g.blacks / 100;
  const k = g.contrast / 100;
  const tone = (x: number) => {
    let v =
      x +
      0.25 * sh * bump(x, 0.22) +
      0.25 * hi * bump(x, 0.75) +
      0.12 * wh * x ** 4 +
      0.12 * bk * (1 - x) ** 4;
    v = clamp01(v);
    // Contrast: an S around mid-grey, ends pinned, stays monotonic.
    return clamp01(v - 0.1 * k * Math.sin(2 * Math.PI * v));
  };
  r = tone(r);
  gr = tone(gr);
  b = tone(b);

  // 3 · split toning: chroma added by how dark / how bright the pixel is.
  const l = luma(r, gr, b);
  const st = (g.shadowTint / 100) * 0.12 * (1 - l) ** 2;
  const ht = (g.highlightTint / 100) * 0.12 * l ** 2;
  if (st || ht) {
    const cs = chroma(g.shadowHue);
    const ch = chroma(g.highlightHue);
    r += st * cs[0] + ht * ch[0];
    gr += st * cs[1] + ht * ch[1];
    b += st * cs[2] + ht * ch[2];
  }

  // 4 · saturation (all colours) + vibrance (muted colours more).
  const l2 = luma(r, gr, b);
  const c = Math.max(r, gr, b) - Math.min(r, gr, b);
  const f = (1 + g.saturation / 100) * (1 + (g.vibrance / 100) * (1 - c) ** 2);
  return [clamp01(l2 + (r - l2) * f), clamp01(l2 + (gr - l2) * f), clamp01(l2 + (b - l2) * f)];
}

export const LUT_SIZE = 33;

/** RGBA8 3D texture data, red fastest (x = r, y = g, z = b) — WebGL2. */
export function lutTexture(g: Grade, n = LUT_SIZE) {
  const out = new Uint8Array(n * n * n * 4);
  let i = 0;
  for (let bi = 0; bi < n; bi++)
    for (let gi = 0; gi < n; gi++)
      for (let ri = 0; ri < n; ri++) {
        const [r, gg, b] = gradePixel(g, ri / (n - 1), gi / (n - 1), bi / (n - 1));
        out[i++] = Math.round(r * 255);
        out[i++] = Math.round(gg * 255);
        out[i++] = Math.round(b * 255);
        out[i++] = 255;
      }
  return out;
}

/** The same table as a .cube file (red fastest) — ffmpeg lut3d. */
export function lutCube(g: Grade, n = LUT_SIZE) {
  const lines = [`TITLE "zclip post grade"`, `LUT_3D_SIZE ${n}`];
  for (let bi = 0; bi < n; bi++)
    for (let gi = 0; gi < n; gi++)
      for (let ri = 0; ri < n; ri++) {
        const [r, gg, b] = gradePixel(g, ri / (n - 1), gi / (n - 1), bi / (n - 1));
        lines.push(`${r.toFixed(5)} ${gg.toFixed(5)} ${b.toFixed(5)}`);
      }
  return lines.join("\n") + "\n";
}

/** Clamp an untrusted grade (the route) to the slider ranges. */
export function sanitizeGrade(raw: unknown): Grade {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof Grade, lo: number, hi: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NEUTRAL_GRADE[k];
  };
  return {
    exposure: num("exposure", -2, 2),
    contrast: num("contrast", -100, 100),
    highlights: num("highlights", -100, 100),
    shadows: num("shadows", -100, 100),
    whites: num("whites", -100, 100),
    blacks: num("blacks", -100, 100),
    temp: num("temp", -100, 100),
    tint: num("tint", -100, 100),
    vibrance: num("vibrance", -100, 100),
    saturation: num("saturation", -100, 100),
    shadowHue: num("shadowHue", 0, 360),
    shadowTint: num("shadowTint", 0, 100),
    highlightHue: num("highlightHue", 0, 360),
    highlightTint: num("highlightTint", 0, 100),
  };
}
