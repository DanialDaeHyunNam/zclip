"use client";

import { useEffect, useState } from "react";

/**
 * Animated product demo — a miniature chat session that plays like a screen
 * recording on a ~19s loop. The four clips in /public/demo are REAL ZCLIP
 * output from one session: a starting take, then three chat refinements,
 * each built on the last (takes-as-context). Same woman, same room — only the
 * hand and the emotion change, one message at a time. Prompts are the actual
 * messages that were typed.
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

const PER = 48; // ticks per take
const LOOP = TAKES.length * PER; // total loop length in 100ms ticks

export default function DemoReel() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((x) => (x + 1) % LOOP), 100);
    return () => clearInterval(iv);
  }, []);

  // Per-take sub-states derived from a fixed offset window.
  const takes = TAKES.map((tk, i) => {
    const base = i * PER;
    const isLast = i === TAKES.length - 1;
    return {
      ...tk,
      i,
      typed: tk.msg.slice(0, Math.max(0, (t - (base + 3)) * 3)),
      typing: t >= base + 3 && t < base + 24,
      sent: t >= base + 24,
      render: t >= base + 25 && t < base + 39,
      done: t >= base + 39,
      pin: !isLast && t >= base + 44,
      renderFrom: base + 25,
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
                    ? `RENDERING ${timer(tk.renderFrom)}`
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
