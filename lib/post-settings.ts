/**
 * ✂ POST settings — the one shape the studio panel, the render route and the
 * edit agent (/api/post-agent) pass around, plus the clamp every untrusted
 * copy goes through. A patch merges over a base, so the agent can send just
 * the knobs it is turning.
 */

import type { LightSide, PostShake } from "@/lib/post-frame";
import { NEUTRAL_GRADE, sanitizeGrade, type Grade } from "@/lib/post-grade";

export type PostSettings = {
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
  trimStart: number;
  trimEnd: number | null;
  grade: Grade;
};

export const DEFAULT_SETTINGS: PostSettings = {
  zoom: 1,
  cx: 0.5,
  cy: 0.5,
  shake: 0,
  light: 0,
  lightSide: "left",
  vignette: 0,
  sharpen: 0,
  grain: 0,
  phoneEncode: false,
  fps30: true,
  room: false,
  trimStart: 0,
  trimEnd: null,
  grade: NEUTRAL_GRADE,
};

/** Pick just the settings out of a bigger object (the studio's post state). */
export const pickSettings = (o: PostSettings): PostSettings => ({
  zoom: o.zoom,
  cx: o.cx,
  cy: o.cy,
  shake: o.shake,
  light: o.light,
  lightSide: o.lightSide,
  vignette: o.vignette,
  sharpen: o.sharpen,
  grain: o.grain,
  phoneEncode: o.phoneEncode,
  fps30: o.fps30,
  room: o.room,
  trimStart: o.trimStart,
  trimEnd: o.trimEnd,
  grade: o.grade,
});

/** Clamp an untrusted (partial) settings object over `base`. */
export function sanitizeSettings(raw: unknown, base: PostSettings = DEFAULT_SETTINGS): PostSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof PostSettings, lo: number, hi: number) => {
    const v = o[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : (base[k] as number);
  };
  const bool = (k: keyof PostSettings) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (base[k] as boolean));
  const trimStart = num("trimStart", 0, 60);
  let trimEnd = base.trimEnd;
  if ("trimEnd" in o) {
    const e = Number(o.trimEnd);
    trimEnd = o.trimEnd === null || !Number.isFinite(e) ? null : e;
  }
  if (trimEnd !== null && trimEnd <= trimStart + 0.3) trimEnd = null;
  const g = o.grade && typeof o.grade === "object" ? (o.grade as Record<string, unknown>) : {};
  return {
    zoom: num("zoom", 1, 3),
    cx: num("cx", 0, 1),
    cy: num("cy", 0, 1),
    shake: o.shake === 0 || o.shake === 1 || o.shake === 2 ? o.shake : base.shake,
    light: num("light", 0, 0.6),
    lightSide: o.lightSide === "left" || o.lightSide === "right" ? o.lightSide : base.lightSide,
    vignette: num("vignette", 0, 100),
    sharpen: num("sharpen", 0, 100),
    grain: num("grain", 0, 100),
    phoneEncode: bool("phoneEncode"),
    fps30: bool("fps30"),
    room: bool("room"),
    trimStart,
    trimEnd,
    grade: sanitizeGrade({ ...base.grade, ...g }),
  };
}
