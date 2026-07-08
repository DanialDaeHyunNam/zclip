"use client";

import { useEffect } from "react";
import { HowToList } from "../how-to";

/**
 * In-app "how to use" help — opened from the ? in the rail. Same visual
 * language as the install/update modals. The studio is English-only, so this
 * renders the English how-to (see app/how-to.tsx for the shared content, also
 * shown bilingually in the install guide's "What you can do" section).
 */
export function HelpGuide({ onClose }: { onClose: () => void }) {
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
    <div className="rlg-modal" role="dialog" aria-modal="true" aria-label="How to use ZCLIP" onClick={onClose}>
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
            <span className="rlg-badge">◆ How to use</span>
            <h1>Making a clip</h1>
            <p>
              Chat out the first three seconds. Pick a face and a room, describe the beat,
              and iterate take by take — every take becomes context for the next.
            </p>
          </header>
          <section className="rlg-section">
            <HowToList lang="en" />
          </section>
          <div className="rlg-cta-row">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
