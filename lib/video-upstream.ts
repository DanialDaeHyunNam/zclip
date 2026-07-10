/**
 * Resolves a /api/video query into its upstream fetch target + auth headers.
 * Shared by the playback proxy (app/api/video) and the clip vault
 * (app/api/clips) so both speak the same URL dialect.
 */

const VEO_PREFIX = "https://generativelanguage.googleapis.com/";
const SORA_REF = /^video_[\w-]+$/;

// Provider CDNs that serve public presigned URLs but lack CORS headers —
// proxied so playback is same-origin and snapshot capture works.
// (Runway Act-Two outputs are served from CloudFront.)
export const REMOTE_HOSTS = ["vidgen.x.ai", "cloudfront.net", "runwayml.com"];

// Hosts the clip vault may download from directly — REMOTE_HOSTS plus the
// providers whose URLs are browser-fetchable and never pass through the
// /api/video proxy (Seedance serves from BytePlus/Volcengine TOS buckets).
export const PERSIST_HOSTS = [...REMOTE_HOSTS, "volces.com", "bytepluses.com"];

export function hostAllowed(remote: string, hosts: string[]): boolean {
  try {
    const host = new URL(remote).hostname;
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function upstreamFor(
  url: URL,
): { target: string; headers: Record<string, string> } | { error: string } {
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
    if (!hostAllowed(remote, REMOTE_HOSTS)) {
      return { error: "Remote host not allowed" };
    }
    return { target: remote, headers: {} };
  }
  return { error: "Missing ?uri=, ?provider=sora&ref= or ?remote=" };
}
