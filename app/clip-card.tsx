"use client";

import { PROVIDERS } from "@/lib/config";
import { type Clip, fmtCost, cssAspect } from "@/lib/clip";

/**
 * One archive card — shared by the studio's this-session strip and the
 * full-archive route. `onUse` (attach as reference) is only offered for GRABs.
 */
export function ClipCardView({
  clip,
  withPw,
  onDownload,
  onRemove,
  onUse,
  onDead,
}: {
  clip: Clip;
  withPw: (u: string) => string;
  onDownload: (u: string) => void;
  onRemove: (id: string) => void;
  onUse?: (clip: Clip) => void;
  /** Fired when the video fails to load (expired provider link) — lets the
   *  archive drop the card instead of showing a broken tile. */
  onDead?: (jobId: string) => void;
}) {
  // Resolve once: on hosted this is "" while the blob is still fetching, so the
  // onError guard below must ignore an empty src (not a real load failure).
  const src = clip.videoUrl ? withPw(clip.videoUrl) : "";
  return (
    <div className="card">
      <div className="thumb" style={{ aspectRatio: cssAspect(clip.aspectRatio) }}>
        {clip.videoUrl ? (
          <video
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
            onError={() => {
              if (src) onDead?.(clip.jobId);
            }}
          />
        ) : (
          <span className="thumb-state">Unavailable</span>
        )}
      </div>
      <div className="card-meta">
        <div className="card-row">
          <span>
            {clip.provider === "grab"
              ? "GRAB"
              : clip.modelLabel ??
                PROVIDERS[clip.provider]?.label ??
                clip.provider}{" "}
            · {clip.variantLabel}
          </span>
          <span>{clip.provider === "grab" ? "" : fmtCost(clip.costUsd) ?? ""}</span>
        </div>
        <p className="card-prompt" title={clip.prompt}>
          {clip.note ?? clip.prompt}
        </p>
        <div className="card-actions">
          {clip.provider === "grab" && clip.videoUrl && onUse && (
            <button className="link-btn ctx-on" onClick={() => onUse(clip)}>
              → Use as reference
            </button>
          )}
          {clip.videoUrl && (
            <button className="link-btn" onClick={() => onDownload(clip.videoUrl!)}>
              Download
            </button>
          )}
          <button className="link-btn danger" onClick={() => onRemove(clip.jobId)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
