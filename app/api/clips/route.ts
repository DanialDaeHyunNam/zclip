import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { checkPassword, unauthorized } from "@/lib/auth";
import { dirUsage } from "@/lib/dir-usage";
import { PERSIST_HOSTS, hostAllowed, upstreamFor } from "@/lib/video-upstream";

/**
 * Clip vault — persists finished takes into .zclip-data/clips/ so a video
 * outlives its provider URL. Providers sign their download links and purge
 * the files within a day or two (a Runway JWT dies in ~31h), so anything
 * not saved here is eventually a dead <video>.
 *
 * POST {jobId, url} downloads the video server-side — url is either a
 * /api/video?… proxy query (resolved via the shared upstream logic, auth
 * headers included) or a direct provider URL (host-allowlisted). GET ?f=
 * streams a vaulted file back, same pattern as GRAB.
 *
 * Dev-only, like the store and GRAB: a deployment must never write the
 * host's disk or be talked into fetching arbitrary URLs.
 */

const CLIPS_DIR = path.join(process.cwd(), ".zclip-data", "clips");
const FILE_NAME = /^clip-[\w.-]+\.mp4$/;
const MAX_BYTES = 200_000_000;

function devOnly(): Response | null {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "The clip vault is a local dev feature — disabled on deployments" },
      { status: 403 },
    );
  }
  return null;
}

function resolveSource(
  raw: string,
): { target: string; headers: Record<string, string> } | { error: string } {
  if (raw.startsWith("/api/video?")) {
    return upstreamFor(new URL(raw, "http://localhost"));
  }
  if (/^https?:\/\//.test(raw)) {
    if (!hostAllowed(raw, PERSIST_HOSTS)) return { error: "Source host not allowed" };
    return { target: raw, headers: {} };
  }
  return { error: "Unsupported source url" };
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const gate = devOnly();
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const source = typeof body.url === "string" ? body.url : "";
  if (!jobId || !source) {
    return Response.json({ error: "Missing jobId or url" }, { status: 400 });
  }

  // Veo job ids are LRO names with slashes — flatten to a safe file name.
  const name = `clip-${jobId.replace(/[^\w.-]+/g, "_")}.mp4`;
  if (!FILE_NAME.test(name)) {
    return Response.json({ error: "Bad job id" }, { status: 400 });
  }
  const file = path.join(CLIPS_DIR, name);
  const url = `/api/clips?f=${encodeURIComponent(name)}`;

  // Already vaulted (recovery sweep re-run) — nothing to download.
  try {
    const existing = await stat(file);
    return Response.json({ url, bytes: existing.size });
  } catch {}

  const resolved = resolveSource(source);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }

  try {
    const res = await fetch(resolved.target, {
      headers: resolved.headers,
      redirect: "follow",
    });
    if (!res.ok) {
      return Response.json(
        { error: `Source fetch failed (HTTP ${res.status}) — the provider link may have expired` },
        { status: 502 },
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) {
      return Response.json({ error: "Video empty or too large (200MB max)" }, { status: 502 });
    }
    await mkdir(CLIPS_DIR, { recursive: true });
    // Atomic write (temp + rename) so a crash mid-download can't leave a
    // half-written file that later serves as a corrupt video.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
    return Response.json({ url, bytes: bytes.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clip download failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Empty the vault — the Library's "Clear All". Permanent: providers purge
 *  their copies within days, so a deleted take cannot be re-downloaded. */
export async function DELETE(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const gate = devOnly();
  if (gate) return gate;
  // ?jobId= — permanently delete ONE vaulted take (same name mapping as
  // POST). No param keeps the original clear-all behavior.
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (jobId) {
    const name = `clip-${jobId.replace(/[^\w.-]+/g, "_")}.mp4`;
    if (!FILE_NAME.test(name)) {
      return Response.json({ error: "Bad job id" }, { status: 400 });
    }
    await rm(path.join(CLIPS_DIR, name), { force: true });
    return Response.json({ removed: 1 });
  }
  const usage = await dirUsage(CLIPS_DIR);
  await rm(CLIPS_DIR, { recursive: true, force: true });
  return Response.json({ removed: usage.files, bytes: usage.bytes });
}

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const gate = devOnly();
  if (gate) return gate;

  const params = new URL(req.url).searchParams;
  if (params.get("usage") === "1") {
    return Response.json(await dirUsage(CLIPS_DIR));
  }
  const f = params.get("f") ?? "";
  if (!FILE_NAME.test(f)) {
    return Response.json({ error: "Bad file name" }, { status: 400 });
  }
  const file = path.join(CLIPS_DIR, f);
  try {
    const info = await stat(file);
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(info.size),
        "cache-control": "no-store",
        ...(params.get("dl") && {
          "content-disposition": `attachment; filename="${f}"`,
        }),
      },
    });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}
