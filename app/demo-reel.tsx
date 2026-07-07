"use client";

import { useEffect, useState } from "react";

/**
 * Animated product demo — a miniature chat session that plays like a screen
 * recording. The four clips in /public/demo are REAL ZCLIP output from one
 * session: a starting take, then three chat refinements, each built on the
 * last (takes-as-context). Same woman, same room — only the hand and the
 * emotion change, one message at a time. Prompts are the actual messages typed.
 *
 * Pacing per take: type the message → ~1s beat → render → the clip updates →
 * hold so you can watch it. The final clip plays through fully, then a ~2s
 * hold before the loop restarts.
 */

const TAKES = [
  {
    msg: "Asian Woman 1, oversized tee — quiet 'wait, what?' at her phone",
    meta: "VEO 3.1 FAST · $0.40",
  },
  {
    msg: "The hand looks off — keep everything, just move it to her lips",
    meta: "CTX T1",
  },
  {
    msg: "Not a shush — make it a gasp, hand flying up to cover her mouth",
    meta: "CTX T2",
  },
  {
    msg: "Flip the emotion: startled first, then a playful 'shh' to end",
    meta: "CTX T3",
  },
];

// All in 100ms ticks.
const TYPE = 22; // typing the message
const PAUSE = 10; // ~1s beat between "typed" and the clip changing
const RENDER = 9; // render spinner
const SHOW = 12; // clip visible before the next take starts typing
const STEP = TYPE + PAUSE + RENDER + SHOW;
const FINAL_HOLD = 60; // last clip plays fully (~4s) + ~2s hold, then loop
const LOOP = (TAKES.length - 1) * STEP + (TYPE + PAUSE + RENDER) + FINAL_HOLD;

export default function DemoReel() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((x) => (x + 1) % LOOP), 100);
    return () => clearInterval(iv);
  }, []);

  const takes = TAKES.map((tk, i) => {
    const base = i * STEP;
    const isLast = i === TAKES.length - 1;
    const typeStart = base;
    const typeEnd = base + TYPE;
    const renderStart = typeEnd + PAUSE;
    const renderEnd = renderStart + RENDER; // clip updates here
    const speed = Math.ceil(tk.msg.length / TYPE);
    return {
      ...tk,
      i,
      isLast,
      renderStart,
      typed: tk.msg.slice(0, Math.max(0, (t - typeStart) * speed)),
      typing: t >= typeStart && t < typeEnd,
      sent: t >= typeEnd,
      preparing: t >= typeEnd && t < renderStart,
      render: t >= renderStart && t < renderEnd,
      done: t >= renderEnd,
      pin: !isLast && t >= renderEnd + 4,
    };
  });

  const lastDone = takes.reduce((acc, tk) => (tk.done ? tk.i : acc), -1);
  const clipN = lastDone >= 0 ? lastDone + 1 : null;
  const anyRender = takes.some((tk) => tk.render);

  const timer = (from: number) =>
    `00:${String(Math.min(99, (t - from) * 2)).padStart(2, "0")}`;

  return (
    <figure className="demo fade" aria-label="Product demo animation">
      <div className="demo-frame">
        {clipN ? (
          <video
            key={clipN}
            src={`/demo/take-${clipN}.mp4`}
            className="demo-clip"
            autoPlay
            muted
            loop
            playsInline
            ref={(el) => {
              if (el) {
                el.muted = true;
                el.play().catch(() => {});
              }
            }}
          />
        ) : (
          <span className="frame-idle-sub">9:16 · MP4</span>
        )}
        {anyRender && <div className="scanline" />}
      </div>

      <div className="demo-chat">
        {takes.map((tk) =>
          tk.typed ? (
            <div key={`m${tk.i}`} className="demo-thread-item">
              <div className="demo-msg">
                {tk.typed}
                {tk.typing && <i className="demo-caret" />}
              </div>
              {tk.sent && (
                <div className="demo-take">
                  <span className={`dot ${tk.done ? "done" : "live"}`} />
                  {tk.render
                    ? `RENDERING ${timer(tk.renderStart)}`
                    : tk.preparing
                      ? "PREPARING…"
                      : `TAKE ${tk.i + 1} · ${tk.meta}`}
                </div>
              )}
              {tk.pin && (
                <div className="demo-chip fade">
                  ❐ Take {tk.i + 1} · pinned as context
                </div>
              )}
            </div>
          ) : null,
        )}
      </div>

      <figcaption className="demo-cap">
        REAL OUTPUT — FOUR TAKES, ONE CHAT. EACH BUILT ON THE LAST · SAME FACE,
        SAME ROOM, ONE MESSAGE AT A TIME · SPED UP · LOOPS
      </figcaption>
    </figure>
  );
}
