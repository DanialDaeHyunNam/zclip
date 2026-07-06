"use client";

import { useEffect, useState } from "react";

/**
 * Animated product demo — a miniature studio session that plays like a
 * screen recording, on a ~19s loop. The clips in /public/demo/ are REAL
 * ZCLIP output (composeStarter → refine → Veo), not stock.
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
          <video
            key={done2 ? "t2" : "t1"}
            src={done2 ? "/demo/take-2.mp4" : "/demo/take-1.mp4"}
            className="demo-clip"
            autoPlay
            muted
            loop
            playsInline
            // React sets `muted` as a property, which can miss the autoplay
            // policy check — force it and kick playback explicitly.
            ref={(el) => {
              if (el) {
                el.muted = true;
                el.play().catch(() => {});
              }
            }}
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
      <figcaption className="demo-cap">REAL OUTPUT — THESE TAKES WERE MADE WITH ZCLIP ITSELF · SPED UP · LOOPS</figcaption>
    </figure>
  );
}
