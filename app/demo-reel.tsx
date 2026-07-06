"use client";

import { useEffect, useState } from "react";

/**
 * Animated product demo — a miniature studio session that plays like a
 * screen recording, on a ~19s loop. Pure state-machine + CSS, no video
 * file: type → render → take lands → pin as context → next take.
 */

const MSG1 = "A blonde girl in her bedroom — quiet 'wait, what?' at her phone";
const MSG2 = "Same girl, cafe window — hold the smile one beat longer";

export default function DemoReel() {
  const [t, setT] = useState(0); // 100ms ticks, loops at 190
  useEffect(() => {
    const iv = setInterval(() => setT((x) => (x + 1) % 190), 100);
    return () => clearInterval(iv);
  }, []);

  const typed1 = MSG1.slice(0, Math.max(0, (t - 5) * 2));
  const sent1 = t >= 40;
  const render1 = t >= 42 && t < 72;
  const done1 = t >= 72;
  const pinned = t >= 88;
  const typed2 = pinned ? MSG2.slice(0, Math.max(0, (t - 94) * 2)) : "";
  const sent2 = t >= 124;
  const render2 = t >= 126 && t < 158;
  const done2 = t >= 158;

  const timer = (from: number) =>
    `00:${String(Math.min(99, (t - from) * 2)).padStart(2, "0")}`;

  return (
    <figure className="demo fade" aria-label="Product demo animation">
      <div className="demo-frame">
        {done1 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={done2 ? "b3" : "b1"}
            src={done2 ? "/starters/blonde-3.jpg" : "/starters/blonde-1.jpg"}
            alt=""
            className="demo-clip"
          />
        ) : render1 ? (
          <>
            <div className="scanline" />
            <span className="demo-timer">{timer(42)}</span>
          </>
        ) : (
          <span className="frame-idle-sub">9:16 · MP4</span>
        )}
        {render2 && <div className="scanline" />}
        {(done1 || done2) && !render2 && <span className="demo-play">▶</span>}
      </div>

      <div className="demo-chat">
        <div className="demo-msg">
          {typed1}
          {!sent1 && typed1 && <i className="demo-caret" />}
        </div>
        {sent1 && (
          <div className="demo-take">
            <span className={`dot ${done1 ? "done" : "live"}`} />
            {render1 ? `RENDERING ${timer(42)}` : "TAKE 1 · VEO 3.1 FAST · $0.40"}
          </div>
        )}
        {pinned && <div className="demo-chip fade">❐ Take 1 · pinned as context</div>}
        {pinned && typed2 && (
          <div className="demo-msg">
            {typed2}
            {!sent2 && <i className="demo-caret" />}
          </div>
        )}
        {sent2 && (
          <div className="demo-take">
            <span className={`dot ${done2 ? "done" : "live"}`} />
            {render2 ? `RENDERING ${timer(126)}` : "TAKE 2 · CTX T1 · $0.40"}
          </div>
        )}
        {done2 && <div className="demo-spend fade">SESSION SPEND $0.80 · VEO ▮▮▮▮▮▮▮▮</div>}
      </div>
      <figcaption className="demo-cap">THE ACTUAL FLOW · SPED UP · LOOPS</figcaption>
    </figure>
  );
}
