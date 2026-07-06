import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * Fetches a DIRECT video file URL server-side (browsers can't, CORS) so
 * it can enter the reference pipeline. Works with .mp4/.webm CDN links —
 * NOT with TikTok/Instagram page URLs (those need a downloader).
 */

const BLOCKED_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1|metadata\.)/i;
const MAX_BYTES = 80_000_000;

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOST.test(u.hostname)) {
    return Response.json({ error: "That host is not allowed" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(u, { redirect: "follow" });
  } catch {
    return Response.json({ error: "Could not reach that URL" }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    return Response.json(
      { error: `Upstream returned HTTP ${res.status}` },
      { status: 502 },
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!/video\/|application\/octet-stream|mp4|webm|quicktime/i.test(ct)) {
    return Response.json(
      { error: "That URL isn't a direct video file — page links (TikTok etc.) won't work, use a .mp4/.webm link" },
      { status: 415 },
    );
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) {
    return Response.json({ error: "Video too large (80MB max)" }, { status: 413 });
  }

  return new Response(res.body, {
    headers: {
      "content-type": /video\//i.test(ct) ? ct : "video/mp4",
      "cache-control": "no-store",
    },
  });
}
