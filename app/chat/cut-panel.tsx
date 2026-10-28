"use client";

/* CUT — the second session KIND: script → voice → scenes → one finished,
 * postable vertical video, assembled fully in the browser.
 * Design SSOT: docs/CUT-FLOW.md. Pipeline shape is MPT's, kept verbatim
 * (owner call 2026-08-02): the voiceover is synthesized BEFORE casting, so
 * scene durations are known while you pick footage, and the voiceover owns
 * the assembly timeline.
 *
 * Step order: 1 SCRIPT (write/generate) → 2 VOICE (keyless Edge TTS per
 * scene) → 3 SCENES (browser-direct Pexels stock per scene) → 4 CUT
 * (lib/cut-compose WebCodecs assembly → download / Library vault).
 *
 * Drafts live in PLAIN localStorage (hooklab.cutdraft:<sessionId>) — never
 * the file store; only the studio tab may write lib/store. Audio and search
 * results are NOT persisted (quota) — they regenerate free.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  keyHeader,
  getLocalKey,
  setLocalKey,
  localKeyFlags,
} from "@/lib/client-keys";
import * as store from "@/lib/store";
import { PW_KEY } from "@/lib/clip";
import { searchPexels, type StockClip } from "@/lib/stock";
import { composeCut, type ComposeProgress } from "@/lib/cut-compose";
import { useHosted } from "@/lib/use-version";

const draftKey = (sessionId: string) => `hooklab.cutdraft:${sessionId}`;

/** The parked draft for a session ("" when none). Safe on the server. Raw
 *  string on purpose — studio's hasCutWork() only asks "is there work". */
