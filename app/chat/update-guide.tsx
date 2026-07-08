"use client";

import { useEffect, useState } from "react";
import { VERSION, RELEASES_URL } from "@/lib/version";

/**
 * Shown on a LOCAL copy when a newer version is deployed (see useUpdateCheck).
 * Same visual language as the install guide's modal, but for updating: an
 * AI-CLI one-liner (recommended) + a manual `git pull` path. The user's keys
 * (.env.local) and sessions (.zclip-data) are untouched by an update.
 */

const UPDATE_CMDS = "git pull\nbun install\nbun dev";
const AI_PROMPT =
  "Update this ZCLIP folder to the latest version and restart it: git pull, then bun install, then restart the dev server (bun dev). Leave my .env.local and .zclip-data untouched.";

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`rlg-copy ${ok ? "ok" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

export function UpdateGuide({ latest, onClose }: { latest: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="rlg-modal" role="dialog" aria-modal="true" aria-label="Update available" onClick={onClose}>
      <div className="rlg-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="rlg-modal-head">
          <span className="wordmark">
            ZCLIP<span>_</span>
          </span>
          <button type="button" className="rlg-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rlg-modal-body">
          <header className="rlg-hero">
            <span className="rlg-badge">◆ Update available</span>
            <h1>A newer version is out.</h1>
            <div className="upd-vers">
              <span className="upd-ver old">v{VERSION}</span>
              <span className="upd-arrow" aria-hidden>→</span>
              <span className="upd-ver new">v{latest ?? "?"}</span>
            </div>
            <p>
              Updating pulls the latest code and restarts the dev server — your keys
              (<code>.env.local</code>) and sessions (<code>.zclip-data</code>) are untouched.
            </p>
          </header>

          {/* recommended: an AI coding CLI does it in one prompt */}
          <section className="rlg-section">
            <div className="rlg-cli">
              <div className="rlg-cli-head">
                <span className="rlg-cli-title">⚡ Easiest — an AI coding CLI</span>
                <span className="rlg-cli-badge">Recommended</span>
              </div>
              <p className="rlg-cli-body">
                Open Claude Code / Cursor in your ZCLIP folder and paste this one line:
              </p>
              <div className="rlg-cli-prompt">
                <p>{AI_PROMPT}</p>
                <CopyBtn text={AI_PROMPT} />
              </div>
            </div>
            <div className="rlg-or">Or, update manually ↓</div>
          </section>

          {/* manual: git pull + reinstall + restart */}
          <section className="rlg-section">
            <h2 className="rlg-h2">Manual update</h2>
            <p className="rlg-cli-body">In your ZCLIP folder&apos;s terminal:</p>
            <div className="rlg-term os-mac">
              <div className="rlg-bar">
                <span className="rlg-dots" aria-hidden>
                  <i /><i /><i />
                </span>
                <span className="rlg-bar-title">Terminal</span>
              </div>
              <div className="rlg-term-body">
                <pre>
                  <code>
                    {UPDATE_CMDS.split("\n").map((l, i) => (
                      <span key={i} className="rlg-line">
                        <span className="rlg-prompt">$</span> {l}
                        {"\n"}
                      </span>
                    ))}
                  </code>
                </pre>
                <CopyBtn text={UPDATE_CMDS} />
              </div>
            </div>
          </section>

          <div className="rlg-cta-row">
            <a className="btn-ghost" href={RELEASES_URL} target="_blank" rel="noreferrer">
              What&apos;s new ↗
            </a>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
