import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { checkPassword, unauthorized } from "@/lib/auth";
import { dirUsage } from "@/lib/dir-usage";

/**
 * GRAB — local-only reference-video fetcher. Three source kinds:
 *   - X post/article URLs: guest-token GraphQL (TweetResultByRestId with
 *     withArticleRichContentState) → direct video.twimg.com mp4s. Articles
 *     embed media that yt-dlp can't reach; this path can.
 *   - Anything yt-dlp supports (YouTube etc.): shell out to yt-dlp.
 *   - Direct .mp4/.webm links: plain server-side download.
 * Optional start/end trim runs through ffmpeg (re-encode, frame-accurate).
 *
 * Dev-only, like the key writer: it shells out and fetches arbitrary URLs,
 * which must never be reachable on a public deployment. Files land in
 * .grabs/ (gitignored) and are streamed back via GET ?f=.
 */

const GRABS_DIR = path.join(process.cwd(), ".grabs");
const FILE_NAME = /^grab-[\w.-]+\.mp4$/;
const BLOCKED_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1|metadata\.)/i;
const X_URL =
  /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:\w+\/status\/(\d+)|i\/article\/\d+)/;
const MAX_BYTES = 200_000_000;
const CHILD_TIMEOUT_MS = 150_000;

// X web client's public bearer (ships in every browser session; also used
// by yt-dlp). Grants guest-level read access only.
const X_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const X_QUERY_ID = "2ICDjqPd81tulZcYrtpTuQ"; // TweetResultByRestId
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function devOnly(): Response | null {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "GRAB is a local dev tool — disabled on deployments" },
      { status: 403 },
    );
  }
  return null;
}