export function cutDraft(sessionId: string): string {
  if (typeof window === "undefined" || !sessionId) return "";
  try {
    return window.localStorage.getItem(draftKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

const STEPS = ["SCRIPT", "VOICE", "SCENES", "CUT"] as const;

/** Script-writer models — one entry per model the user COULD hold a key
 *  for; the UI shows only the ones whose key is actually present (env or
 *  hosted browser key). Server whitelists again. Gemini = default. */
const SCRIPT_MODELS = [
  { id: "gemini-2.5-flash", envVar: "GEMINI_API_KEY", label: "Gemini 2.5 Flash — fast · ~free" },
  { id: "gemini-2.5-pro", envVar: "GEMINI_API_KEY", label: "Gemini 2.5 Pro — best writing" },
  { id: "gemini-2.5-flash-lite", envVar: "GEMINI_API_KEY", label: "Gemini 2.5 Flash-Lite — cheapest" },
  { id: "gpt-5.1", envVar: "OPENAI_API_KEY", label: "GPT-5.1 — via your Sora/OpenAI key" },
  { id: "gpt-5-mini", envVar: "OPENAI_API_KEY", label: "GPT-5 mini — cheap · OpenAI key" },
  { id: "grok-4-fast-non-reasoning", envVar: "XAI_API_KEY", label: "Grok 4 Fast — via your Grok key" },
  { id: "claude-opus-5", envVar: "ANTHROPIC_API_KEY", label: "Claude Opus 5 — via your Anthropic key" },
  { id: "claude-sonnet-5", envVar: "ANTHROPIC_API_KEY", label: "Claude Sonnet 5 — Anthropic key" },
  { id: "claude-haiku-4-5", envVar: "ANTHROPIC_API_KEY", label: "Claude Haiku 4.5 — cheap · Anthropic key" },
];

const VOICES = [
  { id: "en-US-AriaNeural", label: "Aria — EN · female" },
  { id: "en-US-GuyNeural", label: "Guy — EN · male" },
  { id: "ko-KR-SunHiNeural", label: "SunHi — KO · female" },
  { id: "ko-KR-InJoonNeural", label: "InJoon — KO · male" },
  { id: "ja-JP-NanamiNeural", label: "Nanami — JA · female" },
];

interface CutScene {
  text: string;
  terms: string[];
  query: string;
  picked?: StockClip;
  results?: StockClip[];
  audioB64?: string;
  audioSec?: number;
  err?: string;
}

interface CutDraftV2 {
  v: 2;
  step: number;
  topic: string;
  script: string;
  voice: string;
  scriptModel?: string;
  scenes: Pick<CutScene, "text" | "terms" | "query" | "picked">[];
}

function loadDraft(sessionId: string): CutDraftV2 {
  const raw = cutDraft(sessionId);
  const empty: CutDraftV2 = {
    v: 2,
    step: 0,
    topic: "",
    script: "",
    voice: VOICES[0].id,
    scenes: [],
  };
  if (!raw) return empty;
  try {
    const p = JSON.parse(raw) as CutDraftV2;
    if (p?.v === 2) return { ...empty, ...p };
  } catch {
    /* increment-1 drafts were plain script text — adopt as the script */
    return { ...empty, script: raw };
  }
  return empty;
}

const splitScenes = (script: string): string[] =>
  script
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const b64ToArrayBuffer = async (b64: string): Promise<ArrayBuffer> =>
  (await fetch(`data:audio/mpeg;base64,${b64}`)).arrayBuffer();

const audioDuration = (b64: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const a = new Audio(`data:audio/mpeg;base64,${b64}`);
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("voiceover audio failed to decode"));
  });

export function CutPanel({
  sessionId,
  onCutDone,
}: {
  sessionId: string;
  onCutDone?: (c: { videoUrl: string; seconds: number; prompt: string }) => void;
}) {
  const hosted = useHosted();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [scriptModel, setScriptModel] = useState(SCRIPT_MODELS[0].id);
  /** Which key env vars are usable — env flags (local) ∪ browser keys
   *  (hosted BYOK). Filters the script-model picker to real options. */
  const [keyFlags, setKeyFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const local = localKeyFlags();
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d: { keys?: Record<string, boolean> }) => {
        const merged: Record<string, boolean> = { ...(d.keys ?? {}) };
        for (const [k, v] of Object.entries(local)) merged[k] = merged[k] || v;
        setKeyFlags(merged);
      })
      .catch(() => setKeyFlags(local));
  }, []);
  const modelOptions = SCRIPT_MODELS.filter(
    (m, i) => i === 0 || keyFlags[m.envVar],
  );
  const modelEnvVar = (id: string) =>
    SCRIPT_MODELS.find((m) => m.id === id)?.envVar ?? "GEMINI_API_KEY";
  const [scenes, setScenes] = useState<CutScene[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsSaved, setPexelsSaved] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [cutSec, setCutSec] = useState(0);
  const [vaulted, setVaulted] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  /** Guards the draft against mount-time deletion: the persist effect fires
   *  with INITIAL (empty) state before the load effect's setStates apply —
   *  and StrictMode double-runs effects — so an unconditional "empty ⇒
   *  removeItem" eats the draft on every open. Only a USER edit may empty
   *  the parked draft. (Live-caught 2026-08-02.) */
  const dirty = useRef(false);

  const hdrs = useCallback(
    (envVar?: string | null): Record<string, string> => {
      const pw = store.get(PW_KEY);
      return keyHeader(envVar, {
        "content-type": "application/json",
        ...(pw ? { "x-app-password": pw } : {}),
      });
    },
    [],
  );

  /* per-session draft load / persist (audio & results never persisted) */
  useEffect(() => {
    const d = loadDraft(sessionId);
    dirty.current = false;
    setStep(d.step);
    setTopic(d.topic);
    setScript(d.script);
    setVoice(d.voice);
    setScriptModel(d.scriptModel ?? SCRIPT_MODELS[0].id);
    setScenes(d.scenes.map((s) => ({ ...s })));
    setCutUrl(null);
    setVaulted(null);
    setError(null);
    setPexelsSaved(Boolean(getLocalKey("PEXELS_API_KEY")));
  }, [sessionId]);
  useEffect(() => {
    try {
      const hasWork =
        script.trim() || topic.trim() || scenes.some((s) => s.picked);
      if (!hasWork) {
        if (dirty.current) window.localStorage.removeItem(draftKey(sessionId));
        return;
      }
      const d: CutDraftV2 = {
        v: 2,
        step,
        topic,
        script,
        voice,
        scriptModel,
        scenes: scenes.map(({ text, terms, query, picked }) => ({
          text,
          terms,
          query,
          picked,
        })),
      };
      window.localStorage.setItem(draftKey(sessionId), JSON.stringify(d));
    } catch {
      /* quota — in-memory state still holds it */
    }
  }, [step, topic, script, voice, scenes, sessionId]);

  /* ── SCRIPT ── */
  const genScript = async () => {
    if (busy) return;
    // Never a silent no-op: an empty topic says so instead of doing nothing
    // (a disabled button reads as "broken" — live feedback 2026-08-03).
    if (!topic.trim()) {
      setError("Enter a topic first — or skip Generate and write the script below.");
      return;
    }
    setBusy(`Writing the script… (${scriptModel})`);
    setError(null);
    try {
      const r = await fetch("/api/cut-script", {
        method: "POST",
        headers: hdrs(modelEnvVar(scriptModel)),
        body: JSON.stringify({ topic: topic.trim(), model: scriptModel }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `script error ${r.status}`);
      const sc = (data.scenes as { text: string; terms: string[] }[]) ?? [];
      setScript(sc.map((s) => s.text).join("\n\n"));
      setScenes(
        sc.map((s) => ({
          text: s.text,
          terms: s.terms,
          query: s.terms.join(" "),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "script generation failed");
    } finally {
      setBusy(null);
    }
  };

  const toVoiceStep = () => {
    const paras = splitScenes(script);
    if (!paras.length) return;
    setScenes((prev) =>
      paras.map((text) => {
        const keep = prev.find((s) => s.text === text);
        return keep ?? { text, terms: [], query: "" };
      }),
    );
    setStep(1);
    // Best-effort terms for manually written scripts — failure just means
    // the SCENES search boxes start empty (fully keyless path stays alive).
    if (paras.some((t) => !scenes.find((s) => s.text === t)?.query)) {
      fetch("/api/cut-script", {
        method: "POST",
        headers: hdrs(modelEnvVar(scriptModel)),
        body: JSON.stringify({ script: paras.join("\n\n"), model: scriptModel }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const sc = (data?.scenes as { text: string; terms: string[] }[]) ?? [];
          if (!sc.length) return;
          setScenes((prev) =>
            prev.map((s, i) =>
              s.query
                ? s
                : {
                    ...s,
                    terms: sc[i]?.terms ?? [],
                    query: (sc[i]?.terms ?? []).join(" "),
                  },
            ),
          );
        })
        .catch(() => undefined);
    }
  };

  /* ── VOICE ── */
  const synthesize = async () => {
    if (busy) return;
    setError(null);
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].audioB64) continue;
      setBusy(`Voicing scene ${i + 1}/${scenes.length}…`);
      try {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: hdrs(),
          body: JSON.stringify({ text: scenes[i].text, voice }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `TTS error ${r.status}`);
        const sec = await audioDuration(data.audioB64);
        setScenes((prev) =>
          prev.map((s, j) =>
            j === i ? { ...s, audioB64: data.audioB64, audioSec: sec } : s,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "TTS failed");
        setBusy(null);
        return;
      }
    }
    setBusy(null);
  };

  const playPreview = (b64: string) => {
    previewRef.current?.pause();
    const a = new Audio(`data:audio/mpeg;base64,${b64}`);
    previewRef.current = a;
    void a.play();
  };

  const allVoiced = scenes.length > 0 && scenes.every((s) => s.audioB64);
  const totalSec = scenes.reduce((n, s) => n + (s.audioSec ?? 0), 0);

  /* ── SCENES ── */
  const savePexels = () => {
    const k = pexelsKey.trim();
    if (!k) return;
    setLocalKey("PEXELS_API_KEY", k);
    setPexelsKey("");
    setPexelsSaved(true);
  };

  const runSearch = async (i: number) => {
    const key = getLocalKey("PEXELS_API_KEY");
    if (!key) return;
    const q = scenes[i].query.trim();
    if (!q) return;
    setScenes((prev) =>
      prev.map((s, j) => (j === i ? { ...s, err: undefined } : s)),
    );
    try {
      const results = await searchPexels(q, key);
      setScenes((prev) =>
        prev.map((s, j) =>
          j === i
            ? { ...s, results, err: results.length ? undefined : "no results — try broader words" }
            : s,
        ),
      );
    } catch (e) {
      setScenes((prev) =>
        prev.map((s, j) =>
          j === i
            ? { ...s, err: e instanceof Error ? e.message : "search failed" }
            : s,
        ),
      );
    }
  };

  const allCast = scenes.length > 0 && scenes.every((s) => s.picked);

  /* ── CUT ── */
  const assemble = async () => {
    if (busy || !allCast || !allVoiced) return;
    setError(null);
    setCutUrl(null);
    setVaulted(null);
    try {
      const parts = [];
      for (let i = 0; i < scenes.length; i++) {
        setBusy(`Fetching scene ${i + 1}/${scenes.length} footage…`);
        const r = await fetch(scenes[i].picked!.url);
        if (!r.ok) throw new Error(`scene ${i + 1} footage fetch failed (${r.status})`);
        parts.push({
          videoBlob: await r.blob(),
          text: scenes[i].text,
          audioData: await b64ToArrayBuffer(scenes[i].audioB64!),
        });
      }
      const onProgress = (p: ComposeProgress) =>
        setBusy(`${p.note} · ${p.pct}%`);
      const { blob, durationSec } = await composeCut(parts, {
        captions,
        onProgress,
      });
      setCutUrl(URL.createObjectURL(blob));
      setCutSec(durationSec);
    } catch (e) {
      setError(e instanceof Error ? e.message : "assembly failed");
    } finally {
      setBusy(null);
    }
  };

  const vault = async () => {
    if (!cutUrl || busy) return;
    setBusy("Saving to the Library…");
    setError(null);
    try {
      const blob = await (await fetch(cutUrl)).blob();
      const fd = new FormData();
      fd.append("file", new File([blob], "cut.mp4", { type: "video/mp4" }));
      const pw = store.get(PW_KEY);
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: pw ? { "x-app-password": pw } : {},
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `vault error ${r.status}`);
      setVaulted(data.url);
      onCutDone?.({
        videoUrl: data.url,
        seconds: cutSec,
        prompt: script,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "vault failed");
    } finally {
      setBusy(null);
    }
  };

  /* Steps are jumpable backwards; forward only through the gates. */
  const canEnter = (i: number) =>
    i === 0 ||
    (i === 1 && splitScenes(script).length > 0) ||
    (i === 2 && allVoiced) ||
    (i === 3 && allVoiced && allCast);

  return (
    <div className="cut-panel fade">
      <div className="cut-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`cut-step ${i === step ? "on" : ""}`}
            disabled={!canEnter(i)}
            onClick={() => canEnter(i) && setStep(i)}
          >
            {i + 1} · {s}
          </button>
        ))}
        {totalSec > 0 && (
          <span className="cut-total">≈{totalSec.toFixed(1)}s</span>
        )}
      </div>

      {error && <div className="cut-error">{error}</div>}
      {busy && <div className="cut-busy">{busy}</div>}

      {step === 0 && (
        <>
          <div className="cut-topic-row">
            <input
              className="cut-input"
              placeholder="Topic — e.g. why cold showers work"
              value={topic}
              onChange={(e) => {
                dirty.current = true;
                setTopic(e.target.value);
              }}
            />
          </div>
          <div className="cut-model-row">
            <span className="cut-model-label">script model</span>
            <select
              className="cut-input cut-select cut-model-select"
              value={scriptModel}
              onChange={(e) => {
                dirty.current = true;
                setScriptModel(e.target.value);
              }}
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="cut-model-note">
              rides your GEMINI key · voice = Edge TTS (free) · assembly = this
              browser
            </span>
          </div>
          <label className="label" htmlFor="cut-script">
            Script
          </label>
          <textarea
            id="cut-script"
            className="cut-script"
            placeholder={
              "Write or paste the narration script — or generate one from the topic above.\n" +
              "One paragraph (blank line between) = one scene."
            }
            value={script}
            onChange={(e) => {
              dirty.current = true;
              setScript(e.target.value);
            }}
            rows={10}
          />
          <div className="cut-foot">
            {/* pipeline theory stays in the docs — the footer only says
                something when there's something to say (owner, 2026-08-03) */}
            {splitScenes(script).length > 0 && (
              <span className="cut-note">
                {splitScenes(script).length} scenes — next: the voiceover (its
                length sets each scene&apos;s duration).
              </span>
            )}
            {/* Generate lives DOWN HERE with the other actions — beside the
                topic input it read as "generate a topic" (owner, 2026-08-03) */}
            <button
              className="btn-ghost"
              onClick={genScript}
              disabled={Boolean(busy)}
            >
              ✨ Generate script
            </button>
            <button
              className="btn-ghost"
              disabled={!splitScenes(script).length}
              onClick={toVoiceStep}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="cut-topic-row">
            <select
              className="cut-input cut-select"
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value);
                // a different voice = different timing — re-synthesize
                setScenes((prev) =>
                  prev.map((s) => ({ ...s, audioB64: undefined, audioSec: undefined })),
                );
              }}
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={synthesize} disabled={Boolean(busy) || allVoiced}>
              ⚡ Synthesize
            </button>
          </div>
          <div className="cut-scene-list">
            {scenes.map((s, i) => (
              <div key={i} className="cut-scene">
                <div className="cut-scene-head">
                  <span className="cut-scene-n">SCENE {i + 1}</span>
                  {s.audioSec != null && (
                    <span className="cut-dur">{s.audioSec.toFixed(1)}s</span>
                  )}
                  {s.audioB64 && (
                    <button
                      className="btn-ghost cut-mini"
                      onClick={() => playPreview(s.audioB64!)}
                    >
                      ▸ play
                    </button>
                  )}
                </div>
                <p className="cut-scene-text">{s.text}</p>
              </div>
            ))}
          </div>
          <div className="cut-foot">
            <span className="cut-note">
              Keyless Edge TTS (free). Voiceover length = each scene's exact
              duration — footage is cast against it next.
            </span>
            <button className="btn-ghost" disabled={!allVoiced} onClick={() => setStep(2)}>
              Next →
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {!pexelsSaved && (
            <div className="cut-topic-row">
              <input
                className="cut-input"
                placeholder="Pexels API key — free at pexels.com/api"
                value={pexelsKey}
                onChange={(e) => setPexelsKey(e.target.value)}
              />
              <button className="btn-ghost" onClick={savePexels} disabled={!pexelsKey.trim()}>
                Save
              </button>
              <a
                className="cut-keylink"
                href="https://www.pexels.com/api/"
                target="_blank"
                rel="noreferrer"
              >
                get one ↗
              </a>
            </div>
          )}
          <div className="cut-scene-list">
            {scenes.map((s, i) => (
              <div key={i} className="cut-scene">
                <div className="cut-scene-head">
                  <span className="cut-scene-n">SCENE {i + 1}</span>
                  {s.audioSec != null && (
                    <span className="cut-dur">needs {s.audioSec.toFixed(1)}s</span>
                  )}
                  {s.picked && <span className="cut-picked">✓ cast</span>}
                </div>
                <p className="cut-scene-text">{s.text}</p>
                <div className="cut-search-row">
                  <input
                    className="cut-input"
                    placeholder="stock search — e.g. city sunrise timelapse"
                    value={s.query}
                    onChange={(e) =>
                      setScenes((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) runSearch(i);
                    }}
                  />
                  <button
                    className="btn-ghost"
                    onClick={() => runSearch(i)}
                    disabled={!pexelsSaved || !s.query.trim()}
                  >
                    Search
                  </button>
                </div>
                {s.err && <div className="cut-error">{s.err}</div>}
                {Boolean(s.results?.length) && (
                  <div className="cut-results">
                    {s.results!.map((r) => (
                      <button
                        key={r.id}
                        className={`cut-result ${s.picked?.id === r.id ? "on" : ""}`}
                        title={`${r.durationSec}s · by ${r.photographer}`}
                        onClick={() =>
                          setScenes((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, picked: x.picked?.id === r.id ? undefined : r }
                                : x,
                            ),
                          )
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.thumb} alt="" loading="lazy" />
                        <span>{r.durationSec}s</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="cut-foot">
            <span className="cut-note">
              Pexels searches run straight from this browser — free key, never
              our server. Shorter footage loops to fill the scene.
            </span>
            <button className="btn-ghost" disabled={!allCast} onClick={() => setStep(3)}>
              Next →
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="cut-summary">
            {scenes.length} scenes · ≈{totalSec.toFixed(1)}s · 720×1280 · 30fps
            <label className="cut-cap-toggle">
              <input
                type="checkbox"
                checked={captions}
                onChange={(e) => setCaptions(e.target.checked)}
              />
              burn captions
            </label>
          </div>
          {!cutUrl && (
            <button className="btn-ghost cut-assemble" onClick={assemble} disabled={Boolean(busy)}>
              ⧗ Assemble the cut
            </button>
          )}
          {cutUrl && (
            <>
              <video className="cut-preview" src={cutUrl} controls playsInline />
              <div className="cut-foot">
                <a className="btn-ghost" href={cutUrl} download="cut.mp4">
                  ⬇ Download
                </a>
                {!hosted && !vaulted && (
                  <button className="btn-ghost" onClick={vault} disabled={Boolean(busy)}>
                    ▣ Save to Library
                  </button>
                )}
                {vaulted && <span className="cut-note">Saved to the Library ✓</span>}
                {hosted && (
                  <span className="cut-note">
                    Hosted can't vault files — download your cut (a local
                    install keeps cuts in the Library).
                  </span>
                )}
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setCutUrl(null);
                    setVaulted(null);
                  }}
                >
                  ↻ Re-assemble
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
