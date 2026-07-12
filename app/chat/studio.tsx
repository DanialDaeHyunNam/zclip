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
import { AboutModal } from "./about-modal";
import { useRouter } from "next/navigation";
import { Rail } from "../rail";
import { ModelPicker } from "../model-picker";
import { ClipCardView } from "../clip-card";
import {
  type Clip,
  fmtCost,
  cssAspect,
  isLocalVideoUrl,
  GALLERY_KEY,
  SESSIONS_KEY,
  SESSION_ID_KEY,
  PW_KEY,
  PENDING_REF_KEY,
} from "@/lib/clip";
import { persistRemoteVideo } from "@/lib/persist-clip";
import {
  type RefMix,
  DEFAULT_REF_MIX,
  REF_MIX_KEY,
  REF_MIX_FIELDS,
  loadRefMix,
  refMixRules,
  refMixSummary,
} from "@/lib/ref-mix";
import { SPEC_VERSION } from "@/lib/video-prompt-spec";
import {
  type SpecAnswer,
  gateForProvider,
  gateOptions,
  runSelfChecks,
} from "@/lib/spec-check";

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
  /** This take was sent with a manual/library reference attachment. The
   *  attachment itself is NOT stored (too big), so a retry can't reproduce
   *  it — retryTurn refuses instead of silently re-running without it. */
  usedRef?: boolean;
  /** Labels of takes the user pinned as context for this one, e.g. "T2 T4". */
  ctxLabel?: string;

  /* ── Video Prompt Spec Gate cards (kind set ⇒ NOT a take: no video, no
   *    cost, status stays "done", excluded from take numbering/history). ── */
  /** "gate" = one unresolved-gate question card, "preview" = assembled-spec
   *  confirm card. Undefined = a normal take (back-compat with stored data). */
  kind?: "gate" | "preview";
  /** Interview flow this card belongs to — one flow per typed draft. */
  specFlow?: string;
  /** The original free-typed draft, carried on every card of the flow. */
  specDraft?: string;
  gateId?: string;
  /** Snapshot of the question at ask time (profile-aware — options may be
   *  clamped per provider, so the live GATES lookup wouldn't be faithful). */
  gateQ?: string;
  gateWhy?: string;
  gateOpts?: string[];
  /** The user's answer — set ⇒ this card is resolved. */
  gateAnswer?: string;
  /** Checker's one-line note about non-critical defaults applied. */
  specNote?: string;
  /** Provider-fit warnings from the MODEL_PROFILES validation. */
  specWarnings?: string[];
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
  /** Sidebar order is creation time DESC, stable across opens/saves. Older
   *  sessions predate this field — their id (`s${Date.now()}`) carries it. */
  createdAt?: number;
  /** The user renamed this session — auto-save must never overwrite the
   *  title with the first message again. */
  renamed?: boolean;
  /** Pinned sessions float above the rest of the sidebar list. */
  pinned?: boolean;
  turns: Turn[];
}

const sessionCreatedAt = (s: StoredSession): number =>
  s.createdAt ?? Number(/^s(\d+)$/.exec(s.id)?.[1] ?? s.updatedAt);

/** Pinned first, then creation time DESC — stable across opens/saves. */
const sessionOrder = (a: StoredSession, b: StoredSession): number =>
  Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
  sessionCreatedAt(b) - sessionCreatedAt(a);

const PinGlyph = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 16v6" />
    <path d="M9 4h6l-1 6 3.5 4h-11L10 10 9 4z" />
  </svg>
);

const THREAD_KEY = "hooklab.thread";
const ASSETS_KEY = "hooklab.customAssets";
/** "1" = user declined the Gemini-key pitch — sends go out exactly as
 *  typed (no refine, no spec interview) until they add a key. */
const SPEC_DECLINED_KEY = "hooklab.specDeclined";
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

/** One line of the "what this model does with your context" manifest. */
interface ManifestRow {
  icon: string;
  label: string;
  role: string;
  ignored?: boolean;
}

/** Every model consumes context differently — Act-Two transfers a driving
 *  performance onto a face and ignores scene/prompt, while Veo/Sora/Grok take
 *  one reference image and fold everything else into the rewritten prompt.
 *  This maps the CURRENTLY attached context to what the selected model will
 *  actually do with each piece, flagging the parts it drops. */
