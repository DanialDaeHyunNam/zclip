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
  const list = company ? MODELS.filter((m) => m.company === company) : MODELS;

  const pick = (m: ModelEntry) => {
    if (m.comingSoon) return;
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

          <div className="mp-scroll">
            {list.map((m) => (
              <button
                key={m.key}
                className={`mp-item ${m.key === value ? "sel" : ""} ${m.comingSoon ? "soon" : ""} ${noKey(m) && !m.comingSoon ? "nokey" : ""}`}
                onClick={() => pick(m)}
                disabled={m.comingSoon}
              >
                <span className="mp-check">{m.key === value ? "✓" : ""}</span>
                <span className="mp-body">
                  <span className="mp-name">
                    {m.short}
                    <span className="mp-co">{m.company}</span>
                    {m.recommended && <span className="mp-tag rec">★</span>}
                    {m.transferOnly && <span className="mp-tag xfer">transfer</span>}
                    {m.comingSoon && <span className="mp-tag soon">soon</span>}
                    {!m.comingSoon && noKey(m) && <span className="mp-tag warn">key</span>}
                  </span>
                  <span className="mp-spec">
                    {modelPriceLabel(m)} · {m.tagline}
                  </span>
                </span>
                {!m.comingSoon && (
                  <span className="mp-meters">
                    <Meter n={m.quality} label="Quality" />
                    <Meter n={m.speed} label="Speed" />
                  </span>
                )}
              </button>
            ))}
            {list.length === 0 && <p className="mp-empty">No models for {company}.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
