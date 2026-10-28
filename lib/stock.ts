/**
 * Stock-footage search for the CUT pipeline (docs/CUT-FLOW.md) — Pexels,
 * BROWSER-DIRECT on purpose: api.pexels.com answers CORS `*` including the
 * `authorization` header (verified live 2026-08-02), keys are free, and the
 * video files themselves are CORS-clean — so the search AND the download
 * never touch our server, local or hosted. The key lives in hooklab.keys
 * (lib/client-keys) like every hosted BYOK key.
 */

export interface StockClip {
  id: string;
  /** Direct mp4 file picked for our target (portrait, ~720–1080 wide). */
  url: string;
  width: number;
  height: number;
  durationSec: number;
  thumb: string;
  /** Attribution link (Pexels asks for a visible credit where practical). */
  pageUrl: string;
  photographer: string;
}

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  image: string;
  url: string;
  user?: { name?: string };
  video_files: PexelsVideoFile[];
}

/** Prefer a portrait mp4 near 720–1080 wide; fall back to the largest mp4.
 *  Oversized sources are fine — compose cover-crops to 720×1280 anyway. */
function pickFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4s = files.filter((f) => f.file_type === "video/mp4" && f.link);
  if (!mp4s.length) return null;
  const portrait = mp4s
    .filter((f) => f.height > f.width)
    .sort(
      (a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720),
    );
  if (portrait.length) return portrait[0];
  return mp4s.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

export async function searchPexels(
  query: string,
  apiKey: string,
  perPage = 10,
): Promise<StockClip[]> {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${perPage}`,
    { headers: { Authorization: apiKey } },
  );
  if (res.status === 401) throw new Error("Pexels rejected the API key (401)");
  if (res.status === 429) throw new Error("Pexels rate limit hit — wait a minute");
  if (!res.ok) throw new Error(`Pexels error ${res.status}`);
  const data = (await res.json()) as { videos?: PexelsVideo[] };
  return (data.videos ?? [])
    .map((v) => {
      const f = pickFile(v.video_files ?? []);
      if (!f) return null;
      return {
        id: String(v.id),
        url: f.link,
        width: f.width,
        height: f.height,
        durationSec: v.duration,
        thumb: v.image,
        pageUrl: v.url,
        photographer: v.user?.name ?? "Pexels",
      } satisfies StockClip;
    })
    .filter((c): c is StockClip => Boolean(c));
}
