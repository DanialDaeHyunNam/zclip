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
  isLocalVideoUrl,
} from "@/lib/clip";
import { useHosted } from "@/lib/use-version";
import { keyHeader, videoUrlEnvVar } from "@/lib/client-keys";
import { cachedSrc, fetchBlobSrc } from "@/lib/video-src";
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

/** A generated look image, read straight out of `hooklab.flows` — flows stay
 *  the source of truth (no copy in the gallery), so a look lives and dies
 *  with its flow. Uploaded/shared placeholders ("(uploaded …)") are skipped:
 *  the library lists what ZCLIP *generated*. */
interface PhotoItem {
  id: string;
  sessionId?: string;
  image: string; // dataURL
  prompt: string;
  createdAt: number;
  flowTitle: string;
}

/** Everything the library can show, video or photo, in one filterable list. */
type LibItem = { kind: "video"; clip: Clip } | { kind: "photo"; photo: PhotoItem };
const itemAt = (i: LibItem) =>
  i.kind === "video" ? i.clip.createdAt : i.photo.createdAt;
const itemSession = (i: LibItem) =>
  (i.kind === "video" ? i.clip.sessionId : i.photo.sessionId) ?? "earlier";
const itemKey = (i: LibItem) =>
  i.kind === "video" ? i.clip.jobId : `photo-${i.photo.id}`;

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(store.get(key) ?? "") as T;
  } catch {
    return fallback;
  }
};

/** Human timecode → seconds: "6:30" → 390, "1:02:05" → 3725, "95.5" → 95.5.
 *  Empty → null (no trim). Malformed → NaN (caller surfaces the error). */
const parseTimecode = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p)))
    return NaN;
  // Sub-units (minutes/seconds after a colon) must stay under 60.
  if (parts.slice(1).some((p) => Number(p) >= 60)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
};

