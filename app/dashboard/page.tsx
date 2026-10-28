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
import { localKeyFlags } from "@/lib/client-keys";
import { useHosted } from "@/lib/use-version";
import * as store from "@/lib/store";
import { BILLABLE_PROVIDERS, REBILL_KEY } from "@/lib/clip";
import type { CallEntry } from "@/lib/call-ledger";
import { Rail } from "../rail";

/**
 * Read-only spend & config dashboard. Two ledgers: video takes live in the
 * store the studio writes (the archive), stills + text calls in the server's
 * .zclip-data/calls.jsonl (GET /api/billing, lib/call-ledger.ts). This page
 * never writes the store — a second writer would clobber the studio's
 * flush — so "Match again" shows the bills here and asks the studio to save
 * them (REBILL_KEY).
 */

interface LedgerClip {
  jobId: string;
  sessionId?: string;
  provider: ProviderName | "grab";
  createdAt: number;
  durationSeconds: number;
  costUsd?: number;
  /** "billed"/"units" once /api/billing matched it to the provider's bill. */
  costSource?: "billed" | "units" | "est";
  estUsd?: number;
  billingNote?: string;
  billingTries?: number;
}

type Rebill = { state: string; costUsd?: number; source?: "billed" | "units"; reason?: string };
type OrgBill =
  | { usd: number; lines: { lineItem: string; usd: number }[]; startMs: number; project: { id: string; name: string } | null }
  | { error: string };

