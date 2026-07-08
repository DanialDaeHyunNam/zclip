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
  version,
  hasUpdate = false,
  latest = null,
  onVersion,
  onHelp,
}: {
  active?: RailPanel | null;
  onHome: () => void;
  onSessions: () => void;
  onArchive: () => void;
  onGrab: () => void;
  onNew: () => void;
  newDisabled?: boolean;
  /** Build version (e.g. "0.1.0"); omit to hide the chip. */
  version?: string;
  /** A newer version is deployed — the chip becomes a prominent update prompt. */
  hasUpdate?: boolean;
  latest?: string | null;
  onVersion?: () => void;
  /** Opens the in-app "how to use" help. */
  onHelp?: () => void;
}) {
  return (
    <aside className="rail">
      <button
        className="rail-logo"
        onClick={onHome}
        title="Fresh start — clears to a new session"
        aria-label="New session"
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
        title="Add a reference — grab a video (YouTube / X / direct link) into the Library"
        aria-label="Add a reference to the library"
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

      {/* pinned to the bottom — help + version chip + about/home affordance */}
      <div className="rail-foot">
        {onHelp && (
          <button
            type="button"
            className="rail-btn"
            onClick={onHelp}
            title="How to use ZCLIP"
            aria-label="How to use"
          >
            ?
          </button>
        )}
        {version && (
          <button
            type="button"
            className={`rail-ver ${hasUpdate ? "upd" : ""}`}
            onClick={onVersion}
            title={hasUpdate ? `Update available → v${latest}` : `v${version} · release notes`}
            aria-label={hasUpdate ? `Update available, v${latest}` : `Version ${version}`}
          >
            {hasUpdate ? "⬆" : `v${version}`}
          </button>
        )}
        <a
          className="rail-btn rail-about"
          href="/"
          title="About — the ZCLIP home page"
          aria-label="About"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.4" />
            <circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </div>
    </aside>
  );
}
