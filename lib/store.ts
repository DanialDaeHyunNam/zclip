"use client";

/**
 * Client persistence for ZCLIP's `hooklab.*` data (sessions, gallery, custom
 * assets, current thread, …).
 *
 * Why not plain localStorage: two failure modes bit us badly —
 *  (1) the ~5MB origin quota (each take carries base64 frames), so big
 *      multi-take sessions silently failed to save and vanished on reload;
 *  (2) localStorage is per-ORIGIN including port, so sessions made on
 *      localhost:3001 were invisible on :3000 and vice-versa.
 *
 * ZCLIP is a LOCAL tool, so the dev server can own a real file on disk
 * (`.zclip-data/store.json`, via /api/store). That file has no size cap and is
 * shared across ports (same project dir) — killing both problems. localStorage
 * becomes a best-effort MIRROR (fallback for the cloud/self-host-prod build,
 * where the filesystem route is disabled).
 *
 * After `hydrate()`, `get()` is synchronous (in-memory cache); `set()`/`remove()`
 * write through to disk (debounced) and mirror to localStorage.
 *
 * Migration: the first time a given origin hydrates against the file, it
 * UNION-merges its own localStorage into the shared file (sessions by id,
 * gallery by jobId, custom assets by id) — so pre-existing :3000 AND :3001 data
 * both land in the one file exactly once, then the file is the source of truth.
 */

const PREFIX = "hooklab.";
const SESSIONS = "hooklab.sessions";
const GALLERY = "hooklab.gallery";
const ASSETS = "hooklab.customAssets";
const MIGRATED_FLAG = "zclip.fsMigrated";

const cache = new Map<string, string>();
let usingFs = false;
let hydratePromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */

function readLocalStorage(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) m.set(k, localStorage.getItem(k) ?? "");
    }
  } catch {
    /* private mode / disabled — nothing to seed */
  }
  return m;
}

const parse = <T,>(s: string | undefined, fb: T): T => {
  try {
    return JSON.parse(s ?? "") ?? fb;
  } catch {
    return fb;
  }
};

/** Union localStorage into the file's data (file wins for plain scalars). */
function mergeStores(file: Record<string, string>, ls: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>(Object.entries(file));
  for (const [k, v] of ls) if (!out.has(k)) out.set(k, v); // scalars: file wins

  const fSessions = parse<any[]>(file[SESSIONS], []);
  const lSessions = parse<any[]>(ls.get(SESSIONS), []);
  if (fSessions.length || lSessions.length) {
    const m = new Map<string, any>();
    for (const s of [...fSessions, ...lSessions]) {
      if (!s?.id) continue;
      const cur = m.get(s.id);
      if (!cur || (s.updatedAt ?? 0) > (cur.updatedAt ?? 0)) m.set(s.id, s);
    }
    out.set(SESSIONS, JSON.stringify([...m.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))));
  }

  const fGallery = parse<any[]>(file[GALLERY], []);
  const lGallery = parse<any[]>(ls.get(GALLERY), []);
  if (fGallery.length || lGallery.length) {
    const m = new Map<string, any>();
    for (const c of [...fGallery, ...lGallery]) if (c?.jobId) m.set(c.jobId, c);
    out.set(GALLERY, JSON.stringify([...m.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))));
  }

  const fa = parse<any>(file[ASSETS], {});
  const la = parse<any>(ls.get(ASSETS), {});
  if (Object.keys(fa).length || Object.keys(la).length) {
    const u = (x: any[] = [], y: any[] = []) => {
      const m = new Map<string, any>();
      for (const a of [...(x ?? []), ...(y ?? [])]) if (a?.id) m.set(a.id, a);
      return [...m.values()];
    };
    out.set(ASSETS, JSON.stringify({
      characters: u(fa.characters, la.characters),
      settings: u(fa.settings, la.settings),
      fashion: u(fa.fashion, la.fashion),
    }));
  }
  return out;
}

async function doHydrate(): Promise<void> {
  const ls = readLocalStorage();
  // Seed synchronously (before the first await) so a down/absent API still works
  // and any early get() sees prior data.
  for (const [k, v] of ls) cache.set(k, v);

  try {
    const r = await fetch("/api/store", { cache: "no-store" });
    if (!r.ok) return; // 403 (cloud / self-host prod) → localStorage-only mode
    const file = (await r.json()) as Record<string, string>;
    usingFs = true;

    let migrated = false;
    try {
      migrated = localStorage.getItem(MIGRATED_FLAG) === "1";
    } catch {
      /* ignore */
    }

    cache.clear();
    if (migrated) {
      for (const [k, v] of Object.entries(file)) cache.set(k, v); // file is truth
    } else {
      for (const [k, v] of mergeStores(file, ls)) cache.set(k, v); // one-time union
      await flushNow();
      try {
        localStorage.setItem(MIGRATED_FLAG, "1");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* API unreachable — stay in localStorage-only mode (cache already seeded) */
  }
}

/** Load the store. Safe to call many times — hydration happens once. */
export function hydrate(): Promise<void> {
  if (!hydratePromise) hydratePromise = doHydrate();
  return hydratePromise;
}

export function get(key: string): string | null {
  return cache.has(key) ? cache.get(key)! : null;
}

export function set(key: string, value: string): void {
  cache.set(key, value);
  try {
    localStorage.setItem(key, value); // best-effort mirror; quota is harmless
  } catch {
    /* file is the source of truth */
  }
  scheduleFlush();
}

export function remove(key: string): void {
  cache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (!usingFs) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushNow(), 400);
}

async function flushNow(): Promise<void> {
  if (!usingFs) return;
  const payload: Record<string, string> = {};
  for (const [k, v] of cache) if (k.startsWith(PREFIX)) payload[k] = v;
  try {
    await fetch("/api/store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* keep the localStorage mirror as the fallback */
  }
}