/** Stills and text calls ride the charts as two more series. */
const CALL_SERIES = {
  still: { label: "Stills", color: "#7A8CA8" },
  text: { label: "Text calls", color: "#B5B5BD" },
} as const;
type Series = ProviderName | keyof typeof CALL_SERIES;
const seriesColor = (k: Series) => (k in CALL_SERIES ? CALL_SERIES[k as keyof typeof CALL_SERIES].color : PROVIDERS[k as ProviderName].chartColor);
const seriesLabel = (k: Series) => (k in CALL_SERIES ? CALL_SERIES[k as keyof typeof CALL_SERIES].label : PROVIDERS[k as ProviderName].label);
const matchedSource = (s?: string) => s === "billed" || s === "units";
/** Text calls cost fractions of a cent — don't round them to $0.00. */
const fmtUsd = (v: number) => (v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

interface LedgerSession {
  id: string;
  title: string;
}

const DAY_MS = 86_400_000;
const DAYS_SHOWN = 14;

// Read the SAME store the studio writes (the file-backed .zclip-data store
// locally, localStorage on hosted). Reading localStorage directly showed
// recent sessions as "Removed session": since the file store took over,
// localStorage only holds a stale copy (owner 2026-10-28).
const load = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(store.get(key) ?? localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
};

export default function Dashboard() {
  const hosted = useHosted();
  const [rawClips, setRawClips] = useState<LedgerClip[]>([]);
  const [sessions, setSessions] = useState<LedgerSession[]>([]);
  // Flows tag their takes with the flow id, not the chat session's.
  const [flowTitles, setFlowTitles] = useState<Map<string, string>>(new Map());
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [storageBytes, setStorageBytes] = useState(0);
  // Series filter — a video provider, or stills / text calls.
  const [filter, setFilter] = useState<Series | null>(null);
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [orgBill, setOrgBill] = useState<OrgBill | null>(null);
  // "Match again" answers, shown here until the studio saves them.
  const [rebill, setRebill] = useState<Map<string, Rebill>>(new Map());
  const [rebilling, setRebilling] = useState(false);
  const [rebillMsg, setRebillMsg] = useState<string | null>(null);
  // Hosted-only "delete all data" (docs/HOSTED.md §3.5) — locally the file
  // store is the source of truth, so the honest reset is deleting
  // .zclip-data/ in the project folder (a localStorage wipe would resurrect).
  const [wipeOpen, setWipeOpen] = useState(false);
  // Billing-only keys (fal BILLING preset, OpenAI Admin) — pasted here,
  // saved to .env.local by /api/keys like every other key.
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [keyMsg, setKeyMsg] = useState<Record<string, string>>({});
  const pwHeader = (): Record<string, string> => {
    const pw = localStorage.getItem("hooklab.pw") ?? "";
    return pw ? { "x-app-password": pw } : {};
  };
  const loadCalls = () =>
    fetch("/api/billing?openai=1", { headers: pwHeader() })
      .then((r) => r.json())
      .then((b) => {
        setCalls(Array.isArray(b.calls) ? b.calls : []);
        setOrgBill(b.openai ?? null);
      })
      .catch(() => {});
  const saveKey = async (envVar: string, savedMsg: string) => {
    const r = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", ...pwHeader() },
      body: JSON.stringify({ envVar, value: (keyDraft[envVar] ?? "").trim() }),
    }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) {
      setKeys((k) => ({ ...k, [envVar]: true }));
      setKeyDraft((d) => ({ ...d, [envVar]: "" }));
      setKeyMsg((m) => ({ ...m, [envVar]: savedMsg }));
      void loadCalls();
    } else setKeyMsg((m) => ({ ...m, [envVar]: b.error ?? "Couldn't save the key" }));
  };
  const [wipeDone, setWipeDone] = useState(false);

  useEffect(() => {
    void store.hydrate().then(() => {
      setRawClips(load<LedgerClip[]>("hooklab.gallery", []));
      setSessions(load<LedgerSession[]>("hooklab.sessions", []));
      setFlowTitles(new Map(load<{ id: string; title?: string }[]>("hooklab.flows", []).map((f) => [f.id, f.title ?? "Untitled"])));
    });
    void loadCalls();
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
      // Browser-stored keys (hosted pass-through) count as present too.
      .then((b) => setKeys({ ...(b.keys ?? b), ...localKeyFlags() }))
      .catch(() => setKeys(localKeyFlags()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const wipeAll = () => {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("hooklab.")) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    setRawClips([]);
    setSessions([]);
    setStorageBytes(0);
    setKeys(hosted ? {} : keys);
    setWipeOpen(false);
    setWipeDone(true);
  };

  // "Match again" answers overlay the archive until the studio saves them.
  const clips = useMemo(
    () =>
      rawClips.map((c) => {
        const x = rebill.get(c.jobId);
        if (x?.state === "done" && x.costUsd != null) {
          return { ...c, estUsd: c.estUsd ?? c.costUsd, costUsd: x.costUsd, costSource: x.source, billingNote: undefined };
        }
        return x?.state === "unsupported" ? { ...c, billingNote: x.reason } : c;
      }),
    [rawClips, rebill],
  );
  const takes = useMemo(() => clips.filter((c) => c.provider !== "grab"), [clips]);
  const grabs = clips.length - takes.length;
  const seconds = takes.reduce((s, c) => s + (c.durationSeconds || 0), 0);
  const videoUsd = takes.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const kindUsd = (k: CallEntry["kind"]) => calls.filter((c) => c.kind === k).reduce((s, c) => s + (c.usd ?? 0), 0);

  // Every chart reads ONE list: video takes + stills + text calls.
  type Item = { at: number; series: Series; usd: number | null; matched: boolean; sessionId?: string; isCall: boolean };
  const items = useMemo<Item[]>(
    () => [
      ...takes.map((c) => ({
        at: c.createdAt,
        series: c.provider as ProviderName,
        usd: c.costUsd ?? null,
        matched: matchedSource(c.costSource),
        sessionId: c.sessionId,
        isCall: false,
      })),
      ...calls.map((c) => ({
        at: c.at,
        series: c.kind,
        usd: c.usd,
        matched: matchedSource(c.source),
        sessionId: c.sessionId,
        isCall: true,
      })),
    ],
    [takes, calls],
  );
  const priced = items.filter((i) => i.usd != null);
  const unpriced = items.length - priced.length;
  const total = priced.reduce((s, i) => s + i.usd!, 0);
  // Periods, so "$49" says WHEN (owner: "since when? was it yesterday?").
  const firstAt = items.length ? Math.min(...items.map((i) => i.at)) : null;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1).getTime();
  const sumSince = (t: number) => priced.filter((i) => i.at >= t).reduce((s, i) => s + i.usd!, 0);
  const today = sumSince(dayStart.getTime());
  const week = sumSince(dayStart.getTime() - 6 * DAY_MS);
  const month = sumSince(monthStart);
  // How much of the money shown is the provider's own number (owner:
  // "match the real bill") vs ZCLIP's estimate.
  const matchedUsd = priced.filter((i) => i.matched).reduce((s, i) => s + i.usd!, 0);

  const providers = (Object.keys(PROVIDERS) as ProviderName[]).filter((p) =>
    takes.some((c) => c.provider === p),
  );
  const series: Series[] = [
    ...providers,
    ...(["still", "text"] as const).filter((k) => calls.some((c) => c.kind === k)),
  ];

  // The filtered set the charts/breakdowns read (chips select a series).
  const view = useMemo(
    () => (filter ? items.filter((i) => i.series === filter) : items),
    [items, filter],
  );

  /* by day — last 14 days, stacked by series */
  const byDay = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const start = today.getTime() - (DAYS_SHOWN - 1 - i) * DAY_MS;
      return { start, parts: new Map<Series, number>(), total: 0 };
    });
    for (const i of view) {
      if (i.usd == null) continue;
      const idx = Math.floor((i.at - days[0].start) / DAY_MS);
      if (idx < 0 || idx >= DAYS_SHOWN) continue;
      const d = days[idx];
      d.total += i.usd;
      d.parts.set(i.series, (d.parts.get(i.series) ?? 0) + i.usd);
    }
    return days;
  }, [view]);
  const dayMax = Math.max(...byDay.map((d) => d.total), 0.01);

  /* by session */
  const bySession = useMemo(() => {
    const m = new Map<
      string,
      { label: string; total: number; takes: number; calls: number; first: number; latest: number; parts: Map<Series, number> }
    >();
    for (const i of view) {
      const key = i.sessionId ?? "earlier";
      let g = m.get(key);
      if (!g) {
        const flow = flowTitles.get(key);
        g = {
          label:
            sessions.find((s) => s.id === key)?.title ??
            (flow ? `Flow · ${flow}` : key === "earlier" ? (i.isCall ? "No session" : "Earlier takes") : "Removed session"),
          total: 0,
          takes: 0,
          calls: 0,
          first: Infinity,
          latest: 0,
          parts: new Map(),
        };
        m.set(key, g);
      }
      if (i.isCall) g.calls += 1;
      else g.takes += 1;
      g.latest = Math.max(g.latest, i.at);
      g.first = Math.min(g.first, i.at);
      if (i.usd != null) {
        g.total += i.usd;
        g.parts.set(i.series, (g.parts.get(i.series) ?? 0) + i.usd);
      }
    }
    return [...m.values()].sort((a, b) => b.latest - a.latest);
  }, [view, sessions, flowTitles]);
  const sessionMax = Math.max(...bySession.map((s) => s.total), 0.01);

  /* by model — video takes */
  const byModel = providers
    .filter((p) => !filter || p === filter)
    .map((p) => {
      const list = takes.filter((c) => c.provider === p);
      return {
        p,
        count: list.length,
        seconds: list.reduce((s, c) => s + (c.durationSeconds || 0), 0),
        total: list.reduce((s, c) => s + (c.costUsd ?? 0), 0),
        matched: list.filter((c) => matchedSource(c.costSource)).length,
      };
    });
  const modelMax = Math.max(...byModel.map((m) => m.total), 0.01);

  /* stills + text calls — by route · model */
  const callRows = useMemo(() => {
    const m = new Map<string, { label: string; kind: CallEntry["kind"]; count: number; total: number; unpriced: number; billed: number }>();
    for (const c of calls) {
      if (filter && filter !== c.kind) continue;
      const key = `${c.route} · ${c.model}`;
      const g = m.get(key) ?? { label: key, kind: c.kind, count: 0, total: 0, unpriced: 0, billed: 0 };
      g.count += 1;
      if (c.usd == null) g.unpriced += 1;
      else g.total += c.usd;
      if (c.source === "billed") g.billed += 1;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [calls, filter]);
  const callMax = Math.max(...callRows.map((r) => r.total), 0.01);

  /* takes a provider could bill but hasn't been matched yet — and why */
  const unmatched = takes
    .filter((c) => BILLABLE_PROVIDERS.has(c.provider) && !matchedSource(c.costSource) && c.jobId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const whyUnmatched = (c: LedgerClip) =>
    c.billingNote ??
    (Date.now() - c.createdAt > 6 * DAY_MS
      ? "Older than the studio's 6-day auto check"
      : (c.billingTries ?? 0) > 0
        ? `Bill not posted yet (${c.billingTries} checks)`
        : "Waiting for the studio's first check");
  const noBillProviders = providers.filter((p) => !BILLABLE_PROVIDERS.has(p));
  const matchAgain = async () => {
    setRebilling(true);
    setRebillMsg(null);
    const out = new Map(rebill);
    const list = unmatched;
    for (let i = 0; i < list.length; i += 20) {
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json", ...pwHeader() },
        body: JSON.stringify({
          items: list.slice(i, i + 20).map((c) => ({ provider: c.provider, jobId: c.jobId, submittedAt: c.createdAt })),
        }),
      }).catch(() => null);
      const b = r ? await r.json().catch(() => ({})) : {};
      for (const x of (b.results ?? []) as (Rebill & { jobId: string })[]) out.set(x.jobId, x);
      setRebill(new Map(out));
    }
    try {
      localStorage.setItem(REBILL_KEY, String(Date.now()));
    } catch {
      /* the studio's own loop still retries recent takes */
    }
    const got = list.filter((c) => out.get(c.jobId)?.state === "done").length;
    setRebillMsg(
      `${got} of ${list.length} matched. The studio saves them the next time it opens (right away if it's open in another tab).`,
    );
    setRebilling(false);
  };

  /* OpenAI: the org's own bill vs ZCLIP's OpenAI lines over the same days */
  const orgOk = orgBill && !("error" in orgBill) ? orgBill : null;
  const zclipOpenAi = orgOk
    ? calls.filter((c) => c.provider === "openai" && c.at >= orgOk.startMs).reduce((s, c) => s + (c.usd ?? 0), 0) +
      takes.filter((c) => c.provider === "sora" && c.createdAt >= orgOk.startMs).reduce((s, c) => s + (c.costUsd ?? 0), 0)
    : 0;

  const keyField = (envVar: string, savedMsg: string) => (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="post-agent-input"
          style={{ minHeight: 0 }}
          type="password"
          placeholder={envVar}
          value={keyDraft[envVar] ?? ""}
          onChange={(e) => setKeyDraft((d) => ({ ...d, [envVar]: e.target.value }))}
        />
        <button
          className="btn-ghost"
          disabled={!(keyDraft[envVar] ?? "").trim()}
          onClick={() => void saveKey(envVar, savedMsg)}
        >
          Save key
        </button>
      </div>
      {keyMsg[envVar] && <p className="hint">{keyMsg[envVar]}</p>}
    </>
  );

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
          <span className="label">All-time spend</span>
          {firstAt && <span className="dash-sub">since {new Date(firstAt).toLocaleDateString()}</span>}
          <span className="dash-sub" title="Matched = the provider's own bill (xAI ticks, Runway credits, fal / Kling billing APIs) or exact units × the official price (BytePlus, Gemini, OpenAI tokens). The rest is seconds × rate.">
            ${matchedUsd.toFixed(2)} matched to bills · ${(total - matchedUsd).toFixed(2)} estimated
          </span>
          <span className="dash-sub">
            video {fmtUsd(videoUsd)} · stills {fmtUsd(kindUsd("still"))} · text {fmtUsd(kindUsd("text"))}
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">${month.toFixed(2)}</span>
          <span className="label">This month</span>
          <span className="dash-sub">
            last 7 days ${week.toFixed(2)} · today ${today.toFixed(2)}
          </span>
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
            ${takes.length ? (videoUsd / takes.length).toFixed(2) : "0.00"}
          </span>
          <span className="label">Avg / take</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">{calls.length}</span>
          <span className="label">Stills &amp; text calls</span>
          <span className="dash-sub">{fmtUsd(kindUsd("still") + kindUsd("text"))}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-num">{grabs}</span>
          <span className="label">References grabbed</span>
        </div>
      </div>

      {!hosted && !keys.FAL_BILLING_KEY && takes.some((c) => c.provider === "kling4" || c.provider === "lucy") && (
        <section className="dash-section dash-billing-key">
          <span className="label">Match fal bills (Kling 4.0 · Lucy)</span>
          <p className="hint">
            fal only shows what a request really cost to a key with the <b>Billing</b> preset — a normal key is refused.
            Create one at{" "}
            <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
              fal.ai/dashboard/keys
            </a>{" "}
            (preset: Billing) and paste it here. Until then Kling / Lucy costs stay estimates.
          </p>
          {keyField("FAL_BILLING_KEY", "Saved — the studio matches Kling / Lucy takes with fal's bill within a minute.")}
        </section>
      )}

      <div className="dash-filters">
        <button
          className={`dash-chip ${filter === null ? "on" : ""}`}
          onClick={() => setFilter(null)}
        >
          All models
        </button>
        {series.map((p) => (
          <button
            key={p}
            className={`dash-chip ${filter === p ? "on" : ""}`}
            onClick={() => setFilter((f) => (f === p ? null : p))}
          >
            <i style={{ background: seriesColor(p) }} />
            {seriesLabel(p)}
          </button>
        ))}
      </div>

      {/* by period */}
      <section className="dash-section">
        <span className="label">Spend · Last {DAYS_SHOWN} days</span>
        <div className="dash-cols">
          {byDay.map((d) => (
            <div className="dash-col" key={d.start}>
              {d.total > 0 && <span className="dash-col-value">${d.total.toFixed(2)}</span>}
              <div className="dash-col-bar" title={`$${d.total.toFixed(2)}`}>
                {series.map((p) => {
                  const v = d.parts.get(p);
                  if (!v) return null;
                  return (
                    <i
                      key={p}
                      style={{
                        height: `${(v / dayMax) * 100}%`,
                        background: seriesColor(p),
                      }}
                      title={`${seriesLabel(p)} · $${v.toFixed(2)}`}
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
        {bySession.length === 0 && <p className="hint">Nothing spent yet.</p>}
        <div className="spend-rows">
          {bySession.map((r) => (
            <div className="spend-row" key={r.label + r.latest}>
              <span className="spend-label" title={r.label}>
                {r.label}
                <em className="spend-when">
                  {fmtDay(r.first)}
                  {fmtDay(r.first) !== fmtDay(r.latest) ? ` → ${fmtDay(r.latest)}` : ""}
                </em>
              </span>
              <div className="spend-bar">
                {series.map((p) => {
                  const v = r.parts.get(p);
                  if (!v) return null;
                  return (
                    <i
                      key={p}
                      style={{
                        width: `${(v / sessionMax) * 100}%`,
                        background: seriesColor(p),
                      }}
                      title={`${seriesLabel(p)} · $${v.toFixed(2)}`}
                    />
                  );
                })}
              </div>
              <span className="spend-total">
                ${r.total.toFixed(2)} · {[r.takes && `${r.takes} takes`, r.calls && `${r.calls} calls`].filter(Boolean).join(" · ")}
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
                {m.matched ? ` · ${m.matched} billed` : ""}
              </span>
            </div>
          ))}
          {byModel.length === 0 && <p className="hint">No takes yet.</p>}
        </div>
      </section>

      {/* stills + text calls (server ledger, lib/call-ledger.ts) */}
      {(!filter || filter === "still" || filter === "text") && (
        <section className="dash-section">
          <span className="label">Spend · Stills &amp; text calls</span>
          <div className="spend-rows">
            {callRows.map((r) => (
              <div className="spend-row" key={r.label}>
                <span className="spend-label" title={r.label}>
                  {r.label}
                </span>
                <div className="spend-bar">
                  <i style={{ width: `${(r.total / callMax) * 100}%`, background: CALL_SERIES[r.kind].color }} />
                </div>
                <span className="spend-total">
                  {fmtUsd(r.total)} · {r.count} calls
                  {r.billed === r.count ? " · billed" : r.billed ? ` · ${r.billed} billed` : " · tokens × price"}
                  {r.unpriced ? ` · ${r.unpriced} unpriced` : ""}
                </span>
              </div>
            ))}
            {callRows.length === 0 && (
              <p className="hint">
                {hosted
                  ? "Not recorded on the hosted app — the call ledger is a file on a local install."
                  : "No stills or text calls recorded yet. Every card, edit, outfit swap, describe, refine, title and spec check is written down from 2026-10-28 on."}
              </p>
            )}
          </div>
        </section>
      )}

      {/* takes still on an estimate — and why */}
      {!hosted && (unmatched.length > 0 || noBillProviders.length > 0) && (
        <section className="dash-section">
          <span className="label">Not matched to a bill</span>
          {unmatched.length > 0 && (
            <>
              <div className="spend-rows">
                {unmatched.slice(0, 12).map((c) => (
                  <div className="spend-row" key={c.jobId}>
                    <span className="spend-label">
                      {PROVIDERS[c.provider as ProviderName]?.label ?? c.provider}
                      <em className="spend-when">{fmtDay(c.createdAt)}</em>
                    </span>
                    <span className="hint" style={{ margin: 0 }}>{whyUnmatched(c)}</span>
                    <span className="spend-total">≈${(c.costUsd ?? 0).toFixed(2)}</span>
                  </div>
                ))}
                {unmatched.length > 12 && <p className="hint">and {unmatched.length - 12} more</p>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn-ghost" disabled={rebilling} onClick={() => void matchAgain()}>
                  {rebilling ? "Asking the providers…" : `Match again (${unmatched.length})`}
                </button>
                {rebillMsg && <span className="hint" style={{ margin: 0 }}>{rebillMsg}</span>}
              </div>
            </>
          )}
          {noBillProviders.length > 0 && (
            <p className="hint">
              {noBillProviders.map((p) => PROVIDERS[p].label).join(" · ")}: no per-request bill from the provider — these stay
              seconds × rate{noBillProviders.includes("sora") ? " (OpenAI's org bill below covers Sora)" : ""}.
            </p>
          )}
        </section>
      )}

      {/* OpenAI — the org's own bill next to ZCLIP's OpenAI lines */}
      {!hosted && (
        <section className="dash-section">
          <span className="label">OpenAI · org bill check</span>
          <p className="hint">
            ZCLIP&apos;s own key (Sora, CUT scripts) — paste a new one here to replace it; a revoked key only fails at
            the next call.
          </p>
          {keyField("OPENAI_API_KEY", "Saved — ZCLIP uses the new OpenAI key from the next call.")}
          {orgOk ? (
            <>
              <p className="hint">
                OpenAI billed <b>{fmtUsd(orgOk.usd)}</b>{" "}
                {orgOk.project ? `to project ${orgOk.project.name}` : "to the whole org (ZCLIP's key wasn't found in a project)"} since{" "}
                {new Date(orgOk.startMs).toLocaleDateString()} (Costs API, a day or so behind) · ZCLIP&apos;s OpenAI lines for
                the same days: <b>{fmtUsd(zclipOpenAi)}</b>. A gap means something spent with this key outside ZCLIP — or ZCLIP
                missed a line.
              </p>
              <div className="spend-rows">
                {orgOk.lines.slice(0, 6).map((l) => (
                  <div className="spend-row" key={l.lineItem}>
                    <span className="spend-label">{l.lineItem}</span>
                    <span />
                    <span className="spend-total">${l.usd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                {orgBill && "error" in orgBill ? `${orgBill.error}. ` : ""}
                OpenAI shows the bill only to an <b>Admin key</b> of the org that owns ZCLIP&apos;s OPENAI_API_KEY.
                ZCLIP narrows it to the project that key belongs to. Create one at{" "}
                <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer">
                  platform.openai.com → Admin keys
                </a>{" "}
                and paste it here.
              </p>
              {keyField("OPENAI_ADMIN_KEY", "Saved — the org bill shows above.")}
            </>
          )}
        </section>
      )}

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
            of the ~5MB localStorage budget. Costs are the provider&apos;s bill
            where it gives one (see the headline split); the rest is duration ×
            published rate.
          </p>
        </div>
      </section>

      {/* data controls — hosted keeps everything in this browser, so this
          is the one real "leave no trace" switch. Local installs are file-
          backed (.zclip-data is the source of truth); wiping localStorage
          there would just resurrect on reload, so we point at the folder. */}
      <section className="dash-section">
        <span className="label">Your data</span>
        {hosted ? (
          <div className="dash-config">
            <p className="hint">
              Everything ZCLIP knows — sessions, takes, the spend ledger,
              saved API keys — lives in this browser&apos;s localStorage.
              Nothing is stored on the server.
            </p>
            {wipeDone ? (
              <p className="hint">All ZCLIP data in this browser was deleted.</p>
            ) : (
              <button
                className="btn-ghost btn-danger"
                onClick={() => setWipeOpen(true)}
              >
                Delete all data
              </button>
            )}
          </div>
        ) : (
          <p className="hint">
            This install is file-backed: your sessions and takes live in{" "}
            <code>.zclip-data/</code> inside the project folder (localStorage
            is only a mirror). To erase everything, quit the dev server and
            delete that folder — plus <code>.env.local</code> if you want the
            saved API keys gone too.
          </p>
        )}
      </section>
      </div>

      {wipeOpen && (
        <div
          className="rlg-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Delete all data"
          onClick={() => setWipeOpen(false)}
        >
          <div className="rlg-modal-card about-card" onClick={(e) => e.stopPropagation()}>
            <div className="rlg-modal-head">
              <span className="label">Delete all data</span>
              <button
                type="button"
                className="rlg-modal-close"
                onClick={() => setWipeOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="rlg-modal-body">
              <p className="archive-note">
                This permanently deletes <b>everything ZCLIP keeps in this
                browser</b>: all sessions and takes, the library, your saved
                API keys — and the archive, which doubles as the{" "}
                <b>spend ledger</b> (this dashboard&apos;s history goes with it).
              </p>
              <p className="archive-note">
                Past takes cannot be re-downloaded afterwards — providers purge
                their copies within days. Download anything you want to keep
                first.
              </p>
              <div className="rlg-cta-row">
                <button className="btn-ghost" onClick={() => setWipeOpen(false)}>
                  Cancel
                </button>
                <button className="btn-ghost btn-danger" onClick={wipeAll}>
                  Delete everything
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
