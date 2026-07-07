import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * Streams finished MP4s whose providers require an auth header the
 * browser's <video> tag can't send:
 *   ?uri=…                → Veo (Gemini file URI + x-goog-api-key)
 *   ?provider=sora&ref=…  → Sora (/v1/videos/{id}/content + Bearer)
 * Grok/Seedance return browser-fetchable URLs and skip this proxy.
 * ?dl=1 switches Content-Disposition to attachment for Download buttons.
 */

const VEO_PREFIX = "https://generativelanguage.googleapis.com/";
const SORA_REF = /^video_[\w-]+$/;
// Provider CDNs that serve public presigned URLs but lack CORS headers —
// proxied so playback is same-origin and snapshot capture works.
// (Runway Act-Two outputs are served from CloudFront.)
const REMOTE_HOSTS = ["vidgen.x.ai", "cloudfront.net", "runwayml.com"];

function upstreamFor(url: URL): { target: string; headers: Record<string, string> } | { error: string } {
  const uri = url.searchParams.get("uri");
  if (uri) {
    if (!uri.startsWith(VEO_PREFIX)) return { error: "Invalid video uri" };
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { error: "GEMINI_API_KEY is not set" };
    return { target: uri, headers: { "x-goog-api-key": key } };
  }
  if (url.searchParams.get("provider") === "sora") {
    const ref = url.searchParams.get("ref") ?? "";
    if (!SORA_REF.test(ref)) return { error: "Invalid video ref" };
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { error: "OPENAI_API_KEY is not set" };
    return {
      target: `https://api.openai.com/v1/videos/${ref}/content`,
      headers: { authorization: `Bearer ${key}` },
    };
  }
  const remote = url.searchParams.get("remote");
  if (remote) {
    try {
      const host = new URL(remote).hostname;
      if (!REMOTE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        return { error: "Remote host not allowed" };
      }
    } catch {
      return { error: "Invalid remote url" };
    }
    return { target: remote, headers: {} };
  }
  return { error: "Missing ?uri=, ?provider=sora&ref= or ?remote=" };
}

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
