"use client";

import { useEffect } from "react";
import Link from "next/link";
import { VERSION, RELEASES_URL } from "@/lib/version";
import { REPO_URL } from "@/lib/links";

/**
 * In-studio "About" modal — opened from the rail's ⓘ. Same modal language as the
 * help/update dialogs so it never yanks you out to the full marketing landing
 * mid-session; a "View the full landing" link is the intentional way home.
 */
export function AboutModal({ onClose }: { onClose: () => void }) {
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
    <div className="rlg-modal" role="dialog" aria-modal="true" aria-label="About ZCLIP" onClick={onClose}>
      <div className="rlg-modal-card about-card" onClick={(e) => e.stopPropagation()}>
        <div className="rlg-modal-head">
          <span className="wordmark">
            ZCLIP<span>_</span>
          </span>
          <button type="button" className="rlg-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rlg-modal-body">
          <header className="rlg-hero about-hero">
            <span className="rlg-badge">◆ About</span>
            <h1>
              UGC reaction hooks,
              <br />
              <span className="about-accent">typed — not filmed.</span>
            </h1>
            <p>
              Chat out the scroll-stopping first 3 seconds of your ad, then iterate
              take by take. Runs on your own machine and your own keys.
            </p>
            <p className="about-meta">
              Open source · MIT ·{" "}
              <a href={RELEASES_URL} target="_blank" rel="noreferrer">
                v{VERSION}
              </a>
            </p>
          </header>
          <div className="rlg-cta-row">
            <a className="btn-ghost ld-star" href={REPO_URL} target="_blank" rel="noreferrer">
              <span className="ld-star-icon">★</span> Star on GitHub
            </a>
            <Link className="btn-ghost" href="/">
              View the full landing →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
