"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROVIDERS,
  DEFAULT_MODEL_KEY,
  DEFAULTS,
  ASPECT_RATIOS,
  DURATION_CHOICES,
  RESOLUTIONS,
  estimateCostUsd,
  estimateModelCost,
  resolveModel,
  effectiveSeconds,
  type ProviderName,
  type AspectRatio,
  type Resolution,
} from "@/lib/config";
import { CHARACTERS, SETTINGS, FASHION, composeStarter } from "@/lib/prompts";
import * as store from "@/lib/store";
import { VERSION, RELEASES_URL } from "@/lib/version";
import { useHosted, useUpdateCheck } from "@/lib/use-version";
import { UpdateGuide } from "./update-guide";
import { HelpGuide } from "./help-guide";
import { useRouter } from "next/navigation";
import { Rail } from "../rail";
import { ModelPicker } from "../model-picker";
import { ClipCardView } from "../clip-card";
import {
  type Clip,
  fmtCost,
  cssAspect,
  GALLERY_KEY,
  SESSIONS_KEY,
  SESSION_ID_KEY,
  PW_KEY,
  PENDING_REF_KEY,
} from "@/lib/clip";

/* ── types & storage ─────────────────────────────── */

type TurnStatus = "refining" | "pending" | "done" | "error";

/** One conversational step: the user's ask, the resolved prompt, and the
 *  clip it produced. The thread of turns IS the session. */
interface Turn {
  id: string;
  userText: string;
  presetLabel?: string;
  prompt?: string;
  provider: ProviderName;
  /** The specific model's short label (a provider can host several). */
  modelLabel?: string;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  resolution: Resolution;
  createdAt: number;
  status: TurnStatus;
  jobId?: string;
  videoUrl?: string;
  costUsd?: number;
  error?: string;
  /** Tiny preview of an attached reference image (full image is sent to
   *  the API but never persisted — localStorage quota is ~5MB). */
  imageThumb?: string;
  /** Mid-video frame captured after completion, used to carry visual
   *  continuity into the next take. Pruned to the last few turns. */
  snapshot?: string;
  /** This take was generated from the previous take's snapshot. */
  usedContinuity?: boolean;
  /** Labels of takes the user pinned as context for this one, e.g. "T2 T4". */
  ctxLabel?: string;
}

/** Append-only archive entry — survives rewinds. */
/** User-created starter block. `image` doubles as the card visual AND the
 *  generation reference for the first take. */
interface CustomAsset {
  id: string;
  label: string;
  desc?: string;
  prompt: string;
  pronoun?: "She" | "He";
  image?: string; // small dataURL
}

/** A saved conversation — sessions auto-save and are switchable. */
interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  turns: Turn[];
}

