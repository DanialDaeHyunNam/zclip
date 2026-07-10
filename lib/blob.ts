/**
 * Minimal Vercel Blob REST client — no SDK, honoring the repo's
 * next/react/typescript-only dependency rule. Protocol pinned from the
 * @vercel/blob source (x-api-version 12).
 *
 * Why it exists: Seedance 2.0 reads reference VIDEOS, but only by public
 * URL (no data: URIs) — a local .zclip-data / .grabs clip is unreachable
 * from ModelArk. The adapter parks the clip here for the duration of the
 * job and deletes it once the task reaches a terminal state.
 */

const BLOB_API = "https://blob.vercel-storage.com";
const API_VERSION = "12";

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set — Seedance 2.0 needs a Vercel Blob store to host the reference video as a public URL (vercel.com → Storage → Blob, then add the token to .env.local)",
    );
  }
  return t;
}

/** Upload bytes as a public blob; returns the public URL. A random suffix is
 *  appended so concurrent jobs never collide. */
export async function putTempBlob(
  bytes: Uint8Array,
  mimeType: string,
  pathname: string,
): Promise<string> {
  // v12 protocol: pathname rides as a query param, not the URL path.
  const res = await fetch(`${BLOB_API}/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token()}`,
      "x-api-version": API_VERSION,
      "x-vercel-blob-access": "public",
      "x-content-type": mimeType,
      "x-add-random-suffix": "1",
    },
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`Blob upload failed (HTTP ${res.status}) — check BLOB_READ_WRITE_TOKEN`);
  }
  const body = await res.json();
  if (typeof body?.url !== "string") throw new Error("Blob upload returned no url");
  return body.url;
}

/** Best-effort delete — an orphaned temp blob (e.g. after a dev-server
 *  restart mid-job) is harmless and can be cleaned from the Vercel dashboard. */
export async function deleteBlobs(urls: string[]): Promise<void> {
  if (!urls.length) return;
  try {
    await fetch(`${BLOB_API}/delete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token()}`,
        "x-api-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({ urls }),
    });
  } catch {
    /* cleanup only */
  }
}
