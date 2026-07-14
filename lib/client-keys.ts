/**
 * Browser-side key store for the HOSTED app (docs/HOSTED.md §3.1).
 *
 * On zclip.vercel.app there is no .env.local — visitors' keys live in
 * plain localStorage (`hooklab.keys`) and ride each API request in the
 * `x-provider-key` header, where the route hands them to the adapter and
 * forgets them. Deliberately NOT the lib/store file-backed store: keys
 * must never be written into .zclip-data (shared file, lab snapshots).
 *
 * On a local install this module is a harmless no-op layer: the key panel
 * writes .env.local via /api/keys instead, so localStorage stays empty and
 * requests carry no key header (routes fall back to env — server rule in
 * lib/server-keys.ts).
 */

const LS_KEY = "hooklab.keys";

function readAll(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getLocalKey(envVar: string): string | null {
  const v = readAll()[envVar];
  return typeof v === "string" && v.length >= 8 ? v : null;
}

export function setLocalKey(envVar: string, value: string): void {
  const all = readAll();
  all[envVar] = value;
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

export function removeLocalKey(envVar: string): void {
  const all = readAll();
  delete all[envVar];
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

/** envVar → present, for merging into the key panel's booleans. */
export function localKeyFlags(): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(readAll()).map(([k, v]) => [k, typeof v === "string" && v.length >= 8]),
  );
}

/** Merge the provider-key header for `envVar` into `base` when a browser
 *  key exists. Call on every money/keyed API fetch; no-op locally. */
export function keyHeader(
  envVar: string | null | undefined,
  base: Record<string, string> = {},
): Record<string, string> {
  if (!envVar) return base;
  const key = getLocalKey(envVar);
  return key ? { ...base, "x-provider-key": key } : base;
}

/** The envVar an /api/video proxy URL needs, or null for public-CDN
 *  (?remote=) fetches which are keyless. */
export function videoUrlEnvVar(url: string): string | null {
  if (!url.startsWith("/api/video?")) return null;
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  if (q.get("uri")) return "GEMINI_API_KEY";
  if (q.get("provider") === "sora") return "OPENAI_API_KEY";
  return null;
}