function contextManifest(
  provider: ProviderName,
  has: {
    char?: string;
    setting?: string;
    fashion?: string;
    attachKind?: "image" | "video" | null;
    pins: number;
    text: boolean;
    /** Reference-mix summary shown on the video row, e.g. "drops: on-screen text". */
    mixNote?: string;
    /** True when the selected model ingests the actual video (Seedance 2.0),
     *  not just extracted frames. */
    fullVideoRef?: boolean;
  },
): ManifestRow[] {
  const transfer = provider === "runway"; // Act-Two = performance transfer
  const rows: ManifestRow[] = [];
  if (has.char)
    rows.push({
      icon: "✦",
      label: `Character · ${has.char}`,
      role: transfer
        ? "face / identity — required"
        : has.fullVideoRef
          ? "described in the prompt only — Seedance 2.0 can't mix a frame image with a video reference"
          : "reference image (the face)",
    });
  if (has.setting)
    rows.push({
      icon: "◫",
      label: `Background · ${has.setting}`,
      role: transfer
        ? "ignored — Act-Two keeps the driving clip's scene"
        : "woven into the prompt",
      ignored: transfer,
    });
  if (has.fashion)
    rows.push({
      icon: "⑆",
      label: `Fashion · ${has.fashion}`,
      role: has.char
        ? "composited onto the character before generation"
        : "needs a Character — pick one or the outfit is ignored",
      ignored: !has.char,
    });
  if (has.attachKind === "video")
    rows.push({
      icon: "▤",
      label: "Reference video",
      role:
        (transfer
          ? "driving performance — required"
          : has.fullVideoRef
            ? "read directly — motion + audio (uploaded for the job)"
            : "motion cue for the prompt + a frame reference") +
        (has.mixNote ? ` · ${has.mixNote}` : ""),
    });
  if (has.attachKind === "image")
    rows.push({
      icon: "▤",
      label: "Reference image",
      role: transfer ? "ignored — Act-Two needs a driving video" : "reference image",
      ignored: transfer,
    });
  if (has.pins)
    rows.push({
      icon: "❐",
      label: `${has.pins} pinned take${has.pins > 1 ? "s" : ""}`,
      role: transfer ? "ignored" : "blended into the prompt",
      ignored: transfer,
    });
  if (has.text)
    rows.push({
      icon: "✎",
      label: "Your text",
      role: transfer ? "ignored — Act-Two takes no prompt" : "your instruction",
      ignored: transfer,
    });
  return rows;
}

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
  const [showAbout, setShowAbout] = useState(false);
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
  // Reference carry-over mix — which aspects of an attached reference video
  // the next take copies vs. explicitly drops (each choice becomes a labeled
  // hard rule for the refiner). Sticky: saved as the default for future
  // references; the dialog auto-opens ONCE on the first-ever video reference
  // ("take everything from this?").
  const [refMix, setRefMix] = useState<RefMix>(DEFAULT_REF_MIX);
  const [mixOpen, setMixOpen] = useState(false);
  const mixAsked = useRef(false);
  // pasted video URL waiting to be fetched into the reference pipeline
  const [urlCandidate, setUrlCandidate] = useState<string | null>(null);
  const [urlFetching, setUrlFetching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Carry each take's snapshot into the next take automatically. */
  const [continuity, setContinuity] = useState(true);
  /* Video Prompt Spec Gate: interview-before-money mode (session-only,
   * like continuity). specBusy = a check/assemble call is in flight. */
  const [specMode, setSpecMode] = useState(false);
  const [specBusy, setSpecBusy] = useState<"check" | "assemble" | null>(null);
  /** Gemini-key onboarding modal. draft = the send it interrupted
   *  ("" ⇒ opened from the SPEC button, nothing pending). */
  const [specPitch, setSpecPitch] = useState<{ draft: string } | null>(null);
  const [specDeclined, setSpecDeclined] = useState(false);
  const [pitchInput, setPitchInput] = useState("");
  const [pitchSaving, setPitchSaving] = useState(false);
  const [pitchMsg, setPitchMsg] = useState("");
  /** Synchronous re-entry lock for the spec flow (same reason as
   *  sendLockRef — chip double-clicks and the model-switch effect race
   *  React's async state commits). */
  const specLockRef = useRef(false);
  const snapCapturing = useRef(new Set<string>());
  const vaultTried = useRef(new Set<string>());
  /** `${turnId}:${videoUrl}` of a preview <video> that failed to load — keyed
   *  on the URL too, so a vault recovery swapping in a local URL retries. */
  const [deadPreview, setDeadPreview] = useState<string | null>(null);
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
  // Vercel Blob token onboarding (Seedance 2.0 video references only)
  const [blobInput, setBlobInput] = useState("");
  const [blobSaving, setBlobSaving] = useState(false);
  const [blobMsg, setBlobMsg] = useState("");
  const [blobPanelHidden, setBlobPanelHidden] = useState(false);
  /** Turn ids pinned as context for the NEXT take. */
  const [ctxIds, setCtxIds] = useState<string[]>([]);

  // GRAB (fetch a reference video by URL) now lives on the /archive page.

  const model = resolveModel(modelKey);
  const providerId = model.provider;
  const providerInfo = PROVIDERS[providerId];
  // Act-Two has no duration knob — its output length IS the driving clip's,
  // clamped to Runway's 1–15s. Surface that real number (and bill on it)
  // instead of the UI duration selector, which Act-Two ignores.
  const runwaySecs =
    attach?.kind === "video"
      ? Math.round(Math.min(15, Math.max(1, attach.srcSeconds ?? 8)))
      : null;
  const estCostUsd = estimateModelCost(
    model,
    resolution,
    providerId === "runway" && runwaySecs != null ? runwaySecs : duration,
  );
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

  /** Persist a mix change immediately — it doubles as the sticky default. */
  const saveRefMix = useCallback((mix: RefMix) => {
    setRefMix(mix);
    store.set(REF_MIX_KEY, JSON.stringify(mix));
  }, []);

  /** Desktop notification when a take lands while this tab is hidden —
   *  pointless while the user is already looking at it. */
  const notifyDone = useCallback((title: string, body: string) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    try {
      const n = new Notification(title, { body });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* some browsers restrict constructor use — silently skip */
    }
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
      setRefMix(loadRefMix(store.get(REF_MIX_KEY)));
      // A saved mix means the "take everything?" first-ask already happened.
      mixAsked.current = Boolean(store.get(REF_MIX_KEY));
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
      const existing = prev.find((s) => s.id === sessionId);
      let next = prev.filter((s) => s.id !== sessionId);
      if (turns.length) {
        next = [
          {
            id: sessionId,
            title: existing?.renamed
              ? existing.title
              : turns[0].userText.slice(0, 60),
            renamed: existing?.renamed,
            pinned: existing?.pinned,
            updatedAt: Date.now(),
            createdAt: existing
              ? sessionCreatedAt(existing)
              : Number(/^s(\d+)$/.exec(sessionId)?.[1]) || Date.now(),
            turns: compactTurns(turns),
          },
          ...next,
        ].slice(0, MAX_SESSIONS);
      } else if (existing) {
        // Keep the empty entry (+ New's "New session" placeholder) listed —
        // dropping it made + New look like nothing happened.
        next = [existing, ...next];
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

  /* remembered decline of the Gemini-key pitch */
  useEffect(() => {
    if (!hydrated) return;
    setSpecDeclined(store.get(SPEC_DECLINED_KEY) === "1");
  }, [hydrated]);

  /* the one in-flight turn (single-flight session) */
  const busyTurn = turns.find(
    (t) => t.status === "refining" || t.status === "pending",
  );
  /** 1-based take number for the turn at index i — spec gate/preview cards
   *  live in the thread but don't count as takes. */
  const takeNo = (i: number) =>
    turns.slice(0, i + 1).filter((t) => !t.kind).length;
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

    const modelLabel = pollTurn.modelLabel ?? provider;
    const poll = async () => {
      if (Date.now() - createdAt > GIVE_UP_MS) {
        finish({ status: "error", error: "Timed out after 12 minutes" });
        notifyDone("ZCLIP — take failed", `${modelLabel} · timed out after 12 minutes`);
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
          notifyDone("ZCLIP — take is ready", `${modelLabel} · click to view`);
        } else if (body.state === "error") {
          finish({ status: "error", error: body.error }, body.error);
          notifyDone(
            "ZCLIP — take failed",
            `${modelLabel} · ${String(body.error ?? "generation failed").slice(0, 120)}`,
          );
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
  }, [pollTurn?.jobId, ready, pwHeaders, patchTurn, notifyDone]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* vault every finished take's video into .zclip-data/clips — provider
     links are signed and expire within a day or two, so a take not saved
     locally is eventually a dead <video>. Clips whose stored link already
     died get one recovery attempt: re-poll the provider by jobId for a
     fresh signed URL, then vault that. Unrecoverable clips keep their dead
     URL and the preview shows a "source expired" fault. */
  useEffect(() => {
    if (!hydrated || !ready || hosted) return;
    const candidates = new Map<string, { provider: string; url: string }>();
    for (const c of clips) {
      if (c.provider === "grab" || !c.videoUrl || isLocalVideoUrl(c.videoUrl)) continue;
      candidates.set(c.jobId, { provider: c.provider, url: c.videoUrl });
    }
    for (const t of turns) {
      if (t.status !== "done" || !t.jobId || !t.videoUrl || isLocalVideoUrl(t.videoUrl)) continue;
      candidates.set(t.jobId, { provider: t.provider, url: t.videoUrl });
    }
    for (const [jobId, { provider, url }] of candidates) {
      if (vaultTried.current.has(jobId)) continue;
      vaultTried.current.add(jobId);
      void persistRemoteVideo(
        jobId,
        provider,
        url,
        pwHeaders({ "content-type": "application/json" }),
      ).then((local) => {
        if (!local) return;
        setTurns((ts) => ts.map((t) => (t.jobId === jobId ? { ...t, videoUrl: local } : t)));
        setClips((cs) =>
          cs.map((c) =>
            c.jobId === jobId
              ? { ...c, videoUrl: local, remoteUrl: c.remoteUrl ?? c.videoUrl }
              : c,
          ),
        );
      });
    }
  }, [turns, clips, hydrated, ready, hosted, pwHeaders]);

  /* first-ever video reference → ask once what to carry over from it */
  useEffect(() => {
    if (attach?.kind === "video" && !mixAsked.current) {
      mixAsked.current = true;
      setMixOpen(true);
    }
  }, [attach?.kind]);

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
    // First generation request = the user-gesture moment browsers accept a
    // Notification permission prompt (renders take 60–180s; people tab away).
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
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

  /* ── Video Prompt Spec Gate flow (docs/VIDEO-PROMPT-SPEC.md) ────────
   * SPEC mode replaces refine→generate with: check the draft against the
   * gates (provider-aware) → ask ONE question card per unresolved gate →
   * assemble the 15-section prompt → preview card → generate VERBATIM. */

  /** Answered gate cards of one interview flow, in thread order. */
  const flowAnswers = (flowId: string): SpecAnswer[] =>
    turns
      .filter(
        (t) =>
          t.specFlow === flowId && t.kind === "gate" && t.gateId && t.gateAnswer,
      )
      .map((t) => ({ id: t.gateId!, answer: t.gateAnswer! }));

  /** One spec step: which gates are still open? Append the next question
   *  card — or, when all critical gates pass, assemble + append the
   *  preview card. Text-only Gemini calls (~free); money moves only on
   *  the preview card's explicit Generate. */
  const advanceSpec = async (
    flowId: string,
    draftText: string,
    answers: SpecAnswer[],
  ) => {
    if (specLockRef.current) return;
    specLockRef.current = true;
    setSpecBusy("check");
    try {
      const call = (mode: "check" | "assemble") =>
        fetch("/api/spec-check", {
          method: "POST",
          headers: pwHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            mode,
            draft: draftText,
            answers,
            provider: providerId,
            targetSeconds: effectiveSeconds(providerId, duration, resolution),
            aspect,
          }),
        });
      const r = await call("check");
      const b = await r.json();
      if (r.status === 401) {
        setError("Password rejected");
        setGateOpen(true);
        return;
      }
      if (!r.ok) {
        setError(b.error ?? "Spec check failed");
        return;
      }
      const nextGate = ((b.missing ?? []) as string[])
        .map((gid) => gateForProvider(gid, providerId))
        .find(Boolean);
      const common = {
        provider: providerId,
        modelLabel: model.short,
        aspectRatio: aspect,
        durationSeconds: duration,
        resolution,
        createdAt: Date.now(),
        status: "done" as TurnStatus,
        specFlow: flowId,
        specDraft: draftText,
        specNote: (b.note as string) || undefined,
        specWarnings: (b.warnings as string[])?.length
          ? (b.warnings as string[])
          : undefined,
        // First card of a flow shows the draft as the user message.
        userText: answers.length ? "" : draftText,
      };
      if (nextGate) {
        setTurns((ts) => [
          ...ts,
          {
            ...common,
            id: `t${Date.now()}`,
            kind: "gate",
            gateId: nextGate.id,
            gateQ: nextGate.question,
            gateWhy: nextGate.why,
            gateOpts: gateOptions(nextGate, providerId),
          },
        ]);
        return;
      }
      setSpecBusy("assemble");
      const ar = await call("assemble");
      const ab = await ar.json();
      if (ar.status === 401) {
        setError("Password rejected");
        setGateOpen(true);
        return;
      }
      if (!ar.ok) {
        setError(ab.error ?? "Spec assembly failed");
        return;
      }
      setTurns((ts) => [
        ...ts,
        { ...common, id: `t${Date.now()}`, kind: "preview", prompt: ab.prompt },
      ]);
    } catch {
      setError("Network error — try again");
    } finally {
      specLockRef.current = false;
      setSpecBusy(null);
    }
  };

  const answerGate = (turnId: string, answer: string) => {
    const t = turns.find((x) => x.id === turnId);
    const a = answer.trim();
    if (!t || t.kind !== "gate" || t.gateAnswer || !a || specLockRef.current)
      return;
    patchTurn(turnId, { gateAnswer: a });
    void advanceSpec(t.specFlow!, t.specDraft ?? "", [
      ...flowAnswers(t.specFlow!).filter((x) => x.id !== t.gateId),
      { id: t.gateId!, answer: a },
    ]);
  };

  /** Submit a finished prompt to /api/generate EXACTLY as written — the
   *  spec gate's whole point is that no refine pass runs on top (Gemini
   *  rewriting a finished spec loses the double locks). */
  const submitVerbatim = async (prompt: string, userText: string) => {
    if (busyTurn || sendLockRef.current) return;
    sendLockRef.current = true;
    const id = `t${Date.now()}`;
    const turn: Turn = {
      id,
      userText,
      prompt,
      provider: providerId,
      modelLabel: model.short,
      aspectRatio: aspect,
      durationSeconds: duration,
      resolution,
      createdAt: Date.now(),
      status: "refining",
      costUsd: estCostUsd ?? undefined,
    };
    setTurns((ts) => [...ts, turn]);
    setSelectedId(id);
    try {
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
    } finally {
      sendLockRef.current = false;
    }
  };

  /** The always-visible escape hatch: never trap the user in the
   *  interview — run the ORIGINAL draft as typed (still verbatim, still
   *  behind the pre-spend confirm). */
  const skipSpec = (t: Turn) => {
    const raw = t.specDraft?.trim();
    if (!raw) return;
    guardRun(() => void submitVerbatim(raw, raw));
  };

  const specGenerate = (t: Turn) => {
    if (!t.prompt) return;
    guardRun(() => void submitVerbatim(t.prompt!, t.specDraft ?? "Spec take"));
  };

  /** Gemini-key pitch modal — "Save & improve": store the key exactly like
   *  the provider key panel (.env.local via /api/keys), then run the spec
   *  interview on the send the modal interrupted. */
  const pitchSaveKey = async () => {
    if (!pitchInput.trim() || pitchSaving) return;
    setPitchSaving(true);
    setPitchMsg("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          envVar: "GEMINI_API_KEY",
          value: pitchInput.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPitchMsg(body.error ?? "Could not save the key");
        return;
      }
      setPitchInput("");
      await refreshKeys();
      const pending = specPitch?.draft ?? "";
      setSpecPitch(null);
      setSpecMode(true); // the pitch IS the spec opt-in
      if (pending) {
        setDraft("");
        await advanceSpec(`sf${Date.now()}`, pending, []);
      }
    } catch {
      setPitchMsg("Network error — could not save the key.");
    } finally {
      setPitchSaving(false);
    }
  };

  /** "No thanks" — remember it, and run the interrupted send exactly as
   *  typed (still behind the pre-spend confirm; it's real money). */
  const pitchDecline = () => {
    const pending = specPitch?.draft ?? "";
    setSpecPitch(null);
    setSpecDeclined(true);
    store.set(SPEC_DECLINED_KEY, "1");
    if (pending) {
      setDraft("");
      guardRun(() => void submitVerbatim(pending, pending));
    }
  };

  /* Per-model adaptation (docs § Per-model adaptation): switching the
   * model while an interview/preview is OPEN re-runs the spec check
   * against the new provider's profile — the pending card is replaced,
   * answered cards keep their answers. Keyed off the card's own stored
   * provider, so a completed advanceSpec can't re-trigger it. */
  useEffect(() => {
    if (!ready || specLockRef.current) return;
    const last = turns[turns.length - 1];
    if (!last?.kind || last.provider === providerId) return;
    if (last.kind === "gate" && last.gateAnswer) return; // resolved card
    setTurns((ts) => ts.slice(0, -1));
    void advanceSpec(
      last.specFlow!,
      last.specDraft ?? "",
      flowAnswers(last.specFlow!),
    );
  }, [providerId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (sendLockRef.current) return; // a submit is already in flight
    const text = draft.trim();
    const manual = attach;
    // The VISIBLE (possibly user-edited) base text is what actually runs.
    const starterText =
      turns.length === 0 && starterDraft?.trim() ? starterDraft.trim() : null;
    const starterLabel = starterText
      ? composeStarter(selChar, selSetting, aspect, duration)?.label ??
        "Custom base"
      : undefined;
    const ctxTurns = ctxIds
      .map((id) => ({ idx: turns.findIndex((t) => t.id === id) }))
      .filter(({ idx }) => idx >= 0 && turns[idx].prompt)
      .sort((a, b) => a.idx - b.idx)
      .map(({ idx }) => ({ take: takeNo(idx), turn: turns[idx] }));
    if (
      busyTurn ||
      (!text &&
        !starterText &&
        !manual &&
        !ctxTurns.length &&
        !selChar &&
        !selSetting) ||
      keyMissing
    )
      return;
    setError(null);
    sendLockRef.current = true;
    try {

    // ── Gemini-key onboarding: BOTH conversational layers (refine and
    // the spec interview) run on GEMINI_API_KEY. Text-only send without
    // it → pitch the key once; declined ⇒ this and future sends go to
    // the video model exactly as typed (previously this errored out). ──
    if (
      providerId !== "runway" &&
      keysLoaded &&
      !keys["GEMINI_API_KEY"] &&
      text &&
      !manual &&
      !selChar &&
      !selSetting &&
      !ctxTurns.length &&
      !starterText
    ) {
      if (!specDeclined) {
        setSpecPitch({ draft: text }); // composer keeps the draft on Cancel
        return;
      }
      setDraft("");
      sendLockRef.current = false; // hand off to submitVerbatim's own lock
      await submitVerbatim(text, text);
      return;
    }

    // ── SPEC gate mode: interview instead of instant refine→generate.
    // Text-first track — Act-Two (no prompt at all) is exempt. ──
    if (specMode && providerId !== "runway") {
      if (!text) {
        setError(
          "SPEC gate needs a typed description — it interviews you about whatever the spec still misses.",
        );
        return;
      }
      if (manual || selChar || selSetting || ctxTurns.length || starterText) {
        setError(
          "SPEC gate is text-first for now — detach references/cards, or toggle SPEC off for this take.",
        );
        return;
      }
      setDraft("");
      await advanceSpec(`sf${Date.now()}`, text, []);
      return;
    }

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

    // Context blend: Character + Background cards, a manual/library reference,
    // and pinned takes can ALL be added at once (any model). The refiner sees
    // every one of them; the video model gets a single primary image chosen
    // per its own rules (character face wins — see the manifest under the
    // composer). Cards stay live at take 1 (base compose) AND mid-thread.
    // Seedance 2.0 hard-rejects image inputs that look like real people
    // ("input image may contain real person", verified live 2026-07-10) —
    // and continuity snapshots are exactly that, so they never go to it.
    // The refiner (Gemini) still sees them via refImages; only the video
    // model's primary image is affected.
    const lastSnap =
      !manual && !selChar && !selSetting && !ctxIds.length && continuity &&
      model.key !== "seedance-2"
        ? [...turns].reverse().find((t) => t.snapshot)?.snapshot
        : undefined;
    const [charImgRaw, settingImg] =
      selChar || selSetting
        ? await Promise.all([assetRefB64(selChar), assetRefB64(selSetting)])
        : [null, null];
    // Dress the CHARACTER reference in the picked outfit (not just Act-Two):
    // every video provider takes an image reference, so the dressed frame
    // makes any model render the character wearing the selected fashion.
    const charImg =
      charImgRaw && selFashion ? await dressWithFashion(charImgRaw) : charImgRaw;
    const assetImages = [charImg, settingImg].filter(Boolean) as string[];
    // Video attach + character card = PERFORMANCE TRANSFER: the video drives
    // the choreography (via transcription), the card supplies the identity.
    const transfer = manual?.kind === "video" && !!charImg;
    const assetThumb = selChar
      ? "custom" in selChar && selChar.custom
        ? selChar.image
        : `/starters/${selChar.id}.jpg`
      : selSetting
        ? "custom" in selSetting && selSetting.custom
          ? selSetting.image
          : `/starters/${selSetting.id}.jpg`
        : undefined;
    const ctxImages = ctxTurns
      .map(({ turn }) => turn.snapshot)
      .filter(Boolean) as string[];
    // Everything the refiner should see, merged (character/scene, then the
    // manual/library reference, then pinned takes).
    const refImages = [
      ...assetImages.map((d) => ({ base64: d, mimeType: "image/jpeg" })),
      ...(manual
        ? manual.frames.map((b) => ({ base64: b, mimeType: manual.mimeType }))
        : []),
      ...ctxImages.map((d) => ({
        base64: d.split(",")[1],
        mimeType: "image/jpeg",
      })),
      ...(lastSnap
        ? [{ base64: lastSnap.split(",")[1], mimeType: "image/jpeg" }]
        : []),
    ];
    // Generation gets ONE image: character face first, then a manual image's
    // middle frame, then the background, then a pinned/continuity frame.
    const rawPrimaryB64 = charImg
      ? charImg
      : manual
        ? manual.frames[Math.floor((manual.frames.length - 1) / 2)]
        : settingImg
          ? settingImg
          : ctxImages.length
            ? ctxImages[0].split(",")[1]
            : lastSnap
              ? lastSnap.split(",")[1]
              : undefined;
    const primaryImage = rawPrimaryB64
      ? {
          base64: await normalizeRefB64(rawPrimaryB64, aspect),
          mimeType: "image/jpeg",
        }
      : undefined;

    const id = `t${Date.now()}`;
    const createdAt = Date.now();
    const base = turns.length
      ? [...turns].reverse().find((t) => !t.kind && t.prompt)?.prompt
      : starterText ?? undefined;
    // Earlier takes give the refiner context for "take 1's background" etc.
    // (spec cards excluded — a preview card's prompt isn't a produced take)
    const history = turns
      .filter((t) => !t.kind)
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
      usedRef: Boolean(manual),
      ctxLabel: ctxTurns.length
        ? ctxTurns.map((c) => `T${c.take}`).join(" ")
        : undefined,
    };
    setTurns((ts) => [...ts, turn]);
    setDraft("");
    setAttach(null);
    setCtxIds([]);
    // Context cards are one-shot per take (like the attachment) — clear them
    // so the next take continues cleanly instead of re-injecting the card.
    setCharId(null);
    setSettingId(null);
    setFashionId(null);
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
            // The reference-mix checkboxes, as labeled hard rules.
            rules: manual?.kind === "video" ? refMixRules(refMix) : undefined,
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
          // Seedance 2.0 reads the WHOLE reference clip (motion + audio) —
          // send the actual video, not just the extracted frames.
          drivingVideo:
            model.key === "seedance-2" &&
            manual?.kind === "video" &&
            manual.videoBase64
              ? {
                  base64: manual.videoBase64,
                  mimeType: manual.videoMime ?? "video/mp4",
                }
              : undefined,
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
    // Already on a fresh, empty session — a second + New would only stack
    // empty "New session" entries in the sidebar.
    if (!turns.length) return;
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
    // Materialize the session in the sidebar immediately — a + New that only
    // swaps the main view reads as "nothing happened". The first message
    // replaces this placeholder title via the auto-save effect.
    setSessions((prev) => {
      const next = [
        {
          id: nid,
          title: "New session",
          updatedAt: Date.now(),
          createdAt: Date.now(),
          turns: [],
        },
        // …and sweep any stale never-sent placeholders while we're at it.
        ...prev.filter((s) => s.id !== nid && s.turns.length > 0),
      ].slice(0, MAX_SESSIONS);
      store.set(SESSIONS_KEY, JSON.stringify(next));
      return next;
    });
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

  // Inline session rename (sidebar ⋯ menu / double-click on the title).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // The one open ⋯ menu (Rename / Delete) — outside click / Escape closes.
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const togglePin = (id: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned } : s,
      );
      store.set(SESSIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const startRename = (s: StoredSession) => {
    setRenamingId(s.id);
    setRenameDraft(s.title);
  };

  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const title = renameDraft.trim().slice(0, 60);
    if (!title) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, title, renamed: true } : s,
      );
      store.set(SESSIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

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
    // Walking away from a session where nothing was ever SENT (no turns —
    // a turn exists once a prompt is sent, even if it errored) drops its
    // "New session" placeholder: an untouched session isn't worth keeping.
    setSessions((prev) => {
      const next = prev.filter((s) => s.turns.length > 0 || s.id === id);
      if (next.length !== prev.length) {
        store.set(SESSIONS_KEY, JSON.stringify(next));
      }
      return next;
    });
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
    // References aren't stored after sending, so a retry could only re-run
    // WITHOUT them — silently billing for a take the user didn't ask for.
    // Refuse loudly instead (visible-errors principle).
    if (turn.usedRef) {
      setError(
        `Take ${takeNo(idx)} was sent with an attached reference, which isn't kept after sending — a retry would re-run (and bill) without it. Re-attach the reference (Library → "use as reference") and send the message again instead.`,
      );
      return;
    }
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
        const earlier = turns.slice(0, idx).filter((t) => !t.kind);
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

  /** Same flow as saveKey, for the Vercel Blob token — Seedance 2.0's video
   *  references are URL-only, so the clip is parked on the USER's own Blob
   *  store for the job (BYOK philosophy: their store, their token). */
  const saveBlobToken = async () => {
    if (!blobInput.trim() || blobSaving) return;
    setBlobSaving(true);
    setBlobMsg("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: pwHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          envVar: "BLOB_READ_WRITE_TOKEN",
          value: blobInput.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setBlobMsg(body.error ?? "Could not save the token");
      } else {
        setBlobInput("");
        setBlobMsg("Saved to .env.local — video references are ready.");
        await refreshKeys();
      }
    } catch {
      setBlobMsg("Network error — could not save the token.");
    } finally {
      setBlobSaving(false);
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
    turns.find((t) => t.id === selectedId && !t.kind) ??
    busyTurn ??
    [...turns].reverse().find((t) => !t.kind && t.status === "done") ??
    [...turns].reverse().find((t) => !t.kind);
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
    !specBusy &&
    ready &&
    !keyMissing &&
    Boolean(
      draft.trim() ||
        attach ||
        starterReady ||
        ctxIds.length ||
        selChar ||
        selSetting,
    );

  /** Composer submit. Starting a SPEC interview is free (text-only Gemini
   *  calls), so it bypasses the pre-spend confirm — in spec mode the
   *  confirm moves to the preview card's Generate / the skip hatch. */
  const sendGuarded = () => {
    if (specMode && providerId !== "runway") void send();
    else guardRun(send);
  };

  // What the selected model will do with each attached piece of context.
  const manifest = contextManifest(providerId, {
    char: selChar?.label,
    setting: selSetting?.label,
    fashion: selFashion?.label,
    attachKind: attach?.kind ?? null,
    pins: ctxIds.length,
    text: Boolean(draft.trim()),
    mixNote: attach?.kind === "video" ? refMixSummary(refMix) : undefined,
    fullVideoRef: model.key === "seedance-2" && Boolean(attach?.videoBase64),
  });

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
                    ? runwaySecs != null
                      ? `${runwaySecs}s · driving clip`
                      : "driving clip length"
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
      {/* Gemini-key pitch — the spec interview's onboarding (UX: pitch on
          first key-less send; decline = run as typed; the SPEC button
          reopens this forever). Cancel via backdrop keeps the draft. */}
      {specPitch && (
        <div className="confirm-backdrop" onClick={() => setSpecPitch(null)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <span className="label">Make it look real — 1 free key</span>
            <p className="pitch-copy">
              Add a <b>Gemini API key</b> (free tier is enough — it only
              powers the conversation, not the video) and ZCLIP will
              interview you before any money is spent: a few optimized
              questions, then your words become a full photoreal spec
              prompt. Slightly more questions, far more believable clips.
            </p>
            <div className="pitch-row">
              <input
                value={pitchInput}
                onChange={(e) => setPitchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && pitchSaveKey()}
                placeholder="Paste GEMINI_API_KEY"
                aria-label="Gemini API key"
              />
              <button
                className="btn-primary"
                disabled={!pitchInput.trim() || pitchSaving}
                onClick={() => void pitchSaveKey()}
              >
                {pitchSaving ? "Saving…" : "Save & improve"}
              </button>
            </div>
            <p className="pitch-hint">
              Get one free at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                aistudio.google.com/apikey
              </a>{" "}
              — saved to your local <code>.env.local</code>, never leaves
              your machine.
            </p>
            {pitchMsg && <p className="pitch-msg">{pitchMsg}</p>}
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={pitchDecline}>
                {specPitch.draft
                  ? "No thanks — send exactly what I typed"
                  : "Not now"}
              </button>
            </div>
            <p className="pitch-hint">
              Without a key your text goes to the video model as-is. Change
              your mind anytime — the SPEC button next to Send reopens this.
            </p>
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
        onAbout={() => setShowAbout(true)}
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
            onClick={() => newSession()}
            disabled={Boolean(busyTurn)}
          >
            + New
          </button>
        </div>
        <div className="side-list">
          {sessions.length === 0 && (
            <p className="hint">Past sessions appear here automatically.</p>
          )}
          {[...sessions].sort(sessionOrder).map((s) => (
            <div
              key={s.id}
              className={`side-item ${s.id === sessionId ? "active" : ""}`}
              onClick={() => {
                if (renamingId !== s.id) openSession(s.id);
              }}
            >
              {renamingId === s.id ? (
                <input
                  className="side-rename"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // isComposing: Enter is confirming an IME composition
                    // (Korean names!), not submitting.
                    if (e.key === "Enter" && !e.nativeEvent.isComposing)
                      commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={commitRename}
                  aria-label="Session name"
                />
              ) : (
                <div
                  className="side-title"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(s);
                  }}
                >
                  {s.title}
                </div>
              )}
              <div className="side-sub">
                {new Date(sessionCreatedAt(s)).toLocaleString([], {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {s.turns.filter((t) => !t.kind).length} takes
              </div>
              <button
                className={`side-del side-pin ${s.pinned ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(s.id);
                }}
                title={s.pinned ? "Unpin" : "Pin to top"}
                aria-label={`${s.pinned ? "Unpin" : "Pin"} session ${s.title}`}
              >
                <PinGlyph />
              </button>
              <button
                className="side-del side-more"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId((m) => (m === s.id ? null : s.id));
                }}
                title="More"
                aria-label={`Session options for ${s.title}`}
              >
                ⋯
              </button>
              {menuId === s.id && (
                <div className="side-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="side-menu-item"
                    onClick={() => {
                      setMenuId(null);
                      startRename(s);
                    }}
                  >
                    ✎ Rename
                  </button>
                  <button
                    className="side-menu-item danger"
                    onClick={() => {
                      setMenuId(null);
                      deleteSession(s.id);
                    }}
                  >
                    ✕ Delete
                  </button>
                </div>
              )}
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
                <span className="status-line">
                  {turns.filter((t) => !t.kind).length} TAKES
                </span>
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
            {turns.map((t, i) => t.kind ? (
              <SpecCard
                key={t.id}
                turn={t}
                active={i === turns.length - 1 && !busyTurn}
                busy={i === turns.length - 1 ? specBusy : null}
                cost={fmtCost(estCostUsd ?? undefined)}
                modelShort={model.short}
                onAnswer={(a) => answerGate(t.id, a)}
                onSkip={() => skipSpec(t)}
                onGenerate={() => specGenerate(t)}
              />
            ) : (
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
                    <summary>Prompt · Take {takeNo(i)}</summary>
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
                      `TAKE ${takeNo(i)} · ${(t.modelLabel ?? PROVIDERS[t.provider].label).toUpperCase()}${fmtCost(t.costUsd) ? ` · ${fmtCost(t.costUsd)}` : ""}`}
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

          <div className="composer">
            <div className="composer-head fade">
              {turns.length === 0 && (
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
              )}
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
                {turns.length === 0 && (
                  <button
                    className={`pill-btn ${pickerOpen === "fashion" ? "on" : ""}`}
                    onClick={() =>
                      setPickerOpen((p) => (p === "fashion" ? null : "fashion"))
                    }
                    title="Dress the character in this outfit — works with any model"
                  >
                    ⑆ Fashion{selFashion ? ` · ${selFashion.label}` : ""}
                  </button>
                )}
                <button
                  className={`pill-btn ${pickerOpen === "library" ? "on" : ""}`}
                  onClick={() =>
                    setPickerOpen((p) => (p === "library" ? null : "library"))
                  }
                >
                  ▤ Library{attach ? " · attached" : ""}
                </button>
              </div>
            {pickerOpen && (
              <div className="composer-pop fade">
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
                        onClick={() => {
                          setFashionId((cur) => (cur === f.id ? null : f.id));
                          setPickerOpen(null);
                        }}
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
                        onClick={() => {
                          setFashionId((cur) => (cur === f.id ? null : f.id));
                          setPickerOpen(null);
                        }}
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
                  <span className="picker-hint">
                    {turns.length
                      ? `Adds to the next take's context — ${group.kind === "char" ? "the face" : "the scene"}. See how this model uses it below the composer.`
                      : group.hint}
                  </span>
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
                          onClick={() => {
                            group.toggle(item.id);
                            setPickerOpen(null);
                          }}
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
            </div>
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
            <div className="composer-body">
            {(attach ||
              ctxIds.length > 0 ||
              urlCandidate ||
              selChar ||
              selSetting ||
              selFashion) && (
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
                      Take {takeNo(idx)}
                      <button
                        className="link-btn danger"
                        onClick={() => toggleCtx(id)}
                        aria-label={`Unpin take ${takeNo(idx)}`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {selChar && (
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
                    ✦ {selChar.label}
                    <button
                      className="link-btn danger"
                      onClick={() => setCharId(null)}
                      aria-label="Remove character"
                    >
                      ✕
                    </button>
                  </span>
                )}
                {selSetting && (
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
                    ◫ {selSetting.label}
                    <button
                      className="link-btn danger"
                      onClick={() => setSettingId(null)}
                      aria-label="Remove background"
                    >
                      ✕
                    </button>
                  </span>
                )}
                {selFashion && (
                  <span className="sel-chip fade">
                    <img
                      src={
                        "image" in selFashion && selFashion.image
                          ? selFashion.image
                          : `/fashion/${selFashion.id}.jpg`
                      }
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    ⑆ {selFashion.label}
                    <button
                      className="link-btn danger"
                      onClick={() => setFashionId(null)}
                      aria-label="Remove fashion"
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
                    {attach.kind === "video" && (
                      <button
                        className="link-btn chip-mix"
                        onClick={() => setMixOpen(true)}
                        title={`Reference mix — ${refMixSummary(refMix)}`}
                        aria-label="Reference carry-over settings"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          aria-hidden
                        >
                          <line x1="8" y1="3.5" x2="8" y2="20.5" />
                          <line x1="16" y1="3.5" x2="16" y2="20.5" />
                          <line x1="4.5" y1="9" x2="11.5" y2="9" />
                          <line x1="12.5" y1="15" x2="19.5" y2="15" />
                        </svg>
                      </button>
                    )}
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
            {manifest.length > 0 && (
              <div className="ctx-manifest fade">
                <span className="ctx-manifest-head">Into {model.short}</span>
                {manifest.map((r, i) => (
                  <span
                    key={i}
                    className={`ctx-manifest-row ${r.ignored ? "muted" : ""}`}
                  >
                    <b>
                      {r.icon} {r.label}
                    </b>
                    <span className="ctx-manifest-arrow">→</span>
                    {r.role}
                  </span>
                ))}
              </div>
            )}
            </div>
            <div className="composer-foot">
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
                    if (canSend) sendGuarded();
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
                    : specBusy
                      ? "Spec gate is thinking…"
                    : providerId === "runway"
                      ? "Act-Two: attach a driving video (⤓ Grab or Library) + pick a face card, then send — no prompt needed"
                      : specMode
                        ? "SPEC gate on — describe the clip; unresolved spec decisions get asked before any money is spent"
                      : starterReady
                        ? "Action for the take — empty = default quiet-surprise beat"
                        : turns.length === 0
                          ? "Pick blocks above and/or describe the clip… (drop an image as reference)"
                          : "What should change in the next take?"
                }
                disabled={Boolean(busyTurn)}
              />
              <button
                className={`spec-toggle ${specMode ? "on" : ""}`}
                onClick={() => {
                  // No Gemini key ⇒ this button is the permanent "improve
                  // it" entry point: open the same pitch modal, even for
                  // users who declined it before.
                  if (keysLoaded && !keys["GEMINI_API_KEY"]) {
                    setPitchMsg("");
                    setSpecPitch({ draft: "" });
                    return;
                  }
                  setSpecMode((v) => !v);
                }}
                title={
                  keysLoaded && !keys["GEMINI_API_KEY"]
                    ? "Make clips look real — add a Gemini key to unlock the guided spec interview"
                    : specMode
                      ? "SPEC gate ON — drafts are checked against the 15-section photoreal spec and assembled before money is spent (text-first, no refine pass). Click to turn off."
                      : "Turn on the SPEC gate — interview-then-assemble instead of the quick refine loop"
                }
              >
                SPEC
              </button>
              <button className="btn-primary send-btn" onClick={sendGuarded} disabled={!canSend}>
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
          </div>
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
                <span className="timer-note">
                  {typeof Notification !== "undefined" &&
                  Notification.permission === "granted"
                    ? "Switching tabs is fine — you'll get a notification when it lands. Just don't close this tab (it tracks the render)."
                    : "Keep this tab open — it tracks the render."}
                </span>
              </>
            ) : previewTurn?.videoUrl &&
              deadPreview === `${previewTurn.id}:${previewTurn.videoUrl}` ? (
              <div className="frame-fault fade">
                <span className="label">Video unavailable</span>
                <p>
                  This take&apos;s video is gone — either the provider&apos;s
                  signed link expired before it was saved locally, or saved
                  videos were cleared from this machine. New takes are saved
                  into .zclip-data automatically.
                </p>
              </div>
            ) : previewTurn?.videoUrl ? (
              <video
                key={`${previewTurn.id}:${previewTurn.videoUrl}`}
                className="fade"
                src={withPw(previewTurn.videoUrl)}
                autoPlay
                muted
                loop
                playsInline
                controls
                onError={() =>
                  setDeadPreview(`${previewTurn.id}:${previewTurn.videoUrl}`)
                }
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

          {previewTurn?.status === "done" &&
            previewTurn.videoUrl &&
            deadPreview !== `${previewTurn.id}:${previewTurn.videoUrl}` && (
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
                  title={
                    model.key === "seedance-2"
                      ? "Continuity: normally auto-attaches a frame from the last take so the next one continues the scene — but Seedance 2.0 rejects real-person image inputs, so it's skipped for this model. For continuity on 2.0, attach the last take from the Library as a video reference instead."
                      : "Continuity: after a take finishes, a mid-video frame is captured and auto-attached to the next take as its image reference, so the scene and person carry over. A manual attachment always wins over it."
                  }
                  value={continuity ? "on" : "off"}
                  onChange={(e) => setContinuity(e.target.value === "on")}
                >
                  <option value="on">
                    {model.key === "seedance-2" ? "CONT N/A" : "CONT ON"}
                  </option>
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

            {/* Seedance 2.0 + video reference needs a public URL host — teach
                the one extra credential inline, same UX as provider keys. */}
            {model.key === "seedance-2" &&
              attach?.kind === "video" &&
              Boolean(attach.videoBase64) &&
              keysLoaded &&
              !keys.BLOB_READ_WRITE_TOKEN &&
              !blobPanelHidden && (
                <div className="stub-note key-popover fade">
                  <button
                    className="side-del key-popover-close"
                    onClick={() => setBlobPanelHidden(true)}
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                  <span className="label">
                    Seedance 2.0 · one more thing for video references
                  </span>
                  <p className="key-hint">
                    ByteDance fetches your reference video by URL — it can&apos;t
                    reach this machine. ZCLIP parks the clip on YOUR free Vercel
                    Blob store just for the job, then deletes it.
                  </p>
                  {keysWritable ? (
                    <>
                      <div className="key-row">
                        <input
                          type="password"
                          value={blobInput}
                          onChange={(e) => setBlobInput(e.target.value)}
                          placeholder="Paste BLOB_READ_WRITE_TOKEN"
                          aria-label="BLOB_READ_WRITE_TOKEN"
                          onKeyDown={(e) => e.key === "Enter" && saveBlobToken()}
                        />
                        <button
                          className="btn-ghost"
                          onClick={saveBlobToken}
                          disabled={blobSaving || !blobInput.trim()}
                        >
                          {blobSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                      <p className="key-hint">
                        Free Vercel account → Storage → Create Blob store →
                        copy the token ·{" "}
                        <a
                          href="https://vercel.com/docs/vercel-blob"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Guide ↗
                        </a>
                      </p>
                    </>
                  ) : (
                    <p className="key-hint">
                      Set <code>BLOB_READ_WRITE_TOKEN</code> in your environment ·{" "}
                      <a
                        href="https://vercel.com/docs/vercel-blob"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Guide ↗
                      </a>
                    </p>
                  )}
                  {blobMsg && <p className="key-msg">{blobMsg}</p>}
                </div>
              )}
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
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {mixOpen && (
        <div className="confirm-backdrop" onClick={() => setMixOpen(false)}>
          <div
            className="confirm-card mix-card"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="label">Reference mix — what carries over?</span>
            <p className="mix-lead">
              The next take copies the checked parts of the attached reference
              and is explicitly told to drop the rest. Your choices are saved
              as the default for future references — reopen anytime from the
              chip&apos;s mixer icon.
            </p>
            {REF_MIX_FIELDS.map((f) => (
              <label key={f.key} className="confirm-check mix-opt">
                <input
                  type="checkbox"
                  checked={refMix[f.key]}
                  onChange={(e) =>
                    saveRefMix({ ...refMix, [f.key]: e.target.checked })
                  }
                />
                <span>
                  {f.label}
                  <em>{f.desc}</em>
                </span>
              </label>
            ))}
            <div className="confirm-actions">
              <button
                className="btn-ghost"
                onClick={() => {
                  saveRefMix({
                    motion: true,
                    camera: true,
                    background: true,
                    look: true,
                    text: true,
                    audio: true,
                  });
                  setMixOpen(false);
                }}
              >
                Take everything
              </button>
              <button className="btn-primary" onClick={() => setMixOpen(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Video Prompt Spec Gate cards ─────────────────────────────────────
 * One gate question (quick-reply chips + free text) or the assembled-spec
 * preview (prompt + mechanical self-checks + explicit Generate). Rendered
 * inside the thread; `active` = it is the last turn, so chips/buttons on
 * superseded cards go inert instead of mutating a finished flow. */
function SpecCard({
  turn,
  active,
  busy,
  cost,
  modelShort,
  onAnswer,
  onSkip,
  onGenerate,
}: {
  turn: Turn;
  active: boolean;
  busy: "check" | "assemble" | null;
  cost: string | null;
  modelShort: string;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onGenerate: () => void;
}) {
  const [free, setFree] = useState("");
  const checks =
    turn.kind === "preview" && turn.prompt
      ? runSelfChecks(turn.prompt, turn.durationSeconds)
      : [];
  const failed = checks.filter((c) => !c.pass).length;
  const open = turn.kind === "gate" ? !turn.gateAnswer : true;
  return (
    <div className={`turn spec-card ${active || !open ? "" : "inert"}`}>
      {turn.userText && <div className="turn-user">{turn.userText}</div>}
      {turn.specWarnings?.map((w) => (
        <div key={w} className="spec-warn">⚠ {w}</div>
      ))}
      {turn.kind === "gate" ? (
        <>
          <div className="spec-head">
            SPEC GATE · {turn.gateId?.replace(/-/g, " ").toUpperCase()}
          </div>
          <div className="spec-q">{turn.gateQ}</div>
          {turn.gateWhy && <div className="spec-why">{turn.gateWhy}</div>}
          {turn.gateAnswer ? (
            <div className="spec-answer">→ {turn.gateAnswer}</div>
          ) : active ? (
            <>
              {!!turn.gateOpts?.length && (
                <div className="spec-chips">
                  {turn.gateOpts.map((o) => (
                    <button
                      key={o}
                      className="spec-chip"
                      disabled={Boolean(busy)}
                      onClick={() => onAnswer(o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <div className="spec-free">
                <input
                  value={free}
                  onChange={(e) => setFree(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing &&
                      free.trim() &&
                      !busy
                    ) {
                      onAnswer(free.trim());
                      setFree("");
                    }
                  }}
                  placeholder="Or type your own answer…"
                  disabled={Boolean(busy)}
                />
                <button
                  className="link-btn"
                  disabled={!free.trim() || Boolean(busy)}
                  onClick={() => {
                    onAnswer(free.trim());
                    setFree("");
                  }}
                >
                  OK
                </button>
              </div>
            </>
          ) : (
            <div className="spec-why">superseded — continue below</div>
          )}
          {turn.specNote && (
            <div className="spec-why">defaults: {turn.specNote}</div>
          )}
        </>
      ) : (
        <>
          <div className="spec-head">
            SPEC PREVIEW · v{SPEC_VERSION} · {turn.prompt?.length ?? 0} CHARS
          </div>
          {turn.specNote && (
            <div className="spec-why">defaults: {turn.specNote}</div>
          )}
          <details className="turn-prompt spec-prompt" open>
            <summary>Assembled spec prompt (submitted verbatim)</summary>
            <p>{turn.prompt}</p>
          </details>
          {checks.length > 0 && (
            <ul className="spec-checks">
              {checks.map((c) => (
                <li key={c.label} className={c.pass ? "pass" : "fail"}>
                  {c.pass ? "✓" : "!"} {c.label}
                  {c.detail && <span className="spec-detail"> — {c.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {active && (
            <div className="spec-actions">
              <button
                className="btn-primary"
                disabled={Boolean(busy)}
                onClick={onGenerate}
              >
                Generate — {modelShort}
                {cost ? ` · ~${cost}` : ""}
              </button>
              {failed > 0 && (
                <span className="spec-why">
                  {failed} self-check{failed > 1 ? "s" : ""} unhappy — you can
                  still generate
                </span>
              )}
            </div>
          )}
        </>
      )}
      {active && open && (
        <button
          className="link-btn spec-skip"
          disabled={Boolean(busy)}
          onClick={onSkip}
          title="Escape hatch — send your original text to the model exactly as typed, no spec"
        >
          skip checks, run as typed →
        </button>
      )}
      {busy && (
        <div className="spec-busy">
          <span className="dot live" />{" "}
          {busy === "check" ? "CHECKING SPEC…" : "ASSEMBLING SPEC PROMPT…"}
        </div>
      )}
    </div>
  );
}
