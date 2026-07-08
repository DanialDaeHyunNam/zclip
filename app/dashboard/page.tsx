"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PROVIDERS,
  MODELS,
  DEFAULT_MODEL_KEY,
  modelPriceLabel,
  DEFAULTS,
  REFINER_MODEL_ID,
  DURATION_CHOICES,
  type ProviderName,
} from "@/lib/config";
import { Rail } from "../rail";

/**
 * Read-only spend & config dashboard. Everything comes from the same
 * localStorage the studio writes (the archive is the ledger), so this
 * page needs no server round-trips except the key-presence booleans.
 */

interface LedgerClip {
  jobId: string;
  sessionId?: string;
  provider: ProviderName | "grab";
  createdAt: number;
  durationSeconds: number;
  costUsd?: number;
}

interface LedgerSession {
  id: string;
  title: string;
}

const DAY_MS = 86_400_000;
const DAYS_SHOWN = 14;

const load = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
};

export default function Dashboard() {
  const [clips, setClips] = useState<LedgerClip[]>([]);
  const [sessions, setSessions] = useState<LedgerSession[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [storageBytes, setStorageBytes] = useState(0);
  // Provider filter — the chart + breakdowns show only this model when set.
  const [filter, setFilter] = useState<ProviderName | null>(null);

  useEffect(() => {
    setClips(load<LedgerClip[]>("hooklab.gallery", []));
    setSessions(load<LedgerSession[]>("hooklab.sessions", []));
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("hooklab.")) {
        bytes += (localStorage.getItem(k)?.length ?? 0) * 2; // UTF-16
      }
    }
    setStorageBytes(bytes);
    const pw = localStorage.getItem("hooklab.pw") ?? "";
    fetch("/api/keys", { headers: pw ? { "x-app-password": pw } : {} })
      .then((r) => r.json())
      .then((b) => setKeys(b.keys ?? b))
      .catch(() => {});
  }, []);

  const takes = useMemo(() => clips.filter((c) => c.provider !== "grab"), [clips]);
  const grabs = clips.length - takes.length;
  const priced = takes.filter((c) => c.costUsd != null);
  const unpriced = takes.length - priced.length;
  const total = priced.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const seconds = takes.reduce((s, c) => s + (c.durationSeconds || 0), 0);

  const providers = (Object.keys(PROVIDERS) as ProviderName[]).filter((p) =>
    takes.some((c) => c.provider === p),
  );

  // The filtered set the charts/breakdowns read (chips select a provider).
  const view = useMemo(
    () => (filter ? takes.filter((c) => c.provider === filter) : takes),
    [takes, filter],
  );

  /* by day — last 14 days, stacked by provider */
  const byDay = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const start = today.getTime() - (DAYS_SHOWN - 1 - i) * DAY_MS;
      return { start, parts: new Map<ProviderName, number>(), total: 0 };
    });
    for (const c of view) {
      if (c.costUsd == null) continue;
      const idx = Math.floor((c.createdAt - days[0].start) / DAY_MS);
      if (idx < 0 || idx >= DAYS_SHOWN) continue;
      const d = days[idx];
      d.total += c.costUsd;
      d.parts.set(
        c.provider as ProviderName,
        (d.parts.get(c.provider as ProviderName) ?? 0) + c.costUsd,
      );
    }
    return days;
  }, [view]);
  const dayMax = Math.max(...byDay.map((d) => d.total), 0.01);

  /* by session */
  const bySession = useMemo(() => {
    const m = new Map<
      string,
      { label: string; total: number; count: number; latest: number; parts: Map<ProviderName, number> }
    >();
    for (const c of view) {
      const key = c.sessionId ?? "earlier";
      let g = m.get(key);
      if (!g) {
        g = {
          label:
            sessions.find((s) => s.id === key)?.title ??
            (key === "earlier" ? "Earlier takes" : "Removed session"),
          total: 0,
          count: 0,
          latest: 0,
          parts: new Map(),
        };
        m.set(key, g);
      }
      g.count += 1;
      g.latest = Math.max(g.latest, c.createdAt);
      if (c.costUsd != null) {
        g.total += c.costUsd;
        g.parts.set(
          c.provider as ProviderName,
          (g.parts.get(c.provider as ProviderName) ?? 0) + c.costUsd,
        );
      }
    }
    return [...m.values()].sort((a, b) => b.latest - a.latest);
  }, [view, sessions]);
  const sessionMax = Math.max(...bySession.map((s) => s.total), 0.01);

  /* by model */
  const byModel = (filter ? providers.filter((p) => p === filter) : providers).map((p) => {
    const list = view.filter((c) => c.provider === p);
    return {
      p,
      count: list.length,
      seconds: list.reduce((s, c) => s + (c.durationSeconds || 0), 0),
      total: list.reduce((s, c) => s + (c.costUsd ?? 0), 0),
    };
  });
  const modelMax = Math.max(...byModel.map((m) => m.total), 0.01);

  const fmtDay = (t: number) =>
    new Date(t).toLocaleDateString([], { month: "numeric", day: "numeric" });

  const go = (q: string) => {
    window.location.href = `/chat${q}`;
  };

  return (
    <>
      <Rail
        active="dashboard"
        onHome={() => go("?new=1")}
        onDashboard={() => {}}
        onSessions={() => go("?open=sessions")}
        onArchive={() => {
          window.location.href = "/archive";
        }}
        onGrab={() => {
          window.location.href = "/archive?add=1";
        }}
      />
      <div className="dash-page">
        <header className="top">
          <a className="wordmark" href="/chat" title="Back to the studio">
            ZCLIP<span>_</span>
          </a>
          <span className="label">Dashboard</span>
        </header>

      {/* headline stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-num">
            ${total.toFixed(2)}
            {unpriced > 0 && <em> +{unpriced}?</em>}
          </span>
          <span className="label">All-time spend (est.)</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">{takes.length}</span>
          <span className="label">Takes</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">{seconds}s</span>
          <span className="label">Video rendered</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">
            ${takes.length ? (total / takes.length).toFixed(2) : "0.00"}
          </span>
          <span className="label">Avg / take</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">{grabs}</span>
          <span className="label">References grabbed</span>
        </div>
      </div>

      <div className="dash-filters">
        <button
          className={`dash-chip ${filter === null ? "on" : ""}`}
          onClick={() => setFilter(null)}
        >
          All models
        </button>
        {providers.map((p) => (
          <button
            key={p}
            className={`dash-chip ${filter === p ? "on" : ""}`}
            onClick={() => setFilter((f) => (f === p ? null : p))}
          >
            <i style={{ background: PROVIDERS[p].chartColor }} />
            {PROVIDERS[p].label}
          </button>
        ))}
      </div>

      {/* by period */}
      <section className="dash-section">
        <span className="label">Spend · Last {DAYS_SHOWN} days</span>
        <div className="dash-cols">
          {byDay.map((d) => (
            <div className="dash-col" key={d.start}>
              <div className="dash-col-bar" title={`$${d.total.toFixed(2)}`}>
                {providers.map((p) => {
                  const v = d.parts.get(p);
                  if (!v) return null;
                  return (
                    <i
                      key={p}
                      style={{
                        height: `${(v / dayMax) * 100}%`,
                        background: PROVIDERS[p].chartColor,
                      }}
                      title={`${PROVIDERS[p].label} · $${v.toFixed(2)}`}
                    />
                  );
                })}
              </div>
              <span className="dash-col-label">{fmtDay(d.start)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* by session */}
      <section className="dash-section">
        <span className="label">Spend · By session</span>
        {bySession.length === 0 && <p className="hint">No takes yet.</p>}
        <div className="spend-rows">
          {bySession.map((r) => (
            <div className="spend-row" key={r.label + r.latest}>
              <span className="spend-label" title={r.label}>
                {r.label}
              </span>
              <div className="spend-bar">
                {providers.map((p) => {
                  const v = r.parts.get(p);
                  if (!v) return null;
                  return (
                    <i
                      key={p}
                      style={{
                        width: `${(v / sessionMax) * 100}%`,
                        background: PROVIDERS[p].chartColor,
                      }}
                      title={`${PROVIDERS[p].label} · $${v.toFixed(2)}`}
                    />
                  );
                })}
              </div>
              <span className="spend-total">
                ${r.total.toFixed(2)} · {r.count} takes
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* by model */}
      <section className="dash-section">
        <span className="label">Spend · By model</span>
        <div className="spend-rows">
          {byModel.map((m) => (
            <div className="spend-row" key={m.p}>
              <span className="spend-label">{PROVIDERS[m.p].label}</span>
              <div className="spend-bar">
                <i
                  style={{
                    width: `${(m.total / modelMax) * 100}%`,
                    background: PROVIDERS[m.p].chartColor,
                  }}
                />
              </div>
              <span className="spend-total">
                ${m.total.toFixed(2)} · {m.count} takes · {m.seconds}s
              </span>
            </div>
          ))}
          {byModel.length === 0 && <p className="hint">No takes yet.</p>}
        </div>
      </section>

      {/* config */}
      <section className="dash-section">
        <span className="label">Config</span>
        <div className="dash-config">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Maker</th>
                <th>Model ID</th>
                <th>$/s</th>
                <th>Key</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.key}>
                  <td>
                    {m.short}
                    {m.key === DEFAULT_MODEL_KEY ? " ·default" : ""}
                  </td>
                  <td>{m.company}</td>
                  <td className="mono">{m.modelId}</td>
                  <td>{modelPriceLabel(m)}</td>
                  <td className="mono">{m.envVar}</td>
                  <td>
                    {keys[m.envVar] ? (
                      <span className="dash-ok">● set</span>
                    ) : (
                      <span className="dash-miss">○ missing</span>
                    )}
                    {!m.implemented && " · unverified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Defaults:{" "}
            {MODELS.find((m) => m.key === DEFAULT_MODEL_KEY)?.short ?? "Veo 3.1 Fast"} ·{" "}
            {DEFAULTS.aspectRatio} ·{" "}
            {DEFAULTS.durationSeconds}s · {DEFAULTS.resolution} — duration snaps
            to {DURATION_CHOICES.join("/")}s per provider rules. Refiner:{" "}
            {REFINER_MODEL_ID}. Local data: {(storageBytes / 1024).toFixed(0)}KB
            of the ~5MB localStorage budget. Costs are computed estimates
            (duration × published rate), not billing readouts.
          </p>
        </div>
      </section>
      </div>
    </>
  );
}
