"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as store from "@/lib/store";
import {
  type Clip,
  GALLERY_KEY,
  SESSIONS_KEY,
  SESSION_ID_KEY,
  PW_KEY,
  PENDING_REF_KEY,
} from "@/lib/clip";
import { Rail } from "../rail";
import { ClipCardView } from "../clip-card";

/**
 * The full archive — its own page (not an overlay), so it keeps the left rail
 * and gets a real URL / back button. Reads the same `hooklab.*` store the
 * studio writes; "use as reference" hands a clip back to the studio via
 * PENDING_REF_KEY. Reached by client navigation from the rail, which keeps the
 * store's in-memory cache warm (fresh takes show without a disk round-trip).
 */

interface StoredSession {
  id: string;
  title: string;
}

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(store.get(key) ?? "") as T;
  } catch {
    return fallback;
  }
};

export default function ArchivePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  useEffect(() => {
    let cancelled = false;
    store.hydrate().then(() => {
      if (cancelled) return;
      setClips(loadJson<Clip[]>(GALLERY_KEY, []));
      setSessions(loadJson<StoredSession[]>(SESSIONS_KEY, []));
      setSessionId(store.get(SESSION_ID_KEY));
      setPw(store.get(PW_KEY) ?? "");
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const withPw = useCallback(
    (url: string) =>
      url.startsWith("/") && pw ? `${url}&pw=${encodeURIComponent(pw)}` : url,
    [pw],
  );

  const persist = (next: Clip[]) => {
    setClips(next);
    store.set(GALLERY_KEY, JSON.stringify(next));
  };

  const download = (videoUrl: string) => {
    const a = document.createElement("a");
    if (videoUrl.startsWith("/")) {
      a.href = `${withPw(videoUrl)}&dl=1`;
    } else {
      a.href = videoUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const removeClip = (jobId: string) =>
    persist(clips.filter((c) => c.jobId !== jobId));

  const clearArchive = () => {
    if (window.confirm("Clear the whole archive?")) persist([]);
  };

  /** Hand a GRAB clip back to the studio composer as a reference. */
  const useClipAsRef = (clip: Clip) => {
    store.set(PENDING_REF_KEY, JSON.stringify(clip));
    router.push("/chat");
  };

  const groups = (() => {
    const m = new Map<string, Clip[]>();
    for (const c of clips) {
      const k = c.sessionId ?? "earlier";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.entries()]
      .map(([key, list]) => ({
        key,
        label:
          key === sessionId
            ? "Current session"
            : sessions.find((s) => s.id === key)?.title ??
              (key === "earlier" ? "Earlier takes" : "Removed session"),
        list,
        latest: Math.max(...list.map((c) => c.createdAt)),
      }))
      .sort((a, b) => b.latest - a.latest);
  })();

  const go = (path: string) => router.push(path);

  return (
    <>
      <Rail
        active="archive"
        onHome={() => go("/chat?new=1")}
        onSessions={() => go("/chat?open=sessions")}
        onArchive={() => go("/archive")}
        onGrab={() => go("/chat?open=grab")}
        onNew={() => go("/chat?new=1")}
      />
      <div className="dash-page">
        <div className="archive-head">
          <span className="label">Archive · All Sessions · {clips.length}</span>
          <span className="session-tools">
            {clips.length > 0 && (
              <button className="link-btn danger" onClick={clearArchive}>
                Clear All
              </button>
            )}
            <button className="btn-ghost overlay-back" onClick={() => go("/chat")}>
              ← Back to Studio
            </button>
          </span>
        </div>
        <p className="archive-note">
          Every finished take, grouped by the session it came from. Stored in
          this browser only; providers purge source files (~2 days on Veo) —
          download anything you want to keep.
        </p>
        {ready && clips.length === 0 && (
          <p className="hint">Nothing archived yet.</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="archive-group">
            <span className="label">
              {g.label} · {g.list.length}
            </span>
            <div className="gallery-grid">
              {g.list.map((c) => (
                <ClipCardView
                  key={c.jobId}
                  clip={c}
                  withPw={withPw}
                  onDownload={download}
                  onRemove={removeClip}
                  onUse={useClipAsRef}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
