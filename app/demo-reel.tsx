"use client";

import { useEffect, useState } from "react";

/**
 * Animated product demo — a miniature studio session that plays like a
 * screen recording, on a ~15s loop. The three clips in /public/demo/ are
 * REAL ZCLIP output made with the actual pipeline (composeStarter →
 * refine → Veo, each take seeded with a frame of the previous one), so
 * the "evolve the same take" story is genuine.
 */

const MSG1 = "Asian girl in her bedroom — quiet 'wait, what?' at her phone";
const MSG2 = "Same reaction — now on a rooftop with her friends";
const MSG3 = "Keep everything — just restyle her in a leather jacket";

export default function DemoReel() {
  const [t, setT] = useState(0); // 100ms ticks, loops at 150 (~15s)
  useEffect(() => {
    const iv = setInterval(() => setT((x) => (x + 1) % 150), 100);
    return () => clearInterval(iv);
  }, []);

  const typed1 = MSG1.slice(0, Math.max(0, (t - 3) * 3));
  const sent1 = t >= 24;
  const render1 = t >= 25 && t < 39;
  const done1 = t >= 39;

  const pin1 = t >= 45;
  const typed2 = pin1 ? MSG2.slice(0, Math.max(0, (t - 48) * 3)) : "";
  const sent2 = t >= 65;
  const render2 = t >= 66 && t < 80;
  const done2 = t >= 80;

  const pin2 = t >= 86;
  const typed3 = pin2 ? MSG3.slice(0, Math.max(0, (t - 89) * 3)) : "";
  const sent3 = t >= 108;
  const render3 = t >= 109 && t < 124;
  const done3 = t >= 124;

  const clip = done3 ? "t3" : done2 ? "t2" : done1 ? "t1" : null;

  const timer = (from: number) =>
    `00:${String(Math.min(99, (t - from) * 2)).padStart(2, "0")}`;

  return (
    <figure className="demo fade" aria-label="Product demo animation">
      <div className="demo-frame">
        {clip ? (
          <video
            key={clip}
            src={`/demo/take-${clip.slice(1)}.mp4`}
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
            <span className="demo-timer">{timer(25)}</span>
          </>
        ) : (
          <span className="frame-idle-sub">9:16 · MP4</span>
        )}
        {(render2 || render3) && <div className="scanline" />}
      </div>

      <div className="demo-chat">
        <div className="demo-msg">
          {typed1}
          {!sent1 && typed1 && <i className="demo-caret" />}
        </div>
        {sent1 && (
          <div className="demo-take">
            <span className={`dot ${done1 ? "done" : "live"}`} />
            {render1 ? `RENDERING ${timer(25)}` : "TAKE 1 · VEO 3.1 FAST · $0.40"}
          </div>
        )}
        {pin1 && <div className="demo-chip fade">❐ Take 1 · pinned as context</div>}
        {pin1 && typed2 && (
          <div className="demo-msg">
            {typed2}
            {!sent2 && <i className="demo-caret" />}
          </div>
        )}
        {sent2 && (
          <div className="demo-take">
            <span className={`dot ${done2 ? "done" : "live"}`} />
            {render2 ? `RENDERING ${timer(66)}` : "TAKE 2 · CTX T1 · $0.40"}
          </div>
        )}
        {pin2 && <div className="demo-chip fade">❐ Take 2 · pinned as context</div>}
        {pin2 && typed3 && (
          <div className="demo-msg">
            {typed3}
            {!sent3 && <i className="demo-caret" />}
          </div>
        )}
        {sent3 && (
          <div className="demo-take">
            <span className={`dot ${done3 ? "done" : "live"}`} />
            {render3 ? `RENDERING ${timer(109)}` : "TAKE 3 · CTX T2 · $0.40"}
          </div>
        )}
        {done3 && (
          <div className="demo-spend fade">SESSION SPEND $1.20 · VEO ▮▮▮▮▮▮▮▮</div>
        )}
      </div>
      <figcaption className="demo-cap">
        REAL OUTPUT — THESE THREE TAKES WERE MADE WITH ZCLIP ITSELF, EACH BUILT
        ON THE LAST · SPED UP · LOOPS
      </figcaption>
    </figure>
  );
}
