"use client";

import { useEffect, useState } from "react";

/**
 * A tiny animated walkthrough of the studio flow — like DemoReel, but of the
 * UI itself: it "clicks" Character → Background → Fashion, types the beat, hits
 * Send, renders, and a take lands. Pure CSS/JS state machine, no video file.
 * Shown in the in-app help modal and the install guide's "What you can do".
 */

// 100ms ticks.
const P = {
  char: [4, 12],
  bg: [12, 20],
  fashion: [20, 28],
  type: [30, 50],
  send: [50, 56],
  render: [56, 72],
  land: [72, 90],
} as const;
const END = 104; // land holds, then a beat, then loop
const MSG = "quiet 'wait, what?' at her phone";

export default function WorkflowDemo() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((x) => (x + 1) % END), 100);
    return () => clearInterval(iv);
  }, []);

  const inP = (p: readonly [number, number]) => t >= p[0] && t < p[1];
  const after = (p: readonly [number, number]) => t >= p[1];

  const typeLen = Math.round(((t - P.type[0]) / (P.type[1] - P.type[0])) * MSG.length);
  const typed = t >= P.type[0] ? MSG.slice(0, Math.max(0, Math.min(MSG.length, typeLen))) : "";
  const typing = inP(P.type);
  const rendering = inP(P.render);
  const landed = t >= P.land[0];
  const ready = typed.length === MSG.length && !rendering && !landed;

  return (
    <div className="wd" aria-label="Workflow walkthrough animation" role="img">
      {/* output frame */}
      <div className="wd-frame">
        {landed ? (
          <div className="wd-clip">
            {/* the real first take from the landing reel — asian-f-1 in the
                bedroom, the quiet 'wait, what?' beat this demo just typed */}
            <video
              src="/demo/take-1.mp4"
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
            <span className="wd-clip-meta">
              <span className="wd-dot done" /> TAKE 1 · VEO · $0.40
            </span>
          </div>
        ) : rendering ? (
          <div className="wd-render">
            <span className="wd-spin" />
            RENDERING…
          </div>
        ) : (
          <span className="wd-idle">9:16 · OUTPUT</span>
        )}
      </div>

      {/* controls: the pills + composer that get "clicked" */}
      <div className="wd-controls">
        <div className="wd-pills">
          <Pill icon="✦" label="Character" val="Asian Woman 1" sel={after(P.char)} click={inP(P.char)} />
          <Pill icon="◫" label="Background" val="Bedroom" sel={after(P.bg)} click={inP(P.bg)} />
          <Pill icon="⑆" label="Fashion" val="Oversized Tee" sel={after(P.fashion)} click={inP(P.fashion)} />
          <Pill icon="▤" label="Library" sel={false} click={false} />
        </div>

        <div className={`wd-composer ${typing ? "focus" : ""}`}>
          <span className="wd-input">
            {typed ? <span className="wd-typed">{typed}</span> : <span className="wd-ph">Describe the beat…</span>}
            {typing && <i className="wd-caret" />}
          </span>
          <button className={`wd-send ${ready ? "ready" : ""} ${inP(P.send) ? "click" : ""}`}>SEND</button>
        </div>
      </div>
    </div>
  );
}

function Pill({
  icon,
  label,
  val,
  sel,
  click,
}: {
  icon: string;
  label: string;
  val?: string;
  sel: boolean;
  click: boolean;
}) {
  return (
    <span className={`wd-pill ${sel ? "sel" : ""} ${click ? "click" : ""}`}>
      <span className="wd-pill-ic">{icon}</span> {label}
      {sel && val ? <b> · {val}</b> : ""}
      {click && <span className="wd-tap" aria-hidden />}
    </span>
  );
}
