/**
 * Hosted playback for auth-headed videos (docs/HOSTED.md §3.2).
 *
 * Veo/Sora MP4s download only with the provider key in a header, and a
 * <video> tag can't send headers. Locally the /api/video proxy adds the key
 * from env; hosted, the visitor's key must ride the request — but never in
 * the URL (query strings land in request logs, and the promise is "never
 * logged"). So the client fetches the MP4 itself with the pass-through
 * header and plays a blob: object URL instead.
 *
 * The cache is module-level and permanent for the tab's life: clips are a
 * few MB, sessions are short, and revoking on unmount would break the same
 * clip rendered twice (thread + archive strip).
 */

const cache = new Map<string, string>(); // /api/video?… → blob: URL
const pending = new Map<string, Promise<string>>();

export function cachedSrc(url: string): string | null {
  return cache.get(url) ?? null;
}

export function fetchBlobSrc(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = (async () => {
    const r = await fetch(url, { headers });
    if (!r.ok) {
      let msg = `Video fetch failed (HTTP ${r.status})`;
      try {
        msg = (await r.json())?.error ?? msg;
      } catch {
        /* stream/no-json body */
      }
      throw new Error(msg);
    }
    const obj = URL.createObjectURL(await r.blob());
    cache.set(url, obj);
    return obj;
  })().finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}
