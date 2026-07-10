import { checkPassword, unauthorized } from "@/lib/auth";
import { upstreamFor } from "@/lib/video-upstream";

/**
 * Streams finished MP4s whose providers require an auth header the
 * browser's <video> tag can't send:
 *   ?uri=…                → Veo (Gemini file URI + x-goog-api-key)
 *   ?provider=sora&ref=…  → Sora (/v1/videos/{id}/content + Bearer)
 *   ?remote=…             → allowlisted provider CDNs without CORS (Runway)
 * Grok/Seedance return browser-fetchable URLs and skip this proxy.
 * ?dl=1 switches Content-Disposition to attachment for Download buttons.
 * URL resolution lives in lib/video-upstream (shared with /api/clips).
 */

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();

  const url = new URL(req.url);
  const upstream = upstreamFor(url);
  if ("error" in upstream) {
    return Response.json({ error: upstream.error }, { status: 400 });
  }

  const res = await fetch(upstream.target, {
    headers: upstream.headers,
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    return Response.json(
      { error: `Video fetch failed (HTTP ${res.status}) — providers delete generated files after a retention window` },
      { status: 502 },
    );
  }

  const headers = new Headers({
    "content-type": res.headers.get("content-type") ?? "video/mp4",
    "cache-control": "private, max-age=3600",
  });
  const length = res.headers.get("content-length");
  if (length) headers.set("content-length", length);
  if (url.searchParams.get("dl") === "1") {
    headers.set(
      "content-disposition",
      `attachment; filename="reaction-hook-${Date.now()}.mp4"`,
    );
  }

  return new Response(res.body, { headers });
}
