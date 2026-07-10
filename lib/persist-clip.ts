import { isLocalVideoUrl } from "@/lib/clip";

/**
 * Vault a finished take's video into .zclip-data/clips (dev-only route).
 * If the stored URL is already dead — providers sign links that expire in a
 * day or two — re-poll the provider by jobId: a still-retained task hands
 * back a FRESH signed URL, which is vaulted instead. Returns the local
 * /api/clips URL, or null when the provider has purged the artifact
 * (nothing left to save).
 */
export async function persistRemoteVideo(
  jobId: string,
  provider: string,
  url: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const vault = async (source: string): Promise<string | null> => {
    try {
      const r = await fetch("/api/clips", {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, url: source }),
      });
      if (!r.ok) return null;
      const body = await r.json();
      return typeof body.url === "string" ? body.url : null;
    } catch {
      return null;
    }
  };

  const direct = await vault(url);
  if (direct) return direct;

  // Stored link is dead — ask the provider for a fresh one by job id.
  try {
    const r = await fetch(
      `/api/status?id=${encodeURIComponent(jobId)}&provider=${encodeURIComponent(provider)}`,
      { headers },
    );
    if (!r.ok) return null;
    const body = await r.json();
    if (
      body.state === "done" &&
      typeof body.videoUrl === "string" &&
      !isLocalVideoUrl(body.videoUrl)
    ) {
      return vault(body.videoUrl);
    }
  } catch {
    /* provider unreachable — leave the clip as-is */
  }
  return null;
}
