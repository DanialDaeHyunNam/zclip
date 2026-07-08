"use client";

/**
 * The always-visible left rail — shared by the studio (/chat) and the
 * dashboard (/dashboard). On /chat the handlers toggle in-page overlays;
 * on /dashboard they navigate back to /chat with an ?open= hint the studio
 * reads on mount. Same markup, same CSS, so it feels like one surface.
 */

export type RailPanel = "sessions" | "archive" | "grab" | "dashboard";

export function Rail({
  active = null,
  onHome,
  onDashboard,
  onSessions,
  onArchive,
  onGrab,
  onAbout,
  version,
  hasUpdate = false,
  latest = null,
  onVersion,
  onHelp,
}: {
  active?: RailPanel | null;
  onHome: () => void;
  /** Opens the spend & config dashboard. Omit to hide the button. */
  onDashboard?: () => void;
  onSessions: () => void;
  onArchive: () => void;
  onGrab: () => void;
  /** Opens an in-app About dialog. When omitted, About is a plain link to `/`. */
  onAbout?: () => void;
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
      {/* 1 — Sessions */}
      <button
        className={`rail-btn ${active === "sessions" ? "on" : ""}`}
        onClick={onSessions}
        title="Sessions"
        aria-label="Toggle session sidebar"
      >
        ≡
      </button>
      {/* 2 — Dashboard */}
      {onDashboard && (
        <button
          className={`rail-btn ${active === "dashboard" ? "on" : ""}`}
          onClick={onDashboard}
          title="Dashboard — spend & config"
          aria-label="Dashboard"
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
            <line x1="6" y1="20" x2="6" y2="13" />
            <line x1="12" y1="20" x2="12" y2="8" />
            <line x1="18" y1="20" x2="18" y2="4" />
          </svg>
        </button>
      )}
      {/* 3 — Library */}
      <button
        className={`rail-btn ${active === "archive" ? "on" : ""}`}
        onClick={onArchive}
        title="Library — every take & reference, grouped by session"
        aria-label="Toggle library"
      >
        ▦
      </button>
      {/* 4 — Download / add a reference */}
      <button
        className={`rail-btn ${active === "grab" ? "on" : ""}`}
        onClick={onGrab}
        title="Add a reference — grab a video (YouTube / X / direct link) into the Library"
        aria-label="Add a reference to the library"
      >
        ⤓
      </button>
      {/* about — an in-app dialog on the studio (with a link home), else → `/` */}
      {onAbout ? (
        <button
          type="button"
          className="rail-btn rail-about"
          onClick={onAbout}
          title="About ZCLIP"
          aria-label="About"
        >
          <AboutGlyph />
        </button>
      ) : (
        <a
          className="rail-btn rail-about"
          href="/"
          title="About — the ZCLIP home page"
          aria-label="About"
        >
          <AboutGlyph />
        </a>
      )}

      {/* pinned to the bottom — help + version chip */}
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
      </div>
    </aside>
  );
}

/** The info (ⓘ) glyph — shared by the About button and link variants. */
function AboutGlyph() {
  return (
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
  );
}
