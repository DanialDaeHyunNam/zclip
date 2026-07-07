"use client";

/**
 * The always-visible left rail — shared by the studio (/chat) and the
 * dashboard (/dashboard). On /chat the handlers toggle in-page overlays;
 * on /dashboard they navigate back to /chat with an ?open= hint the studio
 * reads on mount. Same markup, same CSS, so it feels like one surface.
 */

export type RailPanel = "sessions" | "archive" | "grab";

export function Rail({
  active = null,
  onHome,
  onSessions,
  onArchive,
  onGrab,
  onNew,
  newDisabled = false,
}: {
  active?: RailPanel | null;
  onHome: () => void;
  onSessions: () => void;
  onArchive: () => void;
  onGrab: () => void;
  onNew: () => void;
  newDisabled?: boolean;
}) {
  return (
    <aside className="rail">
      <button
        className="rail-logo"
        onClick={onHome}
        title="Back to the studio"
        aria-label="Home"
      >
        Z<span>_</span>
      </button>
      <button
        className={`rail-btn ${active === "sessions" ? "on" : ""}`}
        onClick={onSessions}
        title="Sessions"
        aria-label="Toggle session sidebar"
      >
        ≡
      </button>
      <button
        className={`rail-btn ${active === "archive" ? "on" : ""}`}
        onClick={onArchive}
        title="Archive — every take, grouped by session"
        aria-label="Toggle archive"
      >
        ▦
      </button>
      <button
        className={`rail-btn ${active === "grab" ? "on" : ""}`}
        onClick={onGrab}
        title="Grab — download a reference video from YouTube / X / a direct link"
        aria-label="Toggle video grabber"
      >
        ⤓
      </button>
      <button
        className="rail-btn"
        onClick={onNew}
        disabled={newDisabled}
        title="New session"
        aria-label="New session"
      >
        ＋
      </button>
    </aside>
  );
}