const THREAD_KEY = "hooklab.thread";
const ASSETS_KEY = "hooklab.customAssets";
// GALLERY_KEY / SESSIONS_KEY / SESSION_ID_KEY / PW_KEY are shared with the
// archive & grab routes — imported from lib/clip.
const POLL_MS = 3000;
const GIVE_UP_MS = 12 * 60 * 1000;
const MAX_SESSIONS = 20;

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(store.get(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
};

/** Storage-side compaction: keep full snapshots only on the newest few
 *  turns so localStorage never fills up with frame data. */
const SNAPSHOT_KEEP = 3;
const compactTurns = (ts: Turn[]): Turn[] => {
  const keep = new Set(
    ts.filter((t) => t.snapshot).map((t) => t.id).slice(-SNAPSHOT_KEEP),
  );
  return ts.map((t) =>
    t.snapshot && !keep.has(t.id) ? { ...t, snapshot: undefined } : t,
  );
};

const fmtElapsed = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// fmtCost / cssAspect / ClipCardView live in lib/clip + app/clip-card (shared
// with the archive route).

/* ── page ────────────────────────────────────────── */

export default function Home() {
  // password gate
  const [gateOpen, setGateOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");

  // generation params (apply to the NEXT take)
  const [modelKey, setModelKey] = useState<string>(DEFAULT_MODEL_KEY);
  const [aspect, setAspect] = useState<AspectRatio>(DEFAULTS.aspectRatio);
  const [duration, setDuration] = useState(DEFAULTS.durationSeconds);
  const [resolution, setResolution] = useState<Resolution>(DEFAULTS.resolution);

  // chat session
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  // Persistence is hydrated from the filesystem store (lib/store) before any
  // save effect runs — otherwise an empty initial state would clobber the file.
  const [hydrated, setHydrated] = useState(false);

  // Version awareness: a local copy checks the canonical deploy for a newer
  // version (the hosted deploy never self-checks). See lib/use-version.
  const hosted = useHosted();
  const { latest, hasUpdate } = useUpdateCheck(hosted);
  const updatable = !hosted && hasUpdate;
  const [showUpdate, setShowUpdate] = useState(false);
  const [updDismissed, setUpdDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [draft, setDraft] = useState("");
  // visual starter blocks (empty-thread only)
  const [charId, setCharId] = useState<string | null>(null);
  const [settingId, setSettingId] = useState<string | null>(null);
  /** Act-Two wardrobe: composited onto the character before it animates. */
  const [fashionId, setFashionId] = useState<string | null>(null);
  /** The composed starter prompt, SHOWN and editable — no hidden prompt.
   *  Whatever is in here is exactly what take 1 builds on. */
  const [starterDraft, setStarterDraft] = useState<string | null>(null);
  /** Which asset carousel is open under the input (Grok-pill style). */
  const [pickerOpen, setPickerOpen] = useState<
    "char" | "setting" | "library" | "fashion" | null
  >(null);
  // user-created assets, persisted; images stored as small dataURL thumbs
  const [custom, setCustom] = useState<{
    characters: CustomAsset[];
    settings: CustomAsset[];
    fashion: CustomAsset[]; // outfit images (label + image; no prompt needed)
  }>({ characters: [], settings: [], fashion: [] });
  const fashionFileRef = useRef<HTMLInputElement>(null);
  // inline "add custom asset" form
  const [assetForm, setAssetForm] = useState<"char" | "setting" | null>(null);
  const [afLabel, setAfLabel] = useState("");
  const [afPrompt, setAfPrompt] = useState("");
  const [afPronoun, setAfPronoun] = useState<"She" | "He">("She");
  const [afImage, setAfImage] = useState<string | null>(null);
  const assetFileRef = useRef<HTMLInputElement>(null);
  // Attached reference: an image is one frame; a video is compacted into
  // a few extracted frames (all go to the refiner, the middle one to the
  // video model, which accepts a single image).
  const [attach, setAttach] = useState<{
    frames: string[]; // base64 JPEGs, no data: prefix
    mimeType: string;
    thumb: string;
    kind: "image" | "video";
    srcSeconds?: number;
    /** Original video bytes (base64, no prefix) — kept for Runway Act-Two,
     *  which needs the actual driving clip, not just extracted frames.
     *  Omitted when the file is over Runway's ~16MB inline limit. */
    videoBase64?: string;
    videoMime?: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // pasted video URL waiting to be fetched into the reference pipeline
  const [urlCandidate, setUrlCandidate] = useState<string | null>(null);
  const [urlFetching, setUrlFetching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Carry each take's snapshot into the next take automatically. */
  const [continuity, setContinuity] = useState(true);
  const snapCapturing = useRef(new Set<string>());
  /** Pre-spend confirm: a paid action waits here until the user OKs it.
   *  "Don't ask again" is SESSION-scoped on purpose — a reload/new session
   *  re-arms it, since it's real money. */
  const [pendingRun, setPendingRun] = useState<{ run: () => void } | null>(null);
  const [noAskGen, setNoAskGen] = useState(false);
  const [noAskChecked, setNoAskChecked] = useState(false);

  // session sidebar — closed by default, Claude-style
  const [sideOpen, setSideOpen] = useState(true);
  const [spendOpen, setSpendOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollFails = useRef(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // client-side nav to sibling pages (archive) — keeps the lib/store in-memory
  // cache alive so freshly-written clips are visible without a disk round-trip
  const router = useRouter();
  /** Synchronous re-entry lock: React state (busyTurn) commits async, so a
   *  double-fired send (IME Enter, double click) would both pass the
   *  busyTurn guard before the first take registers. This blocks it. */
  const sendLockRef = useRef(false);

  // archive + keys
  const [clips, setClips] = useState<Clip[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keysWritable, setKeysWritable] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");
  const [keyPanelHidden, setKeyPanelHidden] = useState(false);
  /** Turn ids pinned as context for the NEXT take. */
  const [ctxIds, setCtxIds] = useState<string[]>([]);

  // GRAB (fetch a reference video by URL) now lives on the /archive page.

  const model = resolveModel(modelKey);
  const providerId = model.provider;
  const providerInfo = PROVIDERS[providerId];
  const estCostUsd = estimateModelCost(model, resolution, duration);
  const keyMissing = keysLoaded && !keys[model.envVar];

  const pwHeaders = useCallback(
    (base: Record<string, string> = {}): Record<string, string> =>
      pw ? { ...base, "x-app-password": pw } : base,
    [pw],
  );

  /** Same-origin proxy URLs need the password as a query param (a <video>
   *  tag can't send headers). Provider-hosted absolute URLs pass through. */
  const withPw = useCallback(
    (url: string) =>
      url.startsWith("/") && pw ? `${url}&pw=${encodeURIComponent(pw)}` : url,
    [pw],
  );

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const refreshKeys = useCallback(
    (password?: string) =>
      fetch("/api/keys", {
        headers: password ?? pw ? { "x-app-password": password ?? pw } : {},
      })
        .then((r) => r.json())
        .then((b) => {
          if (b.keys) {
            setKeys(b.keys);
            setKeysWritable(Boolean(b.writable));
            setKeysLoaded(true);
          }
        })
        .catch(() => {}),
    [pw],
  );

  /* boot: restore state, check password gate, resume interrupted work */
  useEffect(() => {
    let cancelled = false;
    // Hydrate the filesystem store first (it merges any prior localStorage in
    // once), THEN restore state — so no save effect runs against empty initial
    // state and clobbers the file.
    store.hydrate().then(() => {
      if (cancelled) return;
      // Backfill costs for clips saved before a provider's pricing landed.
      setClips(
        loadJson<Clip[]>(GALLERY_KEY, []).map((c) =>
          c.costUsd == null && c.provider && c.provider !== "grab" && c.durationSeconds
            ? {
                ...c,
                costUsd:
                  estimateCostUsd(
                    c.provider,
                    c.resolution ?? "720p",
                    c.durationSeconds,
                  ) ?? undefined,
              }
            : c,
        ),
      );
      setSessions(loadJson<StoredSession[]>(SESSIONS_KEY, []));
      {
        const c = loadJson(ASSETS_KEY, {} as {
          characters?: CustomAsset[];
          settings?: CustomAsset[];
          fashion?: CustomAsset[];
        });
        setCustom({
          characters: c.characters ?? [],
          settings: c.settings ?? [],
          fashion: c.fashion ?? [],
        });
      }
      const sid = store.get(SESSION_ID_KEY) ?? `s${Date.now()}`;
      store.set(SESSION_ID_KEY, sid);
      setSessionId(sid);
      // A reload mid-refine/submit can't be resumed (no jobId yet) — mark it.
      setTurns(
        loadJson<Turn[]>(THREAD_KEY, []).map((t) =>
          (t.status === "refining" || t.status === "pending") && !t.jobId
            ? { ...t, status: "error" as const, error: "Interrupted by reload — send again" }
            : t,
        ),
      );
      // Persistence is loaded — save effects may now run.
      setHydrated(true);

      const savedPw = store.get(PW_KEY) ?? "";
      fetch("/api/auth", {
        headers: savedPw ? { "x-app-password": savedPw } : {},
      })
        .then((r) => r.json())
        .then(({ required, ok }) => {
          if (required && !ok) {
            store.remove(PW_KEY);
            setGateOpen(true);
          } else {
            if (required) setPw(savedPw);
            setReady(true);
            refreshKeys(savedPw);
          }
        })
        .catch(() => setError("Could not reach the API — refresh to retry."));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* persist custom assets */
  useEffect(() => {
    if (!hydrated) return;
    if (
      custom.characters.length ||
      custom.settings.length ||
      custom.fashion.length ||
      store.get(ASSETS_KEY)
    ) {
      store.set(ASSETS_KEY, JSON.stringify(custom));
    }
  }, [custom, hydrated]);

  /* persist (snapshots compacted to the newest few turns) */
  useEffect(() => {
    if (!hydrated) return;
    if (turns.length || store.get(THREAD_KEY)) {
      store.set(THREAD_KEY, JSON.stringify(compactTurns(turns)));
    }
  }, [turns, hydrated]);

  /* auto-save the current thread into the session history */
  useEffect(() => {
    if (!hydrated || !sessionId) return;
    setSessions((prev) => {
      let next = prev.filter((s) => s.id !== sessionId);
      if (turns.length) {
        next = [
          {
            id: sessionId,
            title: turns[0].userText.slice(0, 60),
            updatedAt: Date.now(),
            turns: compactTurns(turns),
          },
          ...next,
        ].slice(0, MAX_SESSIONS);
      }
      store.set(SESSIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, [turns, sessionId, hydrated]);

  /* snapshot capture: once a take is done, grab a mid-video frame so the
     next take can start from it (visual continuity). Cross-origin videos
     without CORS headers simply skip this — the feature degrades quietly. */
  useEffect(() => {
    const t = turns.find(
      (x) =>
        x.status === "done" &&
        x.videoUrl &&
        !x.snapshot &&
        !snapCapturing.current.has(x.id),
    );
    if (!t) return;
    snapCapturing.current.add(t.id);
    // Only same-origin (proxied) videos can be drawn to a canvas without
    // tainting it — skip provider-hosted URLs entirely (no console noise).
    if (!t.videoUrl!.startsWith("/")) return;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = withPw(t.videoUrl!);
    v.addEventListener("loadedmetadata", () => {
      v.currentTime = Math.max(0, Math.min(v.duration * 0.5, v.duration - 0.1));
    });
    v.addEventListener("seeked", () => {
      try {
        const r = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(v.videoWidth * r));
        canvas.height = Math.max(1, Math.round(v.videoHeight * r));
        canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
        patchTurn(t.id, { snapshot: canvas.toDataURL("image/jpeg", 0.72) });
      } catch {
        /* tainted canvas (no CORS) — no continuity for this take */
      }
      v.removeAttribute("src");
      v.load();
    });
  }, [turns, withPw, patchTurn]);
  useEffect(() => {
    if (!hydrated) return;
    if (clips.length || store.get(GALLERY_KEY)) {
      store.set(GALLERY_KEY, JSON.stringify(clips));
    }
  }, [clips, hydrated]);

  /* the one in-flight turn (single-flight session) */
  const busyTurn = turns.find(
    (t) => t.status === "refining" || t.status === "pending",
  );
  const pollTurn = busyTurn?.status === "pending" && busyTurn.jobId ? busyTurn : undefined;

  /* elapsed ticker — from the send click through render completion */
  useEffect(() => {
    if (!busyTurn) return;
    const startedAt = busyTurn.createdAt;
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [busyTurn?.id, busyTurn?.status === "pending"]); // eslint-disable-line react-hooks/exhaustive-deps

  /* poll provider status while a video job is live */
  useEffect(() => {
    if (!pollTurn || !ready) return;
    const { id, jobId, provider, createdAt } = pollTurn;
    pollFails.current = 0;

    const finish = (patch: Partial<Turn>, message?: string) => {
      patchTurn(id, patch);
      if (message) setError(message);
    };

    const poll = async () => {
      if (Date.now() - createdAt > GIVE_UP_MS) {
        finish({ status: "error", error: "Timed out after 12 minutes" });
        return;
      }
      try {
        const res = await fetch(
          `/api/status?id=${encodeURIComponent(jobId!)}&provider=${provider}`,
          { headers: pwHeaders() },
        );
        if (res.status === 401) {
          finish({ status: "error", error: "Password rejected" });
          setGateOpen(true);
          return;
        }
        const body = await res.json();
        pollFails.current = 0;
        if (body.state === "done") {
          finish({ status: "done", videoUrl: body.videoUrl });
        } else if (body.state === "error") {
          finish({ status: "error", error: body.error }, body.error);
        }
      } catch {
        if (++pollFails.current >= 5) {
          finish(
            { status: "error", error: "Lost connection" },
            "Lost connection while polling — check your network.",
          );
        }
      }
    };

    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => clearInterval(iv);
  }, [pollTurn?.jobId, ready, pwHeaders, patchTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* archive every finished take (survives rewinds) */
  useEffect(() => {
    for (const t of turns) {
      if (t.status !== "done" || !t.jobId || !t.videoUrl) continue;
      const jobId = t.jobId;
      setClips((cs) =>
        cs.some((c) => c.jobId === jobId)
          ? cs
          : [
              {
                jobId,
                sessionId,
                provider: t.provider,
                prompt: t.prompt ?? "",
                note: t.userText,
                variantLabel: t.presetLabel ?? "Chat",
                createdAt: t.createdAt,
                status: "done",
                aspectRatio: t.aspectRatio,
                durationSeconds: t.durationSeconds,
                resolution: t.resolution,
                videoUrl: t.videoUrl,
                costUsd: t.costUsd,
              },
              ...cs,
            ],
      );
    }
  }, [turns]);

  /* keep the thread scrolled to the latest turn as takes land */
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, busyTurn?.status]);

  /* on session enter / switch, snap the thread straight to the newest take
     (no smooth scroll) so you always start at the bottom of the history */
  useEffect(() => {
    if (!hydrated) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId, hydrated]);

  /* hide starter-card images that 404'd BEFORE hydration (React's onError
     misses those) — onError on the element covers late failures */
  useEffect(() => {
    if (turns.length) return;
    const t = setTimeout(() => {
      document
        .querySelectorAll<HTMLImageElement>(".starter-img img")
        .forEach((img) => {
          if (img.complete && img.naturalWidth === 0) {
            (img.parentElement as HTMLElement).style.display = "none";
          }
        });
    }, 400);
    return () => clearTimeout(t);
  }, [turns.length, custom]);

  /* recompose the visible base prompt whenever blocks change */
  useEffect(() => {
    if (turns.length) return;
    const s = composeStarter(selChar, selSetting, aspect, duration);
    setStarterDraft(s ? s.prompt : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, settingId, custom, turns.length, aspect, duration]);

  /* Escape closes the spend popover — but NOT the sessions sidebar, which
     stays open until the user toggles it shut with the ≡ rail button. */
  useEffect(() => {
    if (!spendOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSpendOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [spendOpen]);

  /* actions */

  /** Draw any drawable source to a JPEG data URL, capped to `max` px. */
  const toJpeg = (
    src: HTMLVideoElement | ImageBitmap,
    w: number,
    h: number,
    max: number,
    q = 0.85,
  ) => {
    const r = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * r));
    canvas.height = Math.max(1, Math.round(h * r));
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", q);
  };

  /** Image → one frame. Video → 3 frames (start/mid/end), compacted the
   *  same way take-snapshots are. Everything re-encoded as small JPEGs. */
  const attachMediaFile = async (file: File) => {
    try {
      if (file.type.startsWith("image/")) {
        const bmp = await createImageBitmap(file);
        setAttach({
          frames: [toJpeg(bmp, bmp.width, bmp.height, 1280).split(",")[1]],
          mimeType: "image/jpeg",
          thumb: toJpeg(bmp, bmp.width, bmp.height, 120, 0.7),
          kind: "image",
        });
        return;
      }
      if (!file.type.startsWith("video/")) return;

      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.src = url;
        await new Promise<void>((res, rej) => {
          v.onloadedmetadata = () => res();
          v.onerror = () => rej(new Error("bad video"));
        });
        // MediaRecorder-produced webm can report Infinity — seek far to
        // force the real duration.
        if (!isFinite(v.duration)) {
          await new Promise<void>((res) => {
            v.onseeked = () => res();
            v.currentTime = 1e9;
          });
        }
        const dur = isFinite(v.duration) ? v.duration : v.currentTime || 1;
        const grab = (t: number) =>
          new Promise<string>((res, rej) => {
            v.onseeked = () => {
              try {
                res(toJpeg(v, v.videoWidth, v.videoHeight, 640, 0.75));
              } catch (e) {
                rej(e);
              }
            };
            v.currentTime = Math.max(0, Math.min(t, dur - 0.05));
          });
        // Dense, evenly spaced sampling — enough for the refiner to
        // transcribe the PERFORMANCE beat by beat, not just the look.
        const count = Math.min(10, Math.max(3, Math.round(dur)));
        const frames: string[] = [];
        for (let i = 0; i < count; i++) {
          frames.push((await grab((dur * (i + 0.5)) / count)).split(",")[1]);
        }
        // Keep the original bytes for Runway Act-Two (needs the real clip).
        // Skip if it's over the inline cap — the adapter will ask to trim.
        let videoBase64: string | undefined;
        let videoMime: string | undefined;
        if (file.size <= 22_000_000) {
          videoBase64 = await new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = () => res((fr.result as string).split(",")[1] ?? "");
            fr.readAsDataURL(file);
          });
          videoMime = ["video/mp4", "video/webm", "video/quicktime"].includes(
            file.type,
          )
            ? file.type
            : "video/mp4";
        }
        setAttach({
          frames,
          mimeType: "image/jpeg",
          thumb: toJpeg(v, v.videoWidth, v.videoHeight, 120, 0.7),
          kind: "video",
          srcSeconds: dur,
          videoBase64,
          videoMime,
        });
        // Duration stays at the user's choice (default 4s); Act-Two uses the
        // clip's own length regardless. No surprise cost jump on attach.
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setError("Could not read that file as an image or video.");
    }
  };

  /* custom starter assets */

  const attachAssetImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const bmp = await createImageBitmap(file);
      setAfImage(toJpeg(bmp, bmp.width, bmp.height, 256, 0.75));
    } catch {
      setError("Could not read that image.");
    }
  };

  const saveAsset = () => {
    const label = afLabel.trim();
    const prompt = afPrompt.trim();
    if (!label || !prompt || !assetForm) return;
    const asset: CustomAsset = {
      id: `c${Date.now()}`,
      label,
      desc: "CUSTOM",
      prompt,
      image: afImage ?? undefined,
      ...(assetForm === "char" ? { pronoun: afPronoun } : {}),
    };
    setCustom((cu) =>
      assetForm === "char"
        ? { ...cu, characters: [...cu.characters, asset] }
        : { ...cu, settings: [...cu.settings, asset] },
    );
    if (assetForm === "char") setCharId(asset.id);
    else setSettingId(asset.id);
    setAssetForm(null);
    setAfLabel("");
    setAfPrompt("");
    setAfImage(null);
    setAfPronoun("She");
  };

  const removeAsset = (kind: "char" | "setting", id: string) => {
    setCustom((cu) =>
      kind === "char"
        ? { ...cu, characters: cu.characters.filter((c) => c.id !== id) }
        : { ...cu, settings: cu.settings.filter((s) => s.id !== id) },
    );
    if (kind === "char" && charId === id) setCharId(null);
    if (kind === "setting" && settingId === id) setSettingId(null);
  };

  /** Pull a direct video URL through the server proxy and feed it into
   *  the normal attach pipeline (frames, transfer mode, the lot). */
  const attachFromUrl = async () => {
    if (!urlCandidate || urlFetching) return;
    setUrlFetching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/fetch-video?url=${encodeURIComponent(urlCandidate)}${
          pw ? `&pw=${encodeURIComponent(pw)}` : ""
        }`,
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "Could not fetch that URL.");
        return;
      }
      const blob = await res.blob();
      await attachMediaFile(
        new File([blob], "reference.mp4", { type: blob.type || "video/mp4" }),
      );
      setDraft((d) => (d.trim() === urlCandidate ? "" : d));
      setUrlCandidate(null);
    } catch {
      setError("Could not fetch that URL.");
    } finally {
      setUrlFetching(false);
    }
  };


  /** Feed an archived GRAB clip into the normal attach pipeline (frames,
   *  transfer mode, the lot) and return to the composer. */
  const useClipAsRef = async (clip: Clip) => {
    if (!clip.videoUrl) return;
    setError(null);
    try {
      const r = await fetch(clip.videoUrl, { headers: pwHeaders({}) });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      await attachMediaFile(
        new File([blob], `${clip.jobId}.mp4`, { type: "video/mp4" }),
      );
    } catch {
      setError(
        "Could not load that reference — the grabbed file may have been cleaned up. Grab it again.",
      );
    }
  };

  /** Cover-crop a reference image to the target aspect. Mismatched
   *  aspects make i2v models tile/outpaint (duplicated frames) and drop
   *  likeness — the reference must fill the output canvas exactly. */
  const normalizeRefB64 = async (
    b64: string,
    a: AspectRatio,
  ): Promise<string> => {
    try {
      const blob = await (
        await fetch(`data:image/jpeg;base64,${b64}`)
      ).blob();
      const bmp = await createImageBitmap(blob);
      const W = a === "16:9" ? 1280 : 720;
      const H = a === "16:9" ? 720 : 1280;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const scale = Math.max(W / bmp.width, H / bmp.height);
      const dw = bmp.width * scale;
      const dh = bmp.height * scale;
      canvas
        .getContext("2d")!
        .drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    } catch {
      return b64;
    }
  };

  /** Resolve a starter card's image to base64 for the generation
   *  reference — built-ins load from /starters/<id>.jpg, customs from
   *  their stored dataURL. The card face IS the reference. */
  const assetRefB64 = async (
    item?: (CustomAsset & { custom?: true }) | null,
  ): Promise<string | null> => {
    if (!item) return null;
    if ("custom" in item && item.custom) {
      return item.image ? item.image.split(",")[1] : null;
    }
    try {
      const res = await fetch(`/starters/${item.id}.jpg`);
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      return toJpeg(bmp, bmp.width, bmp.height, 768, 0.8).split(",")[1];
    } catch {
      return null;
    }
  };

  /** Fetch a public image path and return downscaled JPEG base64 (no prefix). */
  const attachFromPath = async (path: string): Promise<string | null> => {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      return toJpeg(bmp, bmp.width, bmp.height, 768, 0.8).split(",")[1];
    } catch {
      return null;
    }
  };

  /** Upload a custom outfit image → stored (dataURL) and selected. */
  const addCustomFashion = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const bmp = await createImageBitmap(file);
      const image = toJpeg(bmp, bmp.width, bmp.height, 768, 0.8);
      const id = `cf${Date.now()}`;
      const n = custom.fashion.length + 1;
      setCustom((cu) => ({
        ...cu,
        fashion: [...cu.fashion, { id, label: `Custom ${n}`, prompt: "", image }],
      }));
      setFashionId(id);
    } catch {
      setError("Could not read that outfit image.");
    }
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    try {
      const res = await fetch("/api/auth", {
        headers: { "x-app-password": pwInput },
      });
      const { ok } = await res.json();
      if (ok) {
        store.set(PW_KEY, pwInput);
        setPw(pwInput);
        setGateOpen(false);
        setReady(true);
        refreshKeys(pwInput);
      } else {
        setPwError("Wrong password.");
      }
    } catch {
      setPwError("Could not reach the API.");
    }
  };

  /* merged pickable lists (built-ins + custom) and current selection */
  const allCharacters: Array<
    (typeof CHARACTERS)[number] | (CustomAsset & { custom: true })
  > = [
    ...CHARACTERS,
    ...custom.characters.map((c) => ({ ...c, custom: true as const })),
  ];
  const allSettings: Array<
    (typeof SETTINGS)[number] | (CustomAsset & { custom: true })
  > = [
    ...SETTINGS,
    ...custom.settings.map((s) => ({ ...s, custom: true as const })),
  ];
  const selChar = charId
    ? (allCharacters.find((c) => c.id === charId) as
        | (CustomAsset & { custom?: true })
        | undefined)
    : undefined;
  const selSetting = settingId
    ? (allSettings.find((s) => s.id === settingId) as
        | (CustomAsset & { custom?: true })
        | undefined)
    : undefined;
  const selFashion = fashionId
    ? FASHION.find((f) => f.id === fashionId) ??
      custom.fashion.find((f) => f.id === fashionId)
    : undefined;

  /** Gate any money-spending action behind the pre-spend confirm (unless the
   *  user opted out with "don't ask again"). */
  const guardRun = (run: () => void) => {
    if (noAskGen) run();
    else {
      setNoAskChecked(false);
      setPendingRun({ run });
    }
  };
  const confirmRun = () => {
    const p = pendingRun;
    setPendingRun(null);
    if (noAskChecked) setNoAskGen(true); // session-only
    p?.run();
  };

  /** Composite the selected outfit onto a character image via /api/dress, so
   *  the picked fashion shows up regardless of model (every video provider
   *  takes an image reference; Act-Two takes only the dressed frame). The
   *  outfit is best-effort — on any failure we fall back to the original card
   *  and surface a soft note rather than blocking the take. */
  const dressWithFashion = async (charB64: string): Promise<string> => {
    if (!selFashion) return charB64;
    try {
      const outfitB64 =
        "image" in selFashion && selFashion.image
          ? selFashion.image.split(",")[1] // custom upload (dataURL)
          : await attachFromPath(`/fashion/${selFashion.id}.jpg`);
      if (!outfitB64) return charB64;
      const dr = await fetch("/api/dress", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          character: { base64: charB64, mimeType: "image/jpeg" },
          outfit: { base64: outfitB64, mimeType: "image/jpeg" },
        }),
      });
      const db = await dr.json();
      if (dr.ok && db.base64) return db.base64;
      setError(`Outfit step skipped: ${db.error ?? "failed"} — using the original card.`);
      return charB64;
    } catch {
      setError("Outfit step skipped (couldn't reach the dress API) — using the original card.");
      return charB64;
    }
  };

  const send = async () => {
    if (sendLockRef.current) return; // a submit is already in flight
    const text = draft.trim();
    const manual = attach;
    // The VISIBLE (possibly user-edited) base text is what actually runs.
    const starterText =
      turns.length === 0 && starterDraft?.trim() ? starterDraft.trim() : null;
    const starterLabel = starterText
      ? composeStarter(selChar, selSetting, aspect, duration)?.label ?? "Custom base"
      : undefined;
    const ctxTurns = ctxIds
      .map((id) => ({ idx: turns.findIndex((t) => t.id === id) }))
      .filter(({ idx }) => idx >= 0 && turns[idx].prompt)
      .sort((a, b) => a.idx - b.idx)
      .map(({ idx }) => ({ take: idx + 1, turn: turns[idx] }));
    if (
      busyTurn ||
      (!text && !starterText && !manual && !ctxTurns.length) ||
      keyMissing
    )
      return;
    setError(null);
    sendLockRef.current = true;
    try {

    // ── Runway Act-Two: real performance transfer, no prompt / no refine.
    // Sends the driving video + the chosen face card straight to Runway;
    // the output moves like the clip and wears the card's identity. ──
    if (providerId === "runway") {
      let charB64 = selChar ? await assetRefB64(selChar) : null;
      if (!manual || manual.kind !== "video" || !manual.videoBase64) {
        setError(
          "Act-Two needs a driving video attached — add one in the Library (▦ → ＋ Add reference), or drop an .mp4 here, then pick a face card.",
        );
        return;
      }
      if (!charB64) {
        setError("Act-Two needs a face — pick a Character card first.");
        return;
      }
      // Wardrobe: composite the picked outfit onto the character FIRST, then
      // let Act-Two animate the dressed image (Act-Two has no outfit input).
      if (selFashion && charB64) {
        setError(null);
        charB64 = await dressWithFashion(charB64);
      }
      const vidSecs = Math.round(
        Math.min(15, Math.max(1, manual.srcSeconds ?? 8)),
      );
      const cardThumb =
        "custom" in selChar! && selChar!.custom
          ? selChar!.image
          : `/starters/${selChar!.id}.jpg`;
      const id = `t${Date.now()}`;
      const outfitNote = selFashion ? ` in ${selFashion.label}` : "";
      const turn: Turn = {
        id,
        userText:
          text ||
          `Act-Two — ${selChar!.label}${outfitNote} performs the attached clip`,
        presetLabel: selChar!.label,
        provider: "runway",
        modelLabel: model.short,
        aspectRatio: aspect,
        durationSeconds: vidSecs,
        resolution,
        createdAt: Date.now(),
        status: "refining",
        costUsd: estimateModelCost(model, resolution, vidSecs) ?? undefined,
        imageThumb: cardThumb,
        prompt: `Act-Two performance transfer · face: ${selChar!.label}${outfitNote} · driving clip ${vidSecs}s`,
      };
      setTurns((ts) => [...ts, turn]);
      setDraft("");
      setAttach(null);
      setSelectedId(id);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: pwHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            provider: "runway",
            modelId: model.modelId,
            aspectRatio: aspect,
            durationSeconds: vidSecs,
            resolution,
            character: { base64: charB64, mimeType: "image/jpeg" },
            drivingVideo: {
              base64: manual.videoBase64,
              mimeType: manual.videoMime ?? "video/mp4",
            },
          }),
        });
        const body = await res.json();
        if (res.status === 401) {
          patchTurn(id, { status: "error", error: "Password rejected" });
          setGateOpen(true);
          return;
        }
        if (!res.ok) {
          patchTurn(id, { status: "error", error: body.error ?? "Submit failed" });
          return;
        }
        patchTurn(id, { status: "pending", jobId: body.jobId });
      } catch {
        patchTurn(id, { status: "error", error: "Network error — try again" });
      }
      return;
    }

    // Reference precedence: manual attachment > starter-asset images >
    // continuity snapshot. Refine sees every frame; the video model gets
    // one primary frame (middle of a video, character over setting).
    const lastSnap =
      !manual && continuity
        ? [...turns].reverse().find((t) => t.snapshot)?.snapshot
        : undefined;
    // Video attach + character card = PERFORMANCE TRANSFER: the video
    // drives the choreography (via transcription), the card supplies the
    // identity — so asset refs stay live even with a manual video.
    const [charImgRaw, settingImg] =
      (!manual || manual.kind === "video") && starterText
        ? await Promise.all([assetRefB64(selChar), assetRefB64(selSetting)])
        : [null, null];
    // Dress the CHARACTER reference in the picked outfit (not just Act-Two):
    // every video provider takes an image reference, so the dressed frame
    // makes any model render the character wearing the selected fashion.
    const charImg =
      charImgRaw && selFashion ? await dressWithFashion(charImgRaw) : charImgRaw;
    const assetImages = [charImg, settingImg].filter(Boolean) as string[];
    const transfer =
      manual?.kind === "video" && assetImages.length > 0 && !!starterText;
    const assetThumb = starterText
      ? selChar
        ? "custom" in selChar && selChar.custom
          ? selChar.image
          : `/starters/${selChar.id}.jpg`
        : selSetting
          ? "custom" in selSetting && selSetting.custom
            ? selSetting.image
            : `/starters/${selSetting.id}.jpg`
          : undefined
      : undefined;
    const ctxImages = manual
      ? []
      : (ctxTurns
          .map(({ turn }) => turn.snapshot)
          .filter(Boolean) as string[]);
    const refImages = manual
      ? manual.frames.map((b) => ({ base64: b, mimeType: manual.mimeType }))
      : ctxImages.length
        ? ctxImages.map((d) => ({
            base64: d.split(",")[1],
            mimeType: "image/jpeg",
          }))
        : assetImages.length
          ? assetImages.map((d) => ({
              base64: d,
              mimeType: "image/jpeg",
            }))
          : lastSnap
            ? [{ base64: lastSnap.split(",")[1], mimeType: "image/jpeg" }]
            : undefined;
    const rawPrimary = transfer
      ? { base64: assetImages[0], mimeType: "image/jpeg" } // identity = card
      : manual && refImages
        ? refImages[Math.floor((refImages.length - 1) / 2)]
        : refImages?.[0];
    const primaryImage = rawPrimary
      ? {
          base64: await normalizeRefB64(rawPrimary.base64, aspect),
          mimeType: "image/jpeg",
        }
      : undefined;

    const id = `t${Date.now()}`;
    const createdAt = Date.now();
    const base = turns.length
      ? [...turns].reverse().find((t) => t.prompt)?.prompt
      : starterText ?? undefined;
    // Earlier takes give the refiner context for "take 1's background" etc.
    const history = turns
      .map((t, i) => ({ take: i + 1, request: t.userText, prompt: t.prompt ?? "" }))
      .filter((h) => h.prompt)
      .slice(-6);

    const turn: Turn = {
      id,
      userText:
        text ||
        (ctxTurns.length
          ? `Blend ${ctxTurns.map((c) => `take ${c.take}`).join(" + ")}`
          : starterText
            ? `Start: ${starterLabel}${selFashion ? ` · ${selFashion.label}` : ""}`
            : "Use the attached image as the reference."),
      presetLabel: starterLabel,
      provider: providerId,
      modelLabel: model.short,
      aspectRatio: aspect,
      durationSeconds: duration,
      resolution,
      createdAt,
      status: "refining",
      costUsd: estCostUsd ?? undefined,
      imageThumb: manual?.thumb ?? assetThumb,
      usedContinuity: Boolean(
        lastSnap && !manual && !assetImages.length && !ctxImages.length,
      ),
      ctxLabel: ctxTurns.length
        ? ctxTurns.map((c) => `T${c.take}`).join(" ")
        : undefined,
    };
    setTurns((ts) => [...ts, turn]);
    setDraft("");
    setAttach(null);
    setCtxIds([]);
    setSelectedId(id);

    try {
      let prompt: string;
      if (!text && starterText && !manual && !ctxTurns.length) {
        prompt = starterText; // the visible base, exactly as shown/edited
      } else {
        const r = await fetch("/api/refine", {
          method: "POST",
          headers: pwHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            base,
            history,
            mode: transfer ? "transfer" : undefined,
            targetSeconds: transfer
              ? effectiveSeconds(providerId, duration, resolution)
              : undefined,
            contexts: ctxTurns.map((c) => ({
              take: c.take,
              prompt: c.turn.prompt!,
            })),
            message:
              text ||
              (transfer
                ? "Recreate the attached video's performance with the base prompt's subject."
                : ctxTurns.length
                  ? "Blend the pinned context takes into one take."
                  : "Use the attached image as the visual reference for the clip."),
            images: refImages,
          }),
        });
        const b = await r.json();
        if (r.status === 401) {
          patchTurn(id, { status: "error", error: "Password rejected" });
          setGateOpen(true);
          return;
        }
        if (!r.ok) {
          patchTurn(id, { status: "error", error: b.error ?? "Prompt rewrite failed" });
          return;
        }
        prompt = b.prompt;
      }
      patchTurn(id, { prompt });

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          prompt,
          provider: providerId,
          modelId: model.modelId,
          aspectRatio: aspect,
          durationSeconds: duration,
          resolution,
          image: primaryImage,
        }),
      });
      const body = await res.json();
      if (res.status === 401) {
        patchTurn(id, { status: "error", error: "Password rejected" });
        setGateOpen(true);
        return;
      }
      if (!res.ok) {
        patchTurn(id, { status: "error", error: body.error ?? "Submit failed" });
        return;
      }
      patchTurn(id, { status: "pending", jobId: body.jobId });
    } catch {
      patchTurn(id, { status: "error", error: "Network error — try again" });
    }
    } finally {
      sendLockRef.current = false;
    }
  };

  const toggleCtx = (id: string) =>
    setCtxIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  /** Claude-style rewind: cut the thread after this turn and continue the
   *  conversation from there. Finished clips stay in the archive below. */
  const rewindTo = (id: string) => {
    const idx = turns.findIndex((t) => t.id === id);
    if (idx < 0) return;
    if (
      idx < turns.length - 1 &&
      !window.confirm(
        "Rewind here? Later turns leave the thread (finished clips stay in the archive).",
      )
    )
      return;
    setTurns((ts) => ts.slice(0, idx + 1));
    setCtxIds((ids) => ids.filter((x) => turns.slice(0, idx + 1).some((t) => t.id === x)));
    setSelectedId(id);
  };

  /** Drop a failed take from the thread. Failed takes never reach the
   *  archive, so nothing else references them — no confirm needed. */
  const deleteTurn = (id: string) => {
    setTurns((ts) => ts.filter((t) => t.id !== id));
    setCtxIds((ids) => ids.filter((x) => x !== id));
    if (selectedId === id) setSelectedId(null);
  };

  /** Current thread is already auto-saved — just move to a fresh id. */
  const newSession = () => {
    if (busyTurn) return;
    const nid = `s${Date.now()}`;
    store.set(SESSION_ID_KEY, nid);
    setSessionId(nid);
    setTurns([]);
    setSelectedId(null);
    setCtxIds([]);
    setCharId(null);
    setSettingId(null);
    setFashionId(null);
    setNoAskGen(false); // re-arm the pre-spend confirm each new session
    setError(null);
  };

  /* Rail on other pages navigates here with a hint of what to open, and the
     /archive page hands off a clip to attach as a reference. */
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    const open = q.get("open");
    if (open === "sessions") setSideOpen(true);
    if (q.get("new") === "1") newSession();
    if (open || q.get("new")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // a clip the /archive page picked "use as reference" on → attach it here
    const pending = store.get(PENDING_REF_KEY);
    if (pending) {
      store.remove(PENDING_REF_KEY);
      try {
        const clip = JSON.parse(pending) as Clip;
        if (clip?.videoUrl) useClipAsRef(clip);
      } catch {
        /* malformed handoff — ignore */
      }
    }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSession = (id: string) => {
    if (!id || id === sessionId || busyTurn) return;
    const found = sessions.find((s) => s.id === id);
    if (!found) return;
    store.set(SESSION_ID_KEY, id);
    setSessionId(id);
    setTurns(found.turns);
    setSelectedId(null);
    setCtxIds([]);
    setError(null);
  };

  const deleteSession = (id: string) => {
    if (busyTurn && id === sessionId) return;
    if (!window.confirm("Delete this session from history? Archived clips stay."))
      return;
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    store.set(SESSIONS_KEY, JSON.stringify(next));
    if (id === sessionId) {
      const nid = `s${Date.now()}`;
      store.set(SESSION_ID_KEY, nid);
      setSessionId(nid);
      setTurns([]);
      setSelectedId(null);
      setError(null);
    }
  };

  /** Re-run a failed take. Uses its saved prompt (or re-refines from its
   *  message) with the CURRENTLY selected model/params — so you can flip
   *  the model and retry the same take. */
  const retryTurn = async (id: string) => {
    if (busyTurn) return;
    const idx = turns.findIndex((t) => t.id === id);
    const turn = turns[idx];
    if (!turn || turn.status !== "error") return;
    setError(null);
    setSelectedId(id);
    patchTurn(id, {
      status: "refining",
      error: undefined,
      jobId: undefined,
      videoUrl: undefined,
      createdAt: Date.now(),
      provider: providerId,
      modelLabel: model.short,
      aspectRatio: aspect,
      durationSeconds: duration,
      resolution,
      costUsd: estCostUsd ?? undefined,
    });
    try {
      let prompt = turn.prompt;
      if (!prompt) {
        const earlier = turns.slice(0, idx);
        const base = [...earlier].reverse().find((t) => t.prompt)?.prompt;
        const history = earlier
          .map((t, i) => ({ take: i + 1, request: t.userText, prompt: t.prompt ?? "" }))
          .filter((h) => h.prompt)
          .slice(-6);
        const r = await fetch("/api/refine", {
          method: "POST",
          headers: pwHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ base, history, message: turn.userText }),
        });
        const b = await r.json();
        if (!r.ok) {
          patchTurn(id, { status: "error", error: b.error ?? "Prompt rewrite failed" });
          return;
        }
        prompt = b.prompt;
        patchTurn(id, { prompt });
      }
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          prompt,
          provider: providerId,
          modelId: model.modelId,
          aspectRatio: aspect,
          durationSeconds: duration,
          resolution,
        }),
      });
      const body = await res.json();
      if (res.status === 401) {
        patchTurn(id, { status: "error", error: "Password rejected" });
        setGateOpen(true);
        return;
      }
      if (!res.ok) {
        patchTurn(id, { status: "error", error: body.error ?? "Submit failed" });
        return;
      }
      patchTurn(id, { status: "pending", jobId: body.jobId });
    } catch {
      patchTurn(id, { status: "error", error: "Network error — try again" });
    }
  };

  const saveKey = async () => {
    if (!keyInput.trim() || keySaving) return;
    setKeySaving(true);
    setKeyMsg("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ envVar: providerInfo.envVar, value: keyInput.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setKeyMsg(body.error ?? "Could not save the key");
      } else {
        setKeyInput("");
        setKeyMsg(`Saved to .env.local — ${providerInfo.label} is ready.`);
        await refreshKeys();
      }
    } catch {
      setKeyMsg("Network error — could not save the key.");
    } finally {
      setKeySaving(false);
    }
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
    setClips((cs) => cs.filter((c) => c.jobId !== jobId));

  /* derived: what the preview shows */
  const previewTurn =
    turns.find((t) => t.id === selectedId) ??
    busyTurn ??
    [...turns].reverse().find((t) => t.status === "done") ??
    turns[turns.length - 1];
  const previewBusy =
    previewTurn && (previewTurn.status === "refining" || previewTurn.status === "pending");

  const status = previewBusy
    ? { text: previewTurn.status === "refining" ? "PREPARING" : "RENDERING", dot: "live" }
    : previewTurn?.status === "done"
      ? { text: "COMPLETE", dot: "done" }
      : previewTurn?.status === "error"
        ? { text: "FAULT", dot: "fault" }
        : { text: "STANDBY", dot: "" };

  const frameAspect = cssAspect(previewTurn?.aspectRatio ?? aspect);

  /* archive view: this session's takes below the chat (everything, grouped by
     session, lives on the /archive page now) */
  const sessionClips = clips.filter((c) => c.sessionId === sessionId);

  /* spend rollup: archive is the ledger (append-only, survives rewinds) */
  const spend = (() => {
    const bySession = new Map<
      string,
      {
        label: string;
        latest: number;
        total: number;
        unpriced: number;
        parts: Map<ProviderName, number>;
      }
    >();
    for (const c of clips) {
      if (c.provider === "grab") continue; // references are free — not spend
      const key = c.sessionId ?? "earlier";
      let g = bySession.get(key);
      if (!g) {
        g = {
          label:
            key === sessionId
              ? "Current session"
              : sessions.find((s) => s.id === key)?.title ??
                (key === "earlier" ? "Earlier takes" : "Removed session"),
          latest: 0,
          total: 0,
          unpriced: 0,
          parts: new Map(),
        };
        bySession.set(key, g);
      }
      g.latest = Math.max(g.latest, c.createdAt);
      if (c.costUsd == null) {
        g.unpriced += 1; // provider didn't publish pricing when saved
      } else {
        g.total += c.costUsd;
        g.parts.set(c.provider, (g.parts.get(c.provider) ?? 0) + c.costUsd);
      }
    }
    const rows = [...bySession.values()].sort((a, b) => b.latest - a.latest);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const unpriced = rows.reduce((s, r) => s + r.unpriced, 0);
    const max = Math.max(...rows.map((r) => r.total), 0.01);
    const providers = (Object.keys(PROVIDERS) as ProviderName[]).filter((p) =>
      rows.some((r) => r.parts.has(p)),
    );
    // The header shows THIS session only — a fresh session starts at $0.
    const cur = bySession.get(sessionId);
    return {
      rows,
      total,
      unpriced,
      max,
      providers,
      current: cur?.total ?? 0,
      currentUnpriced: cur?.unpriced ?? 0,
    };
  })();
  const starterReady = turns.length === 0 && Boolean(starterDraft?.trim());
  const canSend =
    !busyTurn &&
    ready &&
    !keyMissing &&
    Boolean(draft.trim() || attach || starterReady || ctxIds.length);

  /* ── render ────────────────────────────────────── */

  if (gateOpen) {
    return (
      <div className="gate">
        <form className="gate-inner" onSubmit={unlock}>
          <span className="label">Access · Enter shared password</span>
          <input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            autoFocus
            aria-label="Password"
          />
          <button type="submit" className="btn-primary">
            Enter
          </button>
          {pwError && <div className="gate-error fade">{pwError}</div>}
        </form>
      </div>
    );
  }

  return (
    <>
      {pendingRun && (
        <div className="confirm-backdrop" onClick={() => setPendingRun(null)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <span className="label">Generate — this spends real money</span>
            <div className="confirm-rows">
              <div>
                <span>Model</span>
                <b>{model.short}</b>
              </div>
              <div>
                <span>Format</span>
                <b>
                  {aspect} · {resolution}
                </b>
              </div>
              <div>
                <span>Length</span>
                <b>
                  {providerId === "runway"
                    ? "driving clip length"
                    : `${effectiveSeconds(providerId, duration, resolution)}s`}
                </b>
              </div>
              <div>
                <span>Est. cost</span>
                <b className="confirm-cost">
                  {estCostUsd != null ? `≈ $${estCostUsd.toFixed(2)}` : "unknown"}
                </b>
              </div>
            </div>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={noAskChecked}
                onChange={(e) => setNoAskChecked(e.target.checked)}
              />
              Don&apos;t ask again this session
            </label>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setPendingRun(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={confirmRun}>
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
      {/* left rail — always visible; panel slides out Claude-style */}
      <Rail
        active={sideOpen ? "sessions" : null}
        onHome={() => {
          setSpendOpen(false);
          newSession(); // logo = a fresh start, like a new chat
        }}
        onDashboard={() => router.push("/dashboard")}
        onSessions={() => {
          setSideOpen((o) => !o);
        }}
        onArchive={() => {
          // the library is its own page now (keeps the left rail, no overlay);
          // client nav preserves the store cache so recent takes show up
          router.push("/archive");
        }}
        onGrab={() => {
          // GRAB lives inside the library now — ⤓ opens it with the add form up
          router.push("/archive?add=1");
        }}
        onNew={() => {
          newSession();
        }}
        newDisabled={Boolean(busyTurn)}
        version={VERSION}
        hasUpdate={updatable}
        latest={latest}
        onVersion={() => {
          if (updatable) setShowUpdate(true);
          else window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
        }}
        onHelp={() => setShowHelp(true)}
      />

      {updatable && !updDismissed && (
        <div className="update-banner">
          <button
            type="button"
            className="update-banner-main"
            onClick={() => setShowUpdate(true)}
          >
            <span className="update-banner-dot" aria-hidden />
            Update available — <b>v{latest}</b>{" "}
            <span className="update-banner-cur">(now v{VERSION})</span>
            <b className="update-banner-cta">Update →</b>
          </button>
          <button
            type="button"
            className="update-banner-x"
            onClick={() => setUpdDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <aside className={`side-panel ${sideOpen ? "open" : ""}`}>
        <div className="side-head">
          <span className="label">Sessions</span>
          <button
            className="link-btn"
            onClick={() => {
              newSession();
              setSideOpen(false);
            }}
            disabled={Boolean(busyTurn)}
          >
            + New
          </button>
        </div>
        <div className="side-list">
          {sessions.length === 0 && (
            <p className="hint">Past sessions appear here automatically.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`side-item ${s.id === sessionId ? "active" : ""}`}
              onClick={() => {
                openSession(s.id);
                setSideOpen(false);
              }}
            >
              <div className="side-title">{s.title}</div>
              <div className="side-sub">
                {new Date(s.updatedAt).toLocaleString([], {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {s.turns.length} takes
              </div>
              <button
                className="side-del"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
                title="Delete session"
                aria-label={`Delete session ${s.title}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className={`shell ${sideOpen ? "with-side" : ""}`}>
      <main className="grid-main">
        {/* session thread */}
        <section className="session-col">
          <div className="output-head session-head">
            <span className="label">Session</span>
            <span className="session-spend">
              {turns.length > 0 && (
                <span className="status-line">{turns.length} TAKES</span>
              )}
              {clips.length > 0 && (
                <>
                  <span
                    className="spend-mini"
                    title="Estimated spend — this session only"
                  >
                    ${spend.current.toFixed(2)}
                    {spend.currentUnpriced > 0 ? ` +${spend.currentUnpriced}?` : ""}
                  </span>
                  <button
                    className={`chart-btn ${spendOpen ? "on" : ""}`}
                    onClick={() => setSpendOpen((o) => !o)}
                    title="Spend by session and model"
                    aria-label="Toggle spend chart"
                  >
                    <b />
                    <b />
                    <b />
                  </button>
                </>
              )}
              {spendOpen && (
                <div className="spend-popover fade">
                  <div className="archive-head">
                    <span className="label">Spend · Estimated</span>
                    <button
                      className="link-btn"
                      onClick={() => setSpendOpen(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="archive-note">
                    Duration × published per-second price per finished take —
                    providers don&apos;t report billed totals.
                  </p>
                  <div className="spend-hero">
                    ${spend.total.toFixed(2)}
                    {spend.unpriced > 0 && (
                      <span className="spend-unpriced"> +{spend.unpriced} unpriced</span>
                    )}
                    <span className="spend-unpriced"> all sessions</span>
                  </div>
                  <a className="link-btn" href="/dashboard">
                    Full dashboard →
                  </a>
                  <div className="spend-legend">
                    {spend.providers.map((p) => (
                      <span key={p} className="spend-chip">
                        <i style={{ background: PROVIDERS[p].chartColor }} />
                        {PROVIDERS[p].label}
                      </span>
                    ))}
                  </div>
                  <div className="spend-rows">
                    {spend.rows.map((r) => (
                      <div className="spend-row" key={r.label + r.latest}>
                        <span className="spend-label" title={r.label}>
                          {r.label}
                        </span>
                        <div className="spend-bar">
                          {spend.providers.map((p) => {
                            const v = r.parts.get(p);
                            if (!v) return null;
                            return (
                              <i
                                key={p}
                                style={{
                                  width: `${(v / spend.max) * 100}%`,
                                  background: PROVIDERS[p].chartColor,
                                }}
                                title={`${PROVIDERS[p].label} · $${v.toFixed(2)}`}
                              />
                            );
                          })}
                        </div>
                        <span className="spend-total">
                          ${r.total.toFixed(2)}
                          {r.unpriced > 0 ? ` +${r.unpriced}?` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </span>
          </div>

          <div className="thread" ref={threadRef}>
            {turns.map((t, i) => (
              <div
                key={t.id}
                className={`turn ${previewTurn?.id === t.id ? "selected" : ""}`}
                onClick={() => setSelectedId(t.id)}
              >
                {t.imageThumb && (
                  <img className="turn-img" src={t.imageThumb} alt="reference" />
                )}
                <div className="turn-user">{t.userText}</div>
                {t.prompt && (
                  <details
                    className="turn-prompt"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <summary>Prompt · Take {i + 1}</summary>
                    <p>{t.prompt}</p>
                  </details>
                )}
                <div className="turn-status">
                  <span className={`dot ${
                    t.status === "done" ? "done" : t.status === "error" ? "fault" : "live"
                  }`} />
                  <span className="mono">
                    {t.status === "refining" && "PREPARING…"}
                    {t.status === "pending" && `RENDERING ${busyTurn?.id === t.id ? fmtElapsed(elapsed) : ""}`}
                    {t.status === "done" &&
                      `TAKE ${i + 1} · ${(t.modelLabel ?? PROVIDERS[t.provider].label).toUpperCase()}${fmtCost(t.costUsd) ? ` · ${fmtCost(t.costUsd)}` : ""}`}
                    {t.status === "error" && "FAILED"}
                  </span>
                  {t.usedContinuity && (
                    <span className="cont-tag" title="Started from the previous take's frame">
                      CONT
                    </span>
                  )}
                  {t.ctxLabel && (
                    <span className="cont-tag" title="Built from pinned context takes">
                      CTX {t.ctxLabel}
                    </span>
                  )}
                  <span className="turn-spacer" />
                  {t.status === "error" && (
                    <button
                      className="link-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        guardRun(() => retryTurn(t.id));
                      }}
                      disabled={Boolean(busyTurn)}
                      title="Retry this take with the currently selected model & params"
                    >
                      ↻ Retry
                    </button>
                  )}
                  {t.prompt && t.status !== "refining" && t.status !== "pending" && (
                    <button
                      className={`link-btn ${ctxIds.includes(t.id) ? "ctx-on" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCtx(t.id);
                      }}
                      title="Pin this take as context for the next message"
                    >
                      {ctxIds.includes(t.id) ? "❐ In context" : "+ ❐ Context"}
                    </button>
                  )}
                  {t.status !== "refining" && t.status !== "pending" && (
                    <button
                      className="link-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        rewindTo(t.id);
                      }}
                      title="Continue the conversation from this take"
                    >
                      ↩ Rewind
                    </button>
                  )}
                  {t.status === "error" && (
                    <button
                      className="link-btn danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTurn(t.id);
                      }}
                      title="Remove this failed take from the thread"
                    >
                      ✕ Delete
                    </button>
                  )}
                </div>
                {t.status === "error" && t.error && (
                  <div className="turn-error">{t.error}</div>
                )}
              </div>
            ))}
            <div ref={threadEndRef} />
          </div>

          {error && <div className="error-box fade">{error}</div>}

          {turns.length === 0 && (
            <div className="starter fade">
              <div className="starter-intro">
                <span className="starter-intro-label">Start a clip</span>
                <button
                  type="button"
                  className="starter-help"
                  onClick={() => setShowHelp(true)}
                >
                  ? How to use
                </button>
              </div>
              <div className="starter-pills">
                <button
                  className={`pill-btn ${pickerOpen === "char" ? "on" : ""}`}
                  onClick={() =>
                    setPickerOpen((p) => (p === "char" ? null : "char"))
                  }
                >
                  ✦ Character{selChar ? ` · ${selChar.label}` : ""}
                </button>
                <button
                  className={`pill-btn ${pickerOpen === "setting" ? "on" : ""}`}
                  onClick={() =>
                    setPickerOpen((p) => (p === "setting" ? null : "setting"))
                  }
                >
                  ◫ Background{selSetting ? ` · ${selSetting.label}` : ""}
                </button>
                <button
                  className={`pill-btn ${pickerOpen === "fashion" ? "on" : ""}`}
                  onClick={() =>
                    setPickerOpen((p) => (p === "fashion" ? null : "fashion"))
                  }
                  title="Dress the character in this outfit — works with any model"
                >
                  ⑆ Fashion{selFashion ? ` · ${selFashion.label}` : ""}
                </button>
                <button
                  className={`pill-btn ${pickerOpen === "library" ? "on" : ""}`}
                  onClick={() =>
                    setPickerOpen((p) => (p === "library" ? null : "library"))
                  }
                >
                  ▤ Library{attach ? " · attached" : ""}
                </button>
              </div>
              {pickerOpen === "fashion" && (
                <div className="starter-group">
                  <span className="picker-hint">
                    {selChar
                      ? providerId === "runway"
                        ? "The outfit is composited onto your character before Act-Two animates it."
                        : "The outfit is composited onto your character before the first take — works with any model."
                      : "Pick a Character first — the outfit is composited onto them."}
                  </span>
                  <div className="starter-carousel">
                    {FASHION.filter(
                      (f) => !selChar?.pronoun || f.gender === selChar.pronoun,
                    ).map((f) => (
                      <button
                        key={f.id}
                        className={`starter-card ${fashionId === f.id ? "sel" : ""}`}
                        onClick={() =>
                          setFashionId((cur) => (cur === f.id ? null : f.id))
                        }
                      >
                        <span className="starter-img">
                          <img
                            src={`/fashion/${f.id}.jpg`}
                            alt=""
                            loading="lazy"
                            onError={(e) =>
                              (e.currentTarget.parentElement!.style.display = "none")
                            }
                          />
                        </span>
                        <span className="starter-name">{f.label}</span>
                        <span className="starter-desc">{f.desc}</span>
                      </button>
                    ))}
                    {custom.fashion.map((f) => (
                      <button
                        key={f.id}
                        className={`starter-card ${fashionId === f.id ? "sel" : ""}`}
                        onClick={() =>
                          setFashionId((cur) => (cur === f.id ? null : f.id))
                        }
                      >
                        <span className="starter-img">
                          {f.image && <img src={f.image} alt="" loading="lazy" />}
                        </span>
                        <span className="starter-name">{f.label}</span>
                        <span className="starter-desc">YOUR OUTFIT</span>
                        <span
                          className="starter-del"
                          role="button"
                          title="Delete custom outfit"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustom((cu) => ({
                              ...cu,
                              fashion: cu.fashion.filter((x) => x.id !== f.id),
                            }));
                            if (fashionId === f.id) setFashionId(null);
                          }}
                        >
                          ✕
                        </span>
                      </button>
                    ))}
                    <button
                      className="starter-card add"
                      onClick={() => fashionFileRef.current?.click()}
                    >
                      <span className="starter-name">＋ Custom</span>
                      <span className="starter-desc">UPLOAD AN OUTFIT</span>
                    </button>
                    <input
                      ref={fashionFileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) addCustomFashion(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              )}
              {pickerOpen === "library" && (
                <div className="starter-group">
                  <ul className="library-intro">
                    <li>
                      <b>Takes pile up.</b> Every clip you generate is archived
                      here automatically — pull any past take back as a
                      reference.
                    </li>
                    <li>
                      <b>Grab from a URL.</b> Open the Library
                      (<span className="mono">▦</span>), hit{" "}
                      <span className="mono">＋ Add reference</span>, and paste a
                      YouTube / X / direct link — the video downloads straight
                      into the library.
                    </li>
                    <li>
                      <b>Your own uploads.</b> Reference images and videos you
                      drop onto the composer (multimodal input) live here too,
                      ready to reuse.
                    </li>
                  </ul>
                  {clips.filter((c) => c.videoUrl).length > 0 ? (
                    <div className="starter-carousel">
                      {clips.filter((c) => c.videoUrl).map((c) => (
                        <button
                          key={c.jobId}
                          className="starter-card"
                          title="Attach this clip as the motion reference"
                          onClick={() => {
                            setPickerOpen(null);
                            useClipAsRef(c);
                          }}
                        >
                          <span className="starter-img">
                            <video
                              src={withPw(c.videoUrl!)}
                              muted
                              playsInline
                              preload="metadata"
                              onMouseEnter={(e) =>
                                e.currentTarget.play().catch(() => {})
                              }
                              onMouseLeave={(e) => e.currentTarget.pause()}
                            />
                          </span>
                          <span className="starter-name">
                            {c.provider === "grab"
                              ? "GRAB"
                              : PROVIDERS[c.provider]?.label ?? c.provider}
                          </span>
                          <span className="starter-desc">
                            {(c.note ?? c.prompt).slice(0, 42)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="hint library-empty">
                      Archive is empty — finished takes and GRABs (⤓ in the
                      rail) appear here as motion references.
                    </p>
                  )}
                </div>
              )}
              {(
                [
                  {
                    kind: "char" as const,
                    title: "Character",
                    hint: "The face of your clip. Pick from the built-in cast, or ＋ Custom to add your own (an image + a short description).",
                    items: allCharacters,
                    selId: charId,
                    toggle: (id: string) =>
                      setCharId((cur) => (cur === id ? null : id)),
                  },
                  {
                    kind: "setting" as const,
                    title: "Setting",
                    hint: "Where the clip takes place. Combine it with a character — the base prompt updates as you pick.",
                    items: allSettings,
                    selId: settingId,
                    toggle: (id: string) =>
                      setSettingId((cur) => (cur === id ? null : id)),
                  },
                ]
              ).filter((g) => g.kind === pickerOpen).map((group) => (
                <div className="starter-group" key={group.kind}>
                  <span className="picker-hint">{group.hint}</span>
                  <div className="starter-carousel">
                    {group.items.map((item) => {
                      const isCustom = "custom" in item && item.custom;
                      const imgSrc = isCustom
                        ? (item as CustomAsset).image
                        : `/starters/${item.id}.jpg`;
                      return (
                        <button
                          key={item.id}
                          className={`starter-card ${group.selId === item.id ? "sel" : ""}`}
                          onClick={() => group.toggle(item.id)}
                        >
                          {imgSrc && (
                            <span className="starter-img">
                              {/* baked asset may not exist — hide on 404 */}
                              <img
                                src={imgSrc}
                                alt=""
                                loading="lazy"
                                onError={(e) =>
                                  (e.currentTarget.parentElement!.style.display =
                                    "none")
                                }
                              />
                            </span>
                          )}
                          <span className="starter-name">{item.label}</span>
                          <span className="starter-desc">
                            {item.desc ?? "CUSTOM"}
                          </span>
                          {isCustom && (
                            <span
                              className="starter-del"
                              role="button"
                              title="Delete custom asset"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAsset(group.kind, item.id);
                              }}
                            >
                              ✕
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <button
                      className="starter-card add"
                      onClick={() =>
                        setAssetForm((f) =>
                          f === group.kind ? null : group.kind,
                        )
                      }
                    >
                      <span className="starter-name">＋ Custom</span>
                      <span className="starter-desc">
                        YOUR OWN {group.title.toUpperCase()}
                      </span>
                    </button>
                  </div>

                  {assetForm === group.kind && (
                    <div className="asset-form fade">
                      <div className="asset-form-row">
                        <input
                          value={afLabel}
                          onChange={(e) => setAfLabel(e.target.value)}
                          placeholder="Name"
                          aria-label="Asset name"
                        />
                        {group.kind === "char" && (
                          <div className="select-wrap small">
                            <select
                              aria-label="Pronoun"
                              value={afPronoun}
                              onChange={(e) =>
                                setAfPronoun(e.target.value as "She" | "He")
                              }
                            >
                              <option value="She">SHE</option>
                              <option value="He">HE</option>
                            </select>
                          </div>
                        )}
                        <button
                          className="btn-ghost"
                          onClick={() => assetFileRef.current?.click()}
                        >
                          {afImage ? "Image ✓" : "Image…"}
                        </button>
                        <input
                          ref={assetFileRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) attachAssetImage(f);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <textarea
                        rows={2}
                        value={afPrompt}
                        onChange={(e) => setAfPrompt(e.target.value)}
                        placeholder={
                          group.kind === "char"
                            ? "Subject description — e.g. A tall man in his 30s with round glasses, denim shirt"
                            : "Location description — e.g. sitting on a sunny apartment balcony with plants"
                        }
                        aria-label="Asset prompt"
                      />
                      <div className="asset-form-actions">
                        {afImage && (
                          <img className="asset-form-thumb" src={afImage} alt="" />
                        )}
                        <span className="turn-spacer" />
                        <button
                          className="link-btn"
                          onClick={() => setAssetForm(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={saveAsset}
                          disabled={!afLabel.trim() || !afPrompt.trim()}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {turns.length === 0 && starterDraft != null && (
            <div className="base-prompt fade">
              <span className="label">Base Prompt · yours to edit</span>
              <textarea
                value={starterDraft}
                onChange={(e) => setStarterDraft(e.target.value)}
                rows={5}
                spellCheck={false}
                aria-label="Base prompt"
              />
              <p className="hint">
                This exact text is take 1&apos;s base — nothing hidden. Tweak
                it directly, or type the action below and it gets folded in.
              </p>
            </div>
          )}


          <div
            className={`chat-zone ${dragOver ? "dragover" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) attachMediaFile(f);
            }}
          >
            {(attach ||
              ctxIds.length > 0 ||
              urlCandidate ||
              (turns.length === 0 && (selChar || selSetting))) && (
              <div className="chips-row">
                {urlCandidate && (
                  <span className="sel-chip fade">
                    🔗 {urlCandidate.replace(/^https?:\/\//, "").slice(0, 34)}…
                    <button
                      className="link-btn"
                      onClick={attachFromUrl}
                      disabled={urlFetching}
                    >
                      {urlFetching ? "Fetching…" : "Attach video"}
                    </button>
                    <button
                      className="link-btn danger"
                      onClick={() => setUrlCandidate(null)}
                      aria-label="Dismiss URL"
                    >
                      ✕
                    </button>
                  </span>
                )}
                {ctxIds.map((id) => {
                  const idx = turns.findIndex((t) => t.id === id);
                  if (idx < 0) return null;
                  const t = turns[idx];
                  const img = t.snapshot ?? t.imageThumb;
                  return (
                    <span key={id} className="sel-chip fade">
                      {img && <img src={img} alt="" />}
                      Take {idx + 1}
                      <button
                        className="link-btn danger"
                        onClick={() => toggleCtx(id)}
                        aria-label={`Unpin take ${idx + 1}`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {turns.length === 0 && selChar && (
                  <span className="sel-chip fade">
                    <img
                      src={
                        "custom" in selChar && selChar.custom
                          ? selChar.image
                          : `/starters/${selChar.id}.jpg`
                      }
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    {selChar.label}
                    <button
                      className="link-btn danger"
                      onClick={() => setCharId(null)}
                      aria-label="Remove character"
                    >
                      ✕
                    </button>
                  </span>
                )}
                {turns.length === 0 && selSetting && (
                  <span className="sel-chip fade">
                    <img
                      src={
                        "custom" in selSetting && selSetting.custom
                          ? selSetting.image
                          : `/starters/${selSetting.id}.jpg`
                      }
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    {selSetting.label}
                    <button
                      className="link-btn danger"
                      onClick={() => setSettingId(null)}
                      aria-label="Remove background"
                    >
                      ✕
                    </button>
                  </span>
                )}
                {attach && (
                  <span className="sel-chip fade">
                    <img src={attach.thumb} alt="attached reference" />
                    {attach.kind === "video"
                      ? turns.length === 0 && (selChar || selSetting)
                        ? `Video · performance source (face from card)`
                        : `Video · ${attach.frames.length} frames`
                      : "Image reference"}
                    <button
                      className="link-btn danger"
                      onClick={() => setAttach(null)}
                      aria-label="Remove attachment"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="chat-bar">
              <button
                className="attach-btn"
                title="Attach a reference image — or drag & drop / paste one"
                onClick={() => fileInputRef.current?.click()}
                disabled={Boolean(busyTurn)}
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachMediaFile(f);
                  e.target.value = "";
                }}
              />
              <textarea
                className="chat-input"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // isComposing: the Enter is confirming an IME composition
                  // (Korean/Japanese/Chinese), NOT submitting — ignore it.
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (canSend) guardRun(send);
                  }
                }}
                onPaste={(e) => {
                  const item = [...e.clipboardData.items].find((i) =>
                    i.type.startsWith("image/"),
                  );
                  const f = item?.getAsFile();
                  if (f) {
                    e.preventDefault();
                    attachMediaFile(f);
                    return;
                  }
                  const txt = e.clipboardData.getData("text").trim();
                  if (/^https?:\/\/\S+$/.test(txt)) setUrlCandidate(txt);
                }}
                placeholder={
                  busyTurn
                    ? "Rendering — wait for this take…"
                    : providerId === "runway"
                      ? "Act-Two: attach a driving video (⤓ Grab or Library) + pick a face card, then send — no prompt needed"
                      : starterReady
                        ? "Action for the take — empty = default quiet-surprise beat"
                        : turns.length === 0
                          ? "Pick blocks above and/or describe the clip… (drop an image as reference)"
                          : "What should change in the next take?"
                }
                disabled={Boolean(busyTurn)}
              />
              <button className="btn-primary send-btn" onClick={() => guardRun(send)} disabled={!canSend}>
                {starterReady && !draft.trim() ? "Start" : "Send"}
              </button>
            </div>
            {ctxIds.length > 3 && (
              <p className="ctx-warn fade">
                {ctxIds.length} takes pinned — blends this wide usually come
                out muddy. 2–3 pinned takes keep each reference recognizable.
              </p>
            )}
          </div>
        </section>

        {/* preview + controls — rendered into the LEFT column via CSS order */}
        <section className="output-col">
          <div className="output-head">
            <span className="label">Output</span>
            <span className="status-line">
              <span className={`dot ${status.dot}`} />
              {status.text}
            </span>
          </div>

          <div className="frame" style={{ aspectRatio: frameAspect }}>
            {previewBusy ? (
              <>
                <div className="scanline" />
                <span className="label">Elapsed</span>
                <span className="timer">{fmtElapsed(elapsed)}</span>
                <span className="timer-sub">
                  {previewTurn.status === "refining"
                    ? "REWRITING PROMPT…"
                    : "USUALLY 60–180S"}
                  <br />
                  {previewTurn.jobId?.split("/").pop() ?? ""}
                </span>
              </>
            ) : previewTurn?.videoUrl ? (
              <video
                key={previewTurn.id}
                className="fade"
                src={withPw(previewTurn.videoUrl)}
                autoPlay
                muted
                loop
                playsInline
                controls
              />
            ) : previewTurn?.status === "error" ? (
              <div className="frame-fault fade">
                <span className="label">Take failed</span>
                <p>{previewTurn.error}</p>
                <button
                  className="btn-ghost"
                  onClick={() => guardRun(() => retryTurn(previewTurn.id))}
                  disabled={Boolean(busyTurn)}
                >
                  ↻ Retry with current settings
                </button>
              </div>
            ) : (
              <>
                <span className="frame-idle-label">Output</span>
                <span className="frame-idle-sub">
                  {aspect} · MP4 · {resolution.toUpperCase()}
                </span>
              </>
            )}
          </div>

          {previewTurn?.status === "done" && previewTurn.videoUrl && (
            <div className="result-actions fade">
              <button
                className="btn-ghost"
                onClick={() => download(previewTurn.videoUrl!)}
              >
                ↓ Download
              </button>
              <span className="cost">{fmtCost(previewTurn.costUsd) ?? ""}</span>
            </div>
          )}

          {/* next-take settings — one compact strip */}
          <div className="panel-controls">
            <div className="settings-strip">
              <ModelPicker
                value={modelKey}
                onChange={(k) => {
                  setModelKey(k);
                  setKeyMsg("");
                  setKeyInput("");
                  setKeyPanelHidden(false);
                }}
                keys={keys}
                keysLoaded={keysLoaded}
                onConnectKey={() => setKeyPanelHidden(false)}
                disabled={Boolean(busyTurn)}
              />
              <div className="select-wrap bare">
                <select
                  aria-label="Aspect ratio"
                  title="Aspect ratio"
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value as AspectRatio)}
                >
                  {ASPECT_RATIOS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="select-wrap bare">
                <select
                  aria-label="Duration"
                  title="Each model snaps to what it supports (Veo 4/6/8 · Sora 8 · Grok 1–15)"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {DURATION_CHOICES.map((d) => {
                    const eff = effectiveSeconds(providerId, d, resolution);
                    return (
                      <option key={d} value={d}>
                        {d}S{eff !== d ? ` → ${eff}S` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="select-wrap bare">
                <select
                  aria-label="Resolution"
                  title="Resolution"
                  value={resolution}
                  onChange={(e) => {
                    const r = e.target.value as Resolution;
                    setResolution(r);
                    if (r !== "720p") setDuration(8);
                  }}
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="select-wrap bare">
                <select
                  aria-label="Continuity"
                  title="Carry a frame from the last take into the next one"
                  value={continuity ? "on" : "off"}
                  onChange={(e) => setContinuity(e.target.value === "on")}
                >
                  <option value="on">CONT ON</option>
                  <option value="off">CONT OFF</option>
                </select>
              </div>
              <span className="strip-cost" title="Estimated cost per take">
                {estCostUsd != null ? `≈$${estCostUsd.toFixed(2)}` : "$—"}
              </span>
            </div>

            {keyMissing && !keyPanelHidden && (
              <div className="stub-note key-popover fade">
                <button
                  className="side-del key-popover-close"
                  onClick={() => setKeyPanelHidden(true)}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
                <span className="label">
                  {providerInfo.label} · API key required
                </span>
                {keysWritable ? (
                  <>
                    <div className="key-row">
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={`Paste ${providerInfo.envVar}`}
                        aria-label={providerInfo.envVar}
                        onKeyDown={(e) => e.key === "Enter" && saveKey()}
                      />
                      <button
                        className="btn-ghost"
                        onClick={saveKey}
                        disabled={keySaving || !keyInput.trim()}
                      >
                        {keySaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    <p className="key-hint">
                      Writes to <code>.env.local</code>, effective immediately ·{" "}
                      <a href={providerInfo.keyUrl} target="_blank" rel="noreferrer">
                        Get a key ↗
                      </a>
                    </p>
                  </>
                ) : (
                  <p className="key-hint">
                    Set <code>{providerInfo.envVar}</code> in Vercel → Settings →
                    Environment Variables, then redeploy ·{" "}
                    <a href={providerInfo.keyUrl} target="_blank" rel="noreferrer">
                      Get a key ↗
                    </a>
                  </p>
                )}
                {keyMsg && <p className="key-msg">{keyMsg}</p>}
              </div>
            )}
            {!keyMissing && keyMsg && <p className="key-msg fade">{keyMsg}</p>}
          </div>
        </section>
      </main>

      {/* archive — this session's takes; the rail icon opens everything */}
      <section className="archive">
        <div className="archive-head">
          <span className="label">
            Archive · This Session · {sessionClips.length}
          </span>
          <button className="link-btn" onClick={() => router.push("/archive")}>
            All takes ({clips.length}) →
          </button>
        </div>
        {sessionClips.length === 0 ? (
          <p className="hint">
            No finished takes in this session yet
            {clips.length > 0 ? " — the ▦ icon in the rail has everything" : ""}.
          </p>
        ) : (
          <div className="gallery-grid">
            {sessionClips.map((c) => (
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
        )}
      </section>
      </div>

      {showUpdate && (
        <UpdateGuide latest={latest} onClose={() => setShowUpdate(false)} />
      )}
      {showHelp && <HelpGuide onClose={() => setShowHelp(false)} />}
    </>
  );
}
