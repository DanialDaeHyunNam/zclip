"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODELS,
  COMPANIES,
  PROVIDERS,
  modelPriceLabel,
  resolveModel,
  type ModelEntry,
} from "@/lib/config";

/**
 * Rich model picker (hand-rolled — no radix/Tailwind, to match the app's
 * design system). Everything shows by default; company chips filter the list
 * like a shopping browser. Each row carries price, a one-line strength, a
 * quality + speed meter, and key status. Not-yet-wired models show greyed out.
 */

/** Street reputation per model — market chatter (arena leaderboards,
 *  review roundups, Jul 2026) blended with ZCLIP field notes. Niches,
 *  not a ranking: every entry is "best at X", none is "best". */
const GUIDE: {
  name: string;
  co: string;
  verdict: string;
  detail: string;
}[] = [
  {
    name: "Veo 3.1",
    co: "Google",
    verdict: "Cinematic-polish king",
    detail:
      "Best photorealism, camera control and complex-scene consistency (crowds, natural light, architecture); native synced audio. Premium price. Field note: follows cut boards + props well — watch for selfie-arm anatomy artifacts on the fast tier.",
  },
  {
    name: "Sora 2",
    co: "OpenAI",
    verdict: "Physics king",
    detail:
      "Unmatched object weight, momentum and shot-to-shot coherence; storyboard-style narrative strength. Slowest of the pack (extra safety pass), watermark, base model tops out at 720×1280.",
  },
  {
    name: "Grok Imagine",
    co: "xAI",
    verdict: "#1 image-to-video Arena (since May 2026)",
    detail:
      "Cheapest + fastest audio-complete clips from a strong still — exactly the card-based hook use case. 720p cap; faces soften under fast motion (slow reactions are safe); English prompts only. Field note: obeys spec structure, acting below bar for dialogue comedy.",
  },
  {
    name: "Seedance 2.0",
    co: "ByteDance",
    verdict: "Control & motion king",
    detail:
      "Takes image/video/audio references (reads the WHOLE clip incl. sound), most fluid motion and character animation, fastest generation, cheap. The reference-driven workhorse — and the only one here that keeps SPEC mode with a video reference.",
  },
  {
    name: "Act-Two",
    co: "Runway",
    verdict: "The only TRUE performance transfer",
    detail:
      "Drives your face card with a real clip's motion, frame-accurate — no prompt at all. Use when the choreography IS the point.",
  },
  {
    name: "Kling 3.0",
    co: "Kuaishou",
    verdict: "Volume king — cheapest fluid motion",
    detail:
      "The market's default 'make it move' step: most natural motion per dollar (~$0.30 per 10s clip), the animation half of the viral still→motion pipelines (AI-influencer reels: image model makes the face, Kling makes it breathe). 5/10s grid, needs its own API plan. Our adapter is UNVERIFIED until a first billed run.",
  },
];

function Meter({ n, label }: { n: number; label: string }) {
  return (
    <span className="mp-meter" title={`${label}: ${n}/3`} aria-label={`${label} ${n} of 3`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

export function ModelPicker({
  value,
  onChange,
  keys,
  keysLoaded,
  onConnectKey,
  disabled,
}: {
  value: string;
  onChange: (key: string) => void;
  keys: Record<string, boolean>;
  keysLoaded: boolean;
  onConnectKey: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [guide, setGuide] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const cur = resolveModel(value);
  const curNoKey = keysLoaded && !keys[cur.envVar];
  const noKey = (m: ModelEntry) => keysLoaded && !keys[m.envVar];

  // Default view = one headline model per company. A company chip shows that
  // brand's full line-up; "All models" reveals every variant across brands.
  const base = company ? MODELS.filter((m) => m.company === company) : MODELS;
  const list =
    company || showAll ? base : base.filter((m) => m.primary || m.key === value);
  const hiddenCount = MODELS.length - MODELS.filter((m) => m.primary).length;

  const pick = (m: ModelEntry) => {
    onChange(m.key);
    setOpen(false);
    if (noKey(m)) onConnectKey();
  };

  return (
    <div className="mp-wrap" ref={wrapRef}>
      <button
        className="mp-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={PROVIDERS[cur.provider].note ?? cur.tagline}
      >
        <span className="mp-trigger-name">{cur.short}</span>
        {curNoKey && <span className="mp-tag warn">key</span>}
        <svg className="mp-chev" width="9" height="6" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="mp-menu">
          <div className="mp-chips">
            <button
              className={`mp-chip ${company === null ? "on" : ""}`}
              onClick={() => setCompany(null)}
            >
              All
            </button>
            {COMPANIES.map((c) => (
              <button
                key={c}
                className={`mp-chip ${company === c ? "on" : ""}`}
                onClick={() => setCompany((cur) => (cur === c ? null : c))}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mp-guide-row">
            <button
              className={`mp-guide-btn ${guide ? "on" : ""}`}
              onClick={() => setGuide((v) => !v)}
              title="What the market says each model is best at (Jul 2026) + our field notes"
            >
              {guide ? "← Models" : "Guide ?"}
            </button>
          </div>

          {guide ? (
            <div className="mp-scroll mp-guide">
              {GUIDE.map((g) => (
                <div key={g.name} className="mp-guide-item">
                  <span className="mp-name">
                    {g.name}
                    <span className="mp-co">{g.co}</span>
                  </span>
                  <span className="mp-guide-verdict">{g.verdict}</span>
                  <span className="mp-guide-detail">{g.detail}</span>
                </div>
              ))}
              <p className="mp-guide-foot">
                Market chatter as of Jul 2026 (i2v arena leaderboards, review
                roundups) + ZCLIP field notes. Niches, not rankings — pick by
                the take, not the hype.
              </p>
            </div>
          ) : (
          <div className="mp-scroll">
            {list.map((m) => (
              <button
                key={m.key}
                className={`mp-item ${m.key === value ? "sel" : ""} ${noKey(m) ? "nokey" : ""}`}
                onClick={() => pick(m)}
              >
                <span className="mp-check">{m.key === value ? "✓" : ""}</span>
                <span className="mp-body">
                  <span className="mp-name">
                    {m.short}
                    <span className="mp-co">{m.company}</span>
                    {m.recommended && <span className="mp-tag rec">★</span>}
                    {m.transferOnly && <span className="mp-tag xfer">transfer</span>}
                    {noKey(m) && <span className="mp-tag warn">key</span>}
                  </span>
                  <span className="mp-spec">
                    {modelPriceLabel(m)} · {m.tagline}
                  </span>
                </span>
                <span className="mp-meters">
                  <Meter n={m.quality} label="Quality" />
                  <Meter n={m.speed} label="Speed" />
                </span>
              </button>
            ))}
            {list.length === 0 && <p className="mp-empty">No models for {company}.</p>}
          </div>
          )}

          {!guide && company === null && hiddenCount > 0 && (
            <button className="mp-toggle" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Headline models only" : `All models (+${hiddenCount} variants)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