/** Seconds → "m:ss" (or "h:mm:ss") for display. */
const fmtClock = (s: number): string => {
  const whole = Math.floor(s);
  const frac = s - whole ? String(+(s - whole).toFixed(2)).slice(1) : "";
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;
  const mmss = `${m}:${String(sec).padStart(2, "0")}${frac}`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${frac}` : mmss;
};

export default function ArchivePage() {
  const router = useRouter();
  const hosted = useHosted();
  const [ready, setReady] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  // Gone takes (expired provider link / no saved copy) — hidden from the grid
  // but kept in `clips` so the spend ledger and Clear All still see them.
  const [dead, setDead] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [filter, setFilter] = useState<"all" | "video" | "photo">("all");
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Clear All — a real warning dialog (native confirm undersells what's lost)
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearErr, setClearErr] = useState<string | null>(null);
  const [vaultBytes, setVaultBytes] = useState<number | null>(null);

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
      // generated look images, read out of the flows (read-only here)
      const flows = loadJson<
        {
          title?: string;
          sessionId?: string;
          imgAttempts?: { id: string; prompt?: string; image?: string; createdAt?: number }[];
        }[]
      >("hooklab.flows", []);
      setPhotos(
        flows.flatMap((f) =>
          (f.imgAttempts ?? [])
            .filter(
              (a) =>
                typeof a.image === "string" &&
                a.image.startsWith("data:image/") &&
                a.prompt?.trim() &&
                !a.prompt.trim().startsWith("("),
            )
            .map((a) => ({
              id: a.id,
              sessionId: f.sessionId,
              image: a.image!,
              prompt: a.prompt!.trim(),
              createdAt: a.createdAt ?? 0,
              flowTitle: f.title ?? "Flow",
            })),
        ),
      );
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

  /** Hosted Veo/Sora playback: key in a header, never the URL — fetch the
   *  MP4 and hand <video> a blob: object URL (docs/HOSTED.md §3.2). */
  const [, setSrcEpoch] = useState(0);
  const videoSrc = useCallback(
    (url: string): string => {
      const envVar = hosted ? videoUrlEnvVar(url) : null;
      if (!envVar) return withPw(url);
      const hit = cachedSrc(url);
      if (hit) return hit;
      void fetchBlobSrc(url, keyHeader(envVar, pwHeaders()))
        .then(() => setSrcEpoch((n) => n + 1))
        .catch(() => {});
      return "";
    },
    [hosted, withPw, pwHeaders],
  );

  const persist = (next: Clip[]) => {
    setClips(next);
    store.set(GALLERY_KEY, JSON.stringify(next));
  };

  const download = async (videoUrl: string) => {
    const a = document.createElement("a");
    const envVar =
      hosted && videoUrl.startsWith("/") ? videoUrlEnvVar(videoUrl) : null;
    if (envVar) {
      try {
        a.href = await fetchBlobSrc(videoUrl, keyHeader(envVar, pwHeaders()));
        a.download = `reaction-hook-${Date.now()}.mp4`;
      } catch {
        setGrabErr(
          "Download failed — the provider may have already expired this file.",
        );
        return;
      }
    } else if (videoUrl.startsWith("/")) {
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

  /* per-clip PERMANENT delete — confirm modal first, then the vaulted
   * file on disk (clips or grabs) AND the gallery entry go together. */
  const [delAsk, setDelAsk] = useState<Clip | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const removeClip = (jobId: string) => {
    const c = clips.find((x) => x.jobId === jobId);
    if (c) {
      setDelErr(null);
      setDelAsk(c);
    }
  };

  const deleteForever = async () => {
    if (!delAsk || delBusy) return;
    setDelBusy(true);
    setDelErr(null);
    try {
      if (!hosted && isLocalVideoUrl(delAsk.videoUrl)) {
        const url = delAsk.videoUrl!.startsWith("/api/grab")
          ? `/api/grab?f=${encodeURIComponent(new URLSearchParams(delAsk.videoUrl!.split("?")[1] ?? "").get("f") ?? "")}`
          : `/api/clips?jobId=${encodeURIComponent(delAsk.jobId)}`;
        const r = await fetch(url, { method: "DELETE", headers: pwHeaders() });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.error ?? "Couldn't delete the saved file");
        }
      }
      persist(clips.filter((c) => c.jobId !== delAsk.jobId));
      setDelAsk(null);
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDelBusy(false);
    }
  };

  const fmtBytes = (b: number) =>
    b >= 1e9
      ? `${(b / 1e9).toFixed(1)} GB`
      : b >= 1e6
        ? `${Math.round(b / 1e6)} MB`
        : `${Math.max(1, Math.round(b / 1e3))} KB`;

  /** Open the Clear All dialog and look up how much disk it would free
   *  (saved takes + grabbed references). */
  const openClear = () => {
    setClearErr(null);
    setVaultBytes(null);
    setClearOpen(true);
    if (hosted) return;
    void Promise.all([
      fetch("/api/clips?usage=1", { headers: pwHeaders() }).then((r) => r.json()),
      fetch("/api/grab?usage=1", { headers: pwHeaders() }).then((r) => r.json()),
    ])
      .then(([c, g]) => setVaultBytes((c.bytes ?? 0) + (g.bytes ?? 0)))
      .catch(() => setVaultBytes(null));
  };

  /** Delete every saved video file (vault + grabs) AND the library entries.
   *  Permanent — providers purge their copies within days, so nothing can be
   *  re-downloaded afterwards. */
  const clearAll = async () => {
    if (clearBusy) return;
    setClearBusy(true);
    setClearErr(null);
    try {
      if (!hosted) {
        const results = await Promise.all([
          fetch("/api/clips", { method: "DELETE", headers: pwHeaders() }),
          fetch("/api/grab", { method: "DELETE", headers: pwHeaders() }),
        ]);
        const failed = results.find((r) => !r.ok);
        if (failed) {
          const b = await failed.json().catch(() => ({}));
          throw new Error(b.error ?? "Couldn't delete the saved files");
        }
      }
      persist([]);
      setClearOpen(false);
    } catch (e) {
      setClearErr(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearBusy(false);
    }
  };

  useEffect(() => {
    if (!clearOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !clearBusy) setClearOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clearOpen, clearBusy]);

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
      // Users type clock time (6:30); the server keeps speaking seconds.
      const start = parseTimecode(grabStart);
      const end = parseTimecode(grabEnd);
      if ((start != null && !Number.isFinite(start)) || (end != null && !Number.isFinite(end)))
        throw new Error("Trim looks off — use minutes:seconds like 6:30, or plain seconds like 390.");
      if (start != null && end != null && end <= start)
        throw new Error("Trim end must be after the start.");
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
          start != null && end != null ? ` · ${fmtClock(start)}–${fmtClock(end)}` : ""
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

  /** Save a generated look (a dataURL) as a file. */
  const downloadPhoto = (p: PhotoItem) => {
    const ext = /^data:image\/(\w+)/.exec(p.image)?.[1] ?? "png";
    const a = document.createElement("a");
    a.href = p.image;
    a.download = `zclip-look-${p.createdAt || Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const markDead = useCallback((jobId: string) => {
    setDead((prev) => (prev.has(jobId) ? prev : new Set(prev).add(jobId)));
  }, []);

  /* Only playable takes reach the grid: a take with no saved URL, or one whose
     provider link has expired (marked dead on load error), is hidden. The full
     `clips` array stays intact for the spend ledger and Clear All. */
  const shownClips = clips.filter((c) => c.videoUrl && !dead.has(c.jobId));
  const shownCount = shownClips.length + photos.length;

  /* videos + generated photos in one list, cut by the ALL/VIDEO/PHOTO filter,
     grouped by owning session, newest first inside each group */
  const items: LibItem[] = [
    ...(filter !== "photo"
      ? shownClips.map((clip) => ({ kind: "video" as const, clip }))
      : []),
    ...(filter !== "video"
      ? photos.map((photo) => ({ kind: "photo" as const, photo }))
      : []),
  ];
  const groups = (() => {
    const m = new Map<string, LibItem[]>();
    for (const i of items) {
      const k = itemSession(i);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()]
      .map(([key, list]) => ({
        key,
        label:
          key === sessionId
            ? "Current session"
            : sessions.find((s) => s.id === key)?.title ??
              (key === "earlier" ? "Earlier takes" : "Removed session"),
        list: list.sort((a, b) => itemAt(b) - itemAt(a)),
        latest: Math.max(...list.map(itemAt)),
      }))
      .sort((a, b) => b.latest - a.latest);
  })();

  const go = (path: string) => router.push(path);

  return (
    <>
      <Rail
        active="archive"
        onHome={() => go("/chat?new=1")}
        onDashboard={() => go("/dashboard")}
        onSessions={() => go("/chat?open=sessions")}
        onArchive={() => go("/archive")}
        onGrab={() => setAddOpen(true)}
      />
      <div className="dash-page">
        <div className="archive-head">
          <span className="label">
            Library · All Sessions · {shownCount}
          </span>
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
              <button className="link-btn danger" onClick={openClear}>
                Clear All
              </button>
            )}
            <button className="btn-ghost overlay-back" onClick={() => go("/chat")}>
              ← Back to Studio
            </button>
          </span>
        </div>
        {/* what's shown: everything / finished takes+references / generated looks */}
        <div className="lib-filters">
          {(
            [
              { k: "all", label: `ALL · ${shownCount}` },
              { k: "video", label: `VIDEO · ${shownClips.length}` },
              { k: "photo", label: `PHOTO · ${photos.length}` },
            ] as const
          ).map((f) => (
            <button
              key={f.k}
              className={`spec-chip ${filter === f.k ? "sel" : ""}`}
              onClick={() => setFilter(f.k)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="archive-note">
          Every finished take piles in here automatically, grouped by the
          session it came from — generated look images from the FLOW method
          too (a look lives inside its flow; remove it there).{" "}
          {hosted ? (
            <>
              Stored in this browser only — providers purge their files within
              days (~2 on Veo) and the hosted app can&apos;t vault them, so{" "}
              <b>download anything you want to keep</b>. A{" "}
              <a href="/install">local install</a> vaults every take to disk
              automatically.
            </>
          ) : (
            <>
              Add your own references with <b>＋ Add reference</b> (GRAB a
              video by URL), or drop a video onto the composer in the studio.
              Takes are vaulted to <code>.zclip-data/</code> on this machine;
              providers purge their own copies within days (~2 on Veo).
            </>
          )}
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
                type="text"
                inputMode="numeric"
                placeholder="from 6:30"
                title="minutes:seconds (6:30) or plain seconds (390)"
                value={grabStart}
                onChange={(e) => setGrabStart(e.target.value)}
                disabled={Boolean(grabBusy)}
              />
              <span className="mono">→</span>
              <input
                className="grab-num"
                type="text"
                inputMode="numeric"
                placeholder="to 9:45"
                title="minutes:seconds (9:45) or plain seconds (585)"
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

        {ready && items.length === 0 && (
          <p className="hint">
            {filter === "photo"
              ? "No generated images yet — looks made in the FLOW method land here."
              : `Nothing in the library yet — finished takes land here automatically${!hosted ? ", or ＋ Add a reference above" : ""}.`}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="archive-group">
            <span className="label">
              {g.label} · {g.list.length}
            </span>
            <div className="gallery-grid">
              {g.list.map((item) =>
                item.kind === "video" ? (
                  <ClipCardView
                    key={itemKey(item)}
                    clip={item.clip}
                    withPw={videoSrc}
                    onDownload={download}
                    onRemove={removeClip}
                    onUse={useClipAsRef}
                    onDead={markDead}
                  />
                ) : (
                  <div key={itemKey(item)} className="card">
                    <div className="thumb" style={{ aspectRatio: "9 / 16" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.photo.image}
                        alt=""
                        className="thumb-photo"
                      />
                    </div>
                    <div className="card-meta">
                      <div className="card-row">
                        <span>LOOK · {item.photo.flowTitle}</span>
                        <span />
                      </div>
                      <p className="card-prompt" title={item.photo.prompt}>
                        {item.photo.prompt}
                      </p>
                      <div className="card-actions">
                        <button
                          className="link-btn"
                          onClick={() => downloadPhoto(item.photo)}
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {/* per-clip delete — permanence spelled out, file + entry together */}
      {delAsk && (
        <div
          className="rlg-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Delete this video"
          onClick={() => !delBusy && setDelAsk(null)}
        >
          <div className="rlg-modal-card about-card" onClick={(e) => e.stopPropagation()}>
            <div className="rlg-modal-head">
              <span className="label">Delete this video — permanently</span>
              <button
                type="button"
                className="rlg-modal-close"
                onClick={() => setDelAsk(null)}
                aria-label="Close"
                disabled={delBusy}
              >
                ✕
              </button>
            </div>
            <div className="rlg-modal-body">
              <p className="archive-note">
                <b>“{(delAsk.note ?? delAsk.prompt).slice(0, 80)}”</b>
                {" — "}
                {delAsk.provider === "grab" ? "grabbed reference" : `take · ${delAsk.variantLabel}`}
              </p>
              <p className="archive-note">
                The saved file is deleted from this machine and the entry
                leaves the Library <b>permanently</b> — it can&apos;t be played
                again or used as a reference (providers purge their own
                copies within days, so nothing can be re-downloaded).
                {delAsk.costUsd != null
                  ? " The dashboard's spend history loses this take."
                  : ""}{" "}
                Download it first if you want a copy.
              </p>
              {delErr && <div className="error-box">{delErr}</div>}
              <div className="rlg-cta-row">
                <button
                  className="btn-ghost"
                  onClick={() => setDelAsk(null)}
                  disabled={delBusy}
                >
                  Cancel
                </button>
                <button
                  className="btn-ghost btn-danger"
                  onClick={deleteForever}
                  disabled={delBusy}
                >
                  {delBusy ? "DELETING…" : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear All — spells out exactly what is lost before anything deletes */}
      {clearOpen && (
        <div
          className="rlg-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Clear all saved videos"
          onClick={() => !clearBusy && setClearOpen(false)}
        >
          <div className="rlg-modal-card about-card" onClick={(e) => e.stopPropagation()}>
            <div className="rlg-modal-head">
              <span className="label">Clear all saved videos</span>
              <button
                type="button"
                className="rlg-modal-close"
                onClick={() => setClearOpen(false)}
                aria-label="Close"
                disabled={clearBusy}
              >
                ✕
              </button>
            </div>
            <div className="rlg-modal-body">
              <p className="archive-note">
                This permanently deletes <b>every video saved on this machine</b>{" "}
                — all {clips.length} library {clips.length === 1 ? "entry" : "entries"}
                {vaultBytes != null ? ` (~${fmtBytes(vaultBytes)} on disk)` : ""}:
                generated takes and grabbed references alike.
              </p>
              <p className="archive-note">
                Once deleted, past takes <b>cannot be played again</b> and{" "}
                <b>cannot be used as references</b>{" "}for new takes — providers
                purge their own copies within days, so there is nothing left to
                re-download. The dashboard&apos;s spend history resets too.
                Download anything you want to keep first.
              </p>
              {clearErr && <div className="error-box">{clearErr}</div>}
              <div className="rlg-cta-row">
                <button
                  className="btn-ghost"
                  onClick={() => setClearOpen(false)}
                  disabled={clearBusy}
                >
                  Cancel
                </button>
                <button
                  className="btn-ghost btn-danger"
                  onClick={clearAll}
                  disabled={clearBusy}
                >
                  {clearBusy ? "DELETING…" : "Delete all videos"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
