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
import { useHosted } from "@/lib/use-version";
import { Rail } from "../rail";
import { ClipCardView } from "../clip-card";

/**
 * The library — its own page (not an overlay), so it keeps the left rail and
 * gets a real URL / back button. Reads the same `hooklab.*` store the studio
 * writes; "use as reference" hands a clip back to the studio via
 * PENDING_REF_KEY. The GRAB tool (fetch a reference video from a URL) lives
 * here now — it's how you *add* to the library (dev-only; the composer's
 * drag/drop is the other way in). Reached by client navigation from the rail,
 * which keeps the store's in-memory cache warm.
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
  const hosted = useHosted();
  const [ready, setReady] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // GRAB — add a reference video by URL (dev-only; /api/grab is 403 on cloud)
  const [grabUrl, setGrabUrl] = useState("");
  const [grabStart, setGrabStart] = useState("");
  const [grabEnd, setGrabEnd] = useState("");
  const [grabVideos, setGrabVideos] = useState<
    { id: string; url: string; res: string }[] | null
  >(null);
  const [grabPick, setGrabPick] = useState<string | null>(null);
  const [grabBusy, setGrabBusy] = useState<"scan" | "fetch" | null>(null);
  const [grabErr, setGrabErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // ⤓ / dashboard deep-link opens the page with the add form already up
    if (new URLSearchParams(window.location.search).get("add") === "1") {
      setAddOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
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
  const pwHeaders = useCallback(
    (base: Record<string, string> = {}): Record<string, string> =>
      pw ? { ...base, "x-app-password": pw } : base,
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

  /** GRAB step 1 — X/Twitter posts can hold several videos; probe first so the
   *  user can pick. Everything else goes straight to fetch. */
  const grabScan = async () => {
    const url = grabUrl.trim();
    if (!url || grabBusy) return;
    setGrabErr(null);
    setGrabVideos(null);
    if (/^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(url)) {
      setGrabBusy("scan");
      try {
        const r = await fetch("/api/grab", {
          method: "POST",
          headers: pwHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ action: "probe", url }),
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Scan failed");
        if (b.videos) {
          setGrabVideos(b.videos);
          setGrabPick(b.videos[0]?.url ?? null);
          return;
        }
      } catch (e) {
        setGrabErr(e instanceof Error ? e.message : "Scan failed");
        return;
      } finally {
        setGrabBusy(null);
      }
    }
    await grabFetch(null);
  };

  /** GRAB step 2 — download (and optionally trim) on the server; the result is
   *  a GRAB clip added to the library right here. */
  const grabFetch = async (videoUrl: string | null) => {
    const url = videoUrl ?? grabPick ?? grabUrl.trim();
    if (!url || grabBusy) return;
    setGrabBusy("fetch");
    setGrabErr(null);
    try {
      const start = grabStart.trim() === "" ? null : Number(grabStart);
      const end = grabEnd.trim() === "" ? null : Number(grabEnd);
      if ((start != null && !Number.isFinite(start)) || (end != null && !Number.isFinite(end)))
        throw new Error("Trim values must be seconds, e.g. 3 and 9.5");
      const r = await fetch("/api/grab", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "fetch", url, start, end }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Download failed");
      const source = grabUrl.trim();
      const newClip: Clip = {
        jobId: b.name,
        sessionId: sessionId ?? undefined,
        provider: "grab",
        prompt: source,
        note: `Reference · ${source.replace(/^https?:\/\/(www\.)?/, "")}${
          start != null && end != null ? ` · ${start}–${end}s` : ""
        }`,
        variantLabel: "Reference",
        createdAt: Date.now(),
        status: "done",
        aspectRatio: "9:16",
        durationSeconds: start != null && end != null ? end - start : 0,
        resolution: "720p",
        videoUrl: b.url,
        costUsd: 0,
      };
      persist([newClip, ...clips]);
      setGrabUrl("");
      setGrabStart("");
      setGrabEnd("");
      setGrabVideos(null);
      setGrabPick(null);
    } catch (e) {
      setGrabErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setGrabBusy(null);
    }
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
        onGrab={() => setAddOpen(true)}
        onNew={() => go("/chat?new=1")}
      />
      <div className="dash-page">
        <div className="archive-head">
          <span className="label">Library · All Sessions · {clips.length}</span>
          <span className="session-tools">
            {!hosted && (
              <button
                className={`link-btn ${addOpen ? "ctx-on" : ""}`}
                onClick={() => setAddOpen((o) => !o)}
              >
                {addOpen ? "✕ Close" : "＋ Add reference"}
              </button>
            )}
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
          Every finished take piles in here automatically, grouped by the
          session it came from. Add your own references with{" "}
          <b>＋ Add reference</b> (GRAB a video by URL), or drop a video onto
          the composer in the studio. Stored in this browser only; providers
          purge source files (~2 days on Veo) — download anything you want to keep.
        </p>

        {/* add a reference — GRAB by URL, collapsed until ＋ (dev only, since
            /api/grab is 403 on cloud). Direct upload happens in the composer. */}
        {!hosted && addOpen && (
          <div className="grab-card library-grab fade">
            <p className="archive-note grab-lead">
              Pull a video onto this machine so it can drive a take — a YouTube
              link, an X post (x.com/user/status/…), or a direct .mp4 URL.
              Optional trim keeps only the beat you want. Local dev tool; use
              sources you have the rights to reference.
            </p>
            <div className="grab-row">
              <input
                className="grab-input"
                type="url"
                placeholder="https://x.com/user/status/…  ·  youtube.com/watch?v=…  ·  …mp4"
                value={grabUrl}
                onChange={(e) => setGrabUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && grabScan()}
                disabled={Boolean(grabBusy)}
              />
              <button
                className="btn-ghost"
                onClick={grabScan}
                disabled={!grabUrl.trim() || Boolean(grabBusy)}
              >
                {grabBusy === "scan" ? "SCANNING…" : grabBusy === "fetch" ? "FETCHING…" : "FETCH"}
              </button>
            </div>
            {grabVideos && (
              <div className="grab-videos">
                <span className="label">
                  {grabVideos.length} video{grabVideos.length > 1 ? "s" : ""} in this post
                </span>
                {grabVideos.map((v, i) => (
                  <label key={v.id} className="grab-video-opt">
                    <input
                      type="radio"
                      name="grab-pick"
                      checked={grabPick === v.url}
                      onChange={() => setGrabPick(v.url)}
                    />
                    <span className="mono">
                      VIDEO {i + 1} · {v.res}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="grab-row grab-trim">
              <span className="label">Trim (optional)</span>
              <input
                className="grab-num"
                type="number"
                min={0}
                step={0.5}
                placeholder="from s"
                value={grabStart}
                onChange={(e) => setGrabStart(e.target.value)}
                disabled={Boolean(grabBusy)}
              />
              <span className="mono">→</span>
              <input
                className="grab-num"
                type="number"
                min={0}
                step={0.5}
                placeholder="to s"
                value={grabEnd}
                onChange={(e) => setGrabEnd(e.target.value)}
                disabled={Boolean(grabBusy)}
              />
              {grabVideos && (
                <button
                  className="btn-ghost"
                  onClick={() => grabFetch(null)}
                  disabled={!grabPick || Boolean(grabBusy)}
                >
                  {grabBusy === "fetch" ? "FETCHING…" : "DOWNLOAD"}
                </button>
              )}
            </div>
            {grabErr && <div className="error-box">{grabErr}</div>}
          </div>
        )}

        {ready && clips.length === 0 && (
          <p className="hint">
            Nothing in the library yet — finished takes land here automatically
            {!hosted ? ", or ＋ Add a reference above" : ""}.
          </p>
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