/** Run a binary (homebrew fallback included) and wait; rejects on failure. */
function run(bin: string, args: string[], timeoutMs = CHILD_TIMEOUT_MS): Promise<void> {
  const attempt = (cmd: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${bin} timed out`));
      }, timeoutMs);
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr.split("\n").filter(Boolean).pop() ?? `${bin} failed`));
      });
    });
  return attempt(bin).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return attempt(`/opt/homebrew/bin/${bin}`).catch((e2) => {
        if ((e2 as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`${bin} is not installed — run: brew install ${bin === "yt-dlp" ? "yt-dlp" : "ffmpeg"}`);
        }
        throw e2;
      });
    }
    throw err;
  });
}

/** X GraphQL with the article toggle on; returns every embedded video's
 *  best-resolution mp4. Regex over the raw JSON survives schema drift. */
async function probeX(tweetId: string): Promise<{ id: string; url: string; res: string }[]> {
  const act = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { authorization: `Bearer ${X_BEARER}`, "user-agent": BROWSER_UA },
    cache: "no-store",
  });
  const actBody = await act.json().catch(() => ({}));
  const guest = actBody?.guest_token;
  if (!guest) {
    throw new Error(
      `X guest token unavailable (HTTP ${act.status}${
        actBody?.errors?.[0]?.message ? `: ${actBody.errors[0].message}` : ""
      }) — try again shortly`,
    );
  }

  const qs = new URLSearchParams({
    variables: JSON.stringify({
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    }),
    features: JSON.stringify({
      creator_subscriptions_tweet_preview_api_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_media_download_video_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    }),
    fieldToggles: JSON.stringify({ withArticleRichContentState: true }),
  });
  const res = await fetch(
    `https://x.com/i/api/graphql/${X_QUERY_ID}/TweetResultByRestId?${qs}`,
    {
      headers: {
        authorization: `Bearer ${X_BEARER}`,
        "content-type": "application/json",
        "x-guest-token": guest,
        "x-twitter-client-language": "en",
        "x-twitter-active-user": "yes",
        "user-agent": BROWSER_UA,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`X API returned HTTP ${res.status}`);
  const text = (await res.text()).replace(/\\\//g, "/");

  const best = new Map<string, { url: string; res: string; px: number }>();
  for (const m of text.matchAll(
    /https:\/\/video\.twimg\.com\/(?:amplify_video|ext_tw_video)\/(\d+)\/vid\/[^/]*\/(\d+)x(\d+)\/[^\s"'\\]+/g,
  )) {
    const [url, id, w, h] = [m[0], m[1], Number(m[2]), Number(m[3])];
    const px = w * h;
    if ((best.get(id)?.px ?? 0) < px) best.set(id, { url, res: `${w}x${h}`, px });
  }
  return [...best.entries()].map(([id, v]) => ({ id, url: v.url, res: v.res }));
}

async function trim(file: string, start: number, end: number): Promise<string> {
  const out = file.replace(/\.mp4$/, "-cut.mp4");
  await run("ffmpeg", [
    "-y",
    "-ss", String(start),
    "-i", file,
    "-t", String(Math.max(0.5, end - start)),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
}

// Codecs a browser <video> happily decodes but Apple QuickLook / QuickTime
// can't — a VP9-in-mp4 grab plays in-app yet won't open once downloaded.
const APPLE_INCOMPATIBLE = new Set(["vp8", "vp9", "av1"]);

/** Read the primary video stream's codec (ffprobe, homebrew fallback). Returns
 *  "" if it can't be determined — callers then leave the file untouched. */
function probeVideoCodec(file: string): Promise<string> {
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name",
    "-of", "default=nk=1:nw=1",
    file,
  ];
  const attempt = (cmd: string) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
  return attempt("ffprobe").catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return attempt("/opt/homebrew/bin/ffprobe");
    throw err;
  });
}

/** Guarantee the grab is playable everywhere (not just in Chrome): if it's a
 *  VP9/AV1/VP8 video, transcode to H.264. No-op for H.264/HEVC — the common
 *  case, so most grabs skip the re-encode entirely. */
async function ensureAppleCompatible(file: string): Promise<string> {
  let codec = "";
  try {
    codec = await probeVideoCodec(file);
  } catch {
    return file; // can't tell — don't risk mangling an already-fine file
  }
  if (!APPLE_INCOMPATIBLE.has(codec)) return file;
  const out = file.replace(/\.mp4$/, "-h264.mp4");
  await run("ffmpeg", [
    "-y", "-i", file,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
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
  const action = body.action;
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOST.test(u.hostname)) {
    return Response.json({ error: "That host is not allowed" }, { status: 400 });
  }

  try {
    if (action === "probe") {
      // Only X URLs need a probe (an article can hold several videos).
      const xm = raw.match(X_URL);
      if (!xm) return Response.json({ videos: null }); // client falls through to fetch
      const tweetId = xm[1] ?? (await resolveArticleTweetId(raw));
      const videos = await probeX(tweetId);
      if (!videos.length) {
        return Response.json(
          { error: "No videos found in that post (images-only, or login-gated)" },
          { status: 404 },
        );
      }
      return Response.json({ videos });
    }

    if (action === "fetch") {
      await mkdir(GRABS_DIR, { recursive: true });
      const name = `grab-${Date.now()}.mp4`;
      let file = path.join(GRABS_DIR, name);

      const start = body.start == null ? null : Number(body.start);
      const end = body.end == null ? null : Number(body.end);
      const wantTrim = start != null && end != null && end > start;

      // Set when the download itself already cut the clip (yt-dlp
      // --download-sections) — the local ffmpeg trim must then be skipped:
      // the file's timeline starts at 0, so re-trimming at [start,end]
      // would cut the wrong (usually empty) range.
      let alreadyTrimmed = false;

      if (/\.(mp4|webm|mov)(\?|$)/i.test(raw) || u.hostname === "video.twimg.com") {
        // Direct file — plain download.
        const res = await fetch(raw, { redirect: "follow" });
        if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
        const len = Number(res.headers.get("content-length") ?? 0);
        if (len > MAX_BYTES) throw new Error("Video too large (200MB max)");
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
      } else {
        // yt-dlp territory (YouTube and hundreds of other sites). Prefer an
        // H.264 (avc1) rendition so the result plays everywhere, not just in
        // Chrome — some sites (Instagram) also serve VP9, which Apple can't
        // decode. Falls back to any mp4, then anything.
        // With a trim range, download ONLY that section (a 60s beat from a
        // 22-minute video used to pull the whole 400MB file and then trip
        // the 200MB cap). --force-keyframes-at-cuts re-encodes the section
        // (H.264/AAC for mp4), so it lands frame-accurate and already cut.
        await run(
          "yt-dlp",
          [
            "--no-playlist",
            "-f",
            "bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
            "--merge-output-format", "mp4",
            "--max-filesize", "200M",
            ...(wantTrim
              ? ["--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts"]
              : []),
            "-o", file,
            raw,
          ],
          // Section grabs stream through ffmpeg at a throttled rate AND
          // re-encode at the cuts — a 10-minute section can legitimately
          // take several minutes. Whole-file grabs keep the tight timeout.
          wantTrim ? 600_000 : CHILD_TIMEOUT_MS,
        );
        if (wantTrim) alreadyTrimmed = true;
        // yt-dlp treats an exceeded --max-filesize as a SKIP: it aborts the
        // download but still exits 0, leaving no merged file — which used to
        // surface as ffmpeg's baffling "Error opening input files". Catch it
        // here and say what actually happened.
        const produced = await stat(file).catch(() => null);
        if (!produced) {
          throw new Error(
            "The source is over the 200MB cap, so nothing was saved. Set a trim range (start → end) — then only that section is downloaded — or pick a shorter source.",
          );
        }
      }

      // Trim re-encodes to H.264; otherwise normalise any VP9/AV1 grab so the
      // downloaded file opens outside the browser too.
      if (wantTrim && !alreadyTrimmed) file = await trim(file, start, end);
      else file = await ensureAppleCompatible(file);
      const info = await stat(file);
      const served = path.basename(file);
      return Response.json({
        name: served,
        url: `/api/grab?f=${encodeURIComponent(served)}`,
        bytes: info.size,
      });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Grab failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Article URLs don't carry the tweet id — the shell page's og:url does.
 *  Fall back to scraping the canonical status id out of the article HTML. */
async function resolveArticleTweetId(articleUrl: string): Promise<string> {
  const res = await fetch(articleUrl, {
    headers: { "user-agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  const html = await res.text();
  const m = html.match(/status\/(\d{10,})/);
  if (!m) {
    throw new Error(
      "Couldn't resolve this article to its post — paste the post URL (x.com/user/status/…) instead",
    );
  }
  return m[1];
}

/** Delete every grabbed reference file — the Library's "Clear All" covers
 *  GRABs too (they are the largest files on disk). */
export async function DELETE(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const gate = devOnly();
  if (gate) return gate;
  // ?f= — permanently delete ONE grabbed reference; no param = clear all.
  const f = new URL(req.url).searchParams.get("f");
  if (f) {
    if (!FILE_NAME.test(f)) {
      return Response.json({ error: "Bad file name" }, { status: 400 });
    }
    await rm(path.join(GRABS_DIR, f), { force: true });
    return Response.json({ removed: 1 });
  }
  const usage = await dirUsage(GRABS_DIR);
  await rm(GRABS_DIR, { recursive: true, force: true });
  return Response.json({ removed: usage.files, bytes: usage.bytes });
}

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const gate = devOnly();
  if (gate) return gate;

  const params = new URL(req.url).searchParams;
  if (params.get("usage") === "1") {
    return Response.json(await dirUsage(GRABS_DIR));
  }
  const f = params.get("f") ?? "";
  if (!FILE_NAME.test(f)) {
    return Response.json({ error: "Bad file name" }, { status: 400 });
  }
  const file = path.join(GRABS_DIR, f);
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
