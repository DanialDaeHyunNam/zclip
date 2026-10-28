/**
 * ✂ POST ffmpeg filter graph — one builder for the video render
 * (/api/grab action "post") and the edit agent's stills (/api/post-agent
 * action "frame"), so what the agent looks at is what gets baked.
 *
 * Order: trim → roll → shaking crop → 1080×1920 → gbrp → lut3d → light ×
 * vignette multiply → sharpen → yuv420p → 30fps → (phone encode: soften) →
 * grain. Plain `format=` conversions on purpose: ffmpeg reads the take's
 * bt709 tags itself and round-trips exactly (explicit in/out_color_matrix
 * drifted ~2/255 darker — DEVLOG #51).
 */

import { grainStrength, maskGeq, postWindow, shakeExpr, shakeMargin } from "@/lib/post-frame";
import { isNeutral } from "@/lib/post-grade";
import type { PostSettings } from "@/lib/post-settings";

/** `[0:v]…[v]` (+ `;…[a]` room tone). `still` = one frame: no trim (the
 *  caller seeks), no shake, no fps change, no sound. `lutPath` is required
 *  when the grade isn't neutral (write lutCube() there first). */
export function buildPostGraph(s: PostSettings, lutPath: string | null, still = false) {
  const shake = still ? 0 : s.shake;
  const win = postWindow(s.zoom, s.cx, s.cy, shakeMargin(shake));
  const chain: string[] = [];
  if (!still && (s.trimStart > 0 || s.trimEnd !== null)) {
    chain.push(
      `trim=start=${s.trimStart.toFixed(3)}${s.trimEnd !== null ? `:end=${s.trimEnd.toFixed(3)}` : ""}`,
      "setpts=PTS-STARTPTS",
    );
  }
  const sx = shake ? shakeExpr(shake) : null;
  // Roll the whole source about its centre first; the window keeps a
  // margin, so the black corners the roll swings in never reach the crop.
  if (sx) chain.push(`rotate=a='${sx.roll}':c=black`);
  const offX = sx ? `+${sx.dx}` : "";
  const offY = sx ? `+${sx.dy}` : "";
  chain.push(
    `crop=trunc(iw*${win.span.toFixed(5)}/2)*2:trunc(ih*${win.span.toFixed(5)}/2)*2:` +
      `'iw*(${win.left.toFixed(5)}${offX})':'ih*(${win.top.toFixed(5)}${offY})'`,
    "scale=1080:1920:flags=lanczos",
  );
  const grain = grainStrength(s.grain);
  const tail = [
    ...(!still && s.fps30 ? ["fps=30"] : []),
    ...(s.phoneEncode ? ["gblur=sigma=0.4"] : []),
    ...(grain ? [`noise=alls=${grain}:allf=t+u`] : []),
  ];
  const graded = !isNeutral(s.grade) && lutPath !== null;
  const masked = s.light > 0 || s.vignette > 0;
  const sharpen = Math.round(s.sharpen);
  let graph: string;
  if (graded || masked || sharpen > 0) {
    const lut = graded ? `,lut3d=file='${lutPath}':interp=trilinear` : "";
    // c + a·(c − 3×3 box) as an integer kernel over 900: −a around, 900+8a centre.
    const sharp =
      sharpen > 0
        ? `,convolution=` +
          ["0", "1", "2"]
            .map((pl) => {
              const n = `-${sharpen}`;
              return `${pl}m='${[n, n, n, n, 900 + 8 * sharpen, n, n, n, n].join(" ")}':${pl}rdiv=1/900`;
            })
            .join(":")
        : "";
    const post = `${sharp},format=yuv420p${tail.length ? `,${tail.join(",")}` : ""}[v]`;
    if (masked) {
      // Light × vignette is a still multiply: one geq frame (geq is slow)
      // held for the clip by overlaying it on a black copy — a looped
      // source would never end (DEVLOG #49).
      const g = maskGeq(s.light, s.lightSide, s.vignette);
      graph =
        `[0:v]${chain.join(",")},format=gbrp${lut},split=2[base][b2];` +
        `color=c=black:s=1080x1920:d=0.05,format=gbrp,geq=r='${g.r}':g='${g.g}':b='${g.b}'[g1];` +
        `[b2]lutrgb=r=0:g=0:b=0[blk];[blk][g1]overlay=eof_action=repeat:format=gbrp[mask];` +
        `[base][mask]blend=all_mode=multiply${post}`;
    } else {
      graph = `[0:v]${chain.join(",")},format=gbrp${lut}${post}`;
    }
  } else {
    graph = `[0:v]${[...chain, ...tail].join(",")}[v]`;
  }
  // Room tone: low brown noise, band-limited like a quiet room through a
  // phone mic; the caller's -shortest ends it with the picture.
  const room = !still && s.room;
  if (room) graph += ";anoisesrc=c=brown:a=0.035,lowpass=f=450,highpass=f=50,volume=0.6[a]";
  return { graph, room };
}
