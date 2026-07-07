"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROVIDERS,
  COMING_SOON,
  priceLabel,
  type ProviderName,
} from "@/lib/config";

/**
 * Rich model dropdown (hand-rolled — no radix/Tailwind, to match the app's
 * design system). Flagship models show first; the rest live behind "All
 * models" along with not-yet-wired ones. Every row carries price, a one-line
 * strength, a quality meter, and key status so you can pick at a glance.
 */

const ORDER = Object.keys(PROVIDERS) as ProviderName[];

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
  value: ProviderName;
  onChange: (p: ProviderName) => void;
  keys: Record<string, boolean>;
  keysLoaded: boolean;
  onConnectKey: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
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

  const cur = PROVIDERS[value];
  const noKey = (p: ProviderName) => keysLoaded && !keys[PROVIDERS[p].envVar];
  const visible = ORDER.filter(
    (p) => showAll || PROVIDERS[p].tier === "recommended" || p === value,
  );

  const pick = (p: ProviderName) => {
    onChange(p);
    setOpen(false);
    if (noKey(p)) onConnectKey();
  };

  return (
    <div className="mp-wrap" ref={wrapRef}>
      <button
        className="mp-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={cur.note ?? cur.tagline}
      >
        <span className="mp-trigger-name">{cur.short}</span>
        {noKey(value) && <span className="mp-tag warn">key</span>}
        <svg className="mp-chev" width="9" height="6" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="mp-menu">
          <div className="mp-scroll">
            {visible.map((p) => {
              const m = PROVIDERS[p];
              return (
                <button
                  key={p}
                  className={`mp-item ${p === value ? "sel" : ""} ${noKey(p) ? "nokey" : ""}`}
                  onClick={() => pick(p)}
                >
                  <span className="mp-check">{p === value ? "✓" : ""}</span>
                  <span className="mp-body">
                    <span className="mp-name">
                      {m.short}
                      <span className="mp-co">{m.company}</span>
                      {m.tier === "recommended" && <span className="mp-tag rec">★</span>}
                      {m.transferOnly && <span className="mp-tag xfer">transfer</span>}
                      {noKey(p) && <span className="mp-tag warn">key</span>}
                    </span>
                    <span className="mp-spec">
                      {priceLabel(p)} · {m.tagline}
                    </span>
                  </span>
                  <span className="mp-meters">
                    <Meter n={m.quality} label="Quality" />
                    <Meter n={m.speed} label="Speed" />
                  </span>
                </button>
              );
            })}

            {showAll &&
              COMING_SOON.map((m) => (
                <div className="mp-item soon" key={m.short} title={m.note}>
                  <span className="mp-check" />
                  <span className="mp-body">
                    <span className="mp-name">
                      {m.short}
                      <span className="mp-co">{m.company}</span>
                      <span className="mp-tag soon">soon</span>
                    </span>
                    <span className="mp-spec">— · {m.tagline}</span>
                  </span>
                </div>
              ))}
          </div>
          <button className="mp-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Flagship only" : "All models"}
          </button>
        </div>
      )}
    </div>
  );
}
