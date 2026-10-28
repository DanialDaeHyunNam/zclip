import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { checkPassword, unauthorized } from "@/lib/auth";
import { dirUsage } from "@/lib/dir-usage";
import { isNeutral, lutCube } from "@/lib/post-grade";
import { buildPostGraph } from "@/lib/post-render";
import { sanitizeSettings } from "@/lib/post-settings";

/**
 * GRAB — local-only reference-video fetcher. Four source kinds:
 *   - X post/article URLs: guest-token GraphQL (TweetResultByRestId with
 *     withArticleRichContentState) → direct video.twimg.com mp4s. Articles
 *     embed media that yt-dlp can't reach; this path can.
 *   - Threads post URLs: yt-dlp has no Threads extractor. The post page
 *     (fetched as a crawler) carries the media JSON → direct cdninstagram mp4.
 *   - Anything yt-dlp supports (YouTube etc.): shell out to yt-dlp.
 *   - Direct .mp4/.webm links: plain server-side download.
 * Optional start/end trim runs through ffmpeg (re-encode, frame-accurate).
 *
 * Dev-only, like the key writer: it shells out and fetches arbitrary URLs,
 * which must never be reachable on a public deployment. Files land in
 * .grabs/ (gitignored) and are streamed back via GET ?f=.
 */

const GRABS_DIR = path.join(process.cwd(), ".grabs");
const CLIPS_DIR = path.join(process.cwd(), ".zclip-data", "clips");
const FILE_NAME = /^grab-[\w.-]+\.mp4$/;
const CLIP_FILE_NAME = /^clip-[\w.-]+\.mp4$/;
const BLOCKED_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1|metadata\.)/i;
const X_URL =
  /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:\w+\/status\/(\d+)|i\/article\/\d+)/;
const THREADS_URL =
  /^https?:\/\/(?:www\.)?threads\.(?:com|net)\/@[\w.]+\/post\/([\w-]+)/;
const MAX_BYTES = 200_000_000;
const CHILD_TIMEOUT_MS = 150_000;

// X web client's public bearer (ships in every browser session; also used
// by yt-dlp). Grants guest-level read access only.
const X_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const X_QUERY_ID = "2ICDjqPd81tulZcYrtpTuQ"; // TweetResultByRestId
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
// Threads server-renders a post's media JSON only for crawlers — a browser
// UA gets the login-wall shell with no video_versions (verified 2026-10-10).
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

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

/** Threads post → its direct mp4. The page also carries replies and other
 *  posts' media, so walk the embedded JSON for the object whose `code` is
 *  this post and take its video (or a carousel's first video). */
async function resolveThreadsVideo(postUrl: string, code: string): Promise<string> {
  const res = await fetch(postUrl, {
    headers: { "user-agent": CRAWLER_UA },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Threads returned HTTP ${res.status}`);
  const html = await res.text();

  type Media = { code?: string; video_versions?: { url?: string }[]; carousel_media?: Media[] };
  const videoOf = (m: Media) =>
    m.video_versions?.[0]?.url ??
    m.carousel_media?.find((c) => c.video_versions?.length)?.video_versions?.[0]?.url;
  const find = (o: unknown): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    const m = o as Media;
    const hit = m.code === code ? videoOf(m) : undefined;
    if (hit) return hit;
    for (const v of Object.values(o)) {
      const found = find(v);
      if (found) return found;
    }
    return undefined;
  };

  for (const [, blob] of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!blob.includes(code) || !blob.includes("video_versions")) continue;
    try {
      const url = find(JSON.parse(blob));
      if (url) return url;
    } catch {
      // not valid JSON — keep scanning the other blobs
    }
  }
  throw new Error("No video found in that Threads post (text/images only, or private)");
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

  // Trim an ALREADY-vaulted clip (grab or take) into a new short clip —
  // no external URL, so it's handled before the URL validation below.
  // This is what lets the MOVES stage trim a >15s reference in place.
  if (action === "trim-local") {
    const src = typeof body.src === "string" ? body.src : "";
    const start = Number(body.start);
    const end = Number(body.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) {
      return Response.json({ error: "Bad trim range" }, { status: 400 });
    }
    // Resolve the source to a vaulted file — grabs and clips only, name-
    // validated so the trim can never read an arbitrary path.
    const gm = src.match(/^\/api\/grab\?f=(.+)$/);
    const cm = src.match(/^\/api\/clips\?f=(.+)$/);
    let srcPath: string | null = null;
    if (gm) {
      const f = decodeURIComponent(gm[1]);
      if (FILE_NAME.test(f)) srcPath = path.join(GRABS_DIR, f);
    } else if (cm) {
      const f = decodeURIComponent(cm[1]);
      if (CLIP_FILE_NAME.test(f)) srcPath = path.join(CLIPS_DIR, f);
    }
    if (!srcPath) {
      return Response.json({ error: "Unsupported source" }, { status: 400 });
    }
    try {
      await stat(srcPath);
    } catch {
      return Response.json({ error: "Source clip not found" }, { status: 404 });
    }
    await mkdir(GRABS_DIR, { recursive: true });
    const out = path.join(GRABS_DIR, `grab-${Date.now()}-cut.mp4`);
    try {
      await run("ffmpeg", [
        "-y",
        "-ss", String(start),
        "-i", srcPath,
        "-t", String(Math.max(0.5, end - start)),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart",
        out,
      ]);
      const info = await stat(out);
      const served = path.basename(out);
      return Response.json({
        name: served,
        url: `/api/grab?f=${encodeURIComponent(served)}`,
        bytes: info.size,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Trim failed";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  // POST — reframe + phone look on a vaulted take (owner 2026-10-27: Kling
  // framed the character dead-centre with a phone poking in at the bottom;
  // real selfie UGC is tighter and off-centre). The crop window comes from postWindow()
  // (lib/post-frame.ts) on BOTH sides, so the studio's CSS preview and this
  // render agree — and so do the shake, the colour grade (a 3D LUT built by
  // lib/post-grade.ts), the window light × vignette mask and the sharpen
  // (owner 2026-10-28: "like Lightroom, everything doable in post"). Order:
  // trim → roll → shaking crop → 1080×1920 → RGB (bt709) → LUT → mask →
  // sharpen → YUV (bt709) → 30fps → soften → grain → encode. The phone
  // encode is the research chain (lab/HYPERREAL.md): a low-quality pass,
  // then a high-quality re-encode with a light unsharp. Audio: dropped, or
  // a quiet room tone.
  if (action === "post") {
    const src = typeof body.src === "string" ? body.src : "";
    const cm = src.match(/^\/api\/clips\?f=([^&]+)/);
    const f = cm ? decodeURIComponent(cm[1]) : "";
    if (!cm || !CLIP_FILE_NAME.test(f)) {
      return Response.json(
        { error: "Post works on a saved take — wait until it's vaulted (reload once), then retry." },
        { status: 400 },
      );
    }
    const srcPath = path.join(CLIPS_DIR, f);
    try {
      await stat(srcPath);
    } catch {
      return Response.json({ error: "Source clip not found" }, { status: 404 });
    }
    // One builder for this render and the edit agent's stills
    // (lib/post-render.ts) — see the order there.
    const settings = sanitizeSettings(body);
    const phoneEncode = settings.phoneEncode;
    await mkdir(CLIPS_DIR, { recursive: true });
    const stamp = Date.now();
    const lutPath = isNeutral(settings.grade) ? null : path.join(CLIPS_DIR, `post-lut-${stamp}.cube`);
    if (lutPath) await writeFile(lutPath, lutCube(settings.grade));
    const { graph, room } = buildPostGraph(settings, lutPath);
    const audioArgs = room
      ? ["-map", "[a]", "-c:a", "aac", "-b:a", "96k", "-shortest"]
      : ["-an"];
    const out = path.join(CLIPS_DIR, `clip-post-${stamp}.mp4`);
    const pass1 = phoneEncode ? path.join(CLIPS_DIR, `clip-post-${stamp}-p1.mp4`) : out;
    const tag = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
    try {
      await run("ffmpeg", [
        "-y", "-i", srcPath,
        "-filter_complex", graph, "-map", "[v]",
        ...audioArgs,
        "-c:v", "libx264", "-preset", phoneEncode ? "veryfast" : "medium",
        "-crf", phoneEncode ? "30" : "18", "-pix_fmt", "yuv420p", ...tag,
        "-movflags", "+faststart",
        pass1,
      ]);
      if (phoneEncode) {
        await run("ffmpeg", [
          "-y", "-i", pass1,
          "-vf", "unsharp=5:5:0.25:5:5:0",
          ...(room ? ["-c:a", "copy"] : ["-an"]),
          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", ...tag,
          "-movflags", "+faststart",
          out,
        ]);
        await rm(pass1, { force: true });
      }
      if (lutPath) await rm(lutPath, { force: true });
      const info = await stat(out);
      const served = path.basename(out);
      return Response.json({
        name: served,
        url: `/api/clips?f=${encodeURIComponent(served)}`,
        bytes: info.size,
      });
    } catch (err) {
      if (lutPath) await rm(lutPath, { force: true });
      const message = err instanceof Error ? err.message : "Post render failed";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  // Lay one vaulted clip's AUDIO over another's VIDEO (transfer flow's
  // "REF AUDIO": the depth pass strips the reference's music, and the take
  // follows the choreography 1:1 — so the original soundtrack drops back
  // on beat). Video stream copies untouched; `1:a?` maps audio only if the
  // source has any (a silent source = a clean no-op copy).
  if (action === "mux-audio") {
    const resolveLocal = (src: unknown): string | null => {
      if (typeof src !== "string") return null;
      const gm2 = src.match(/^\/api\/grab\?f=([^&]+)/);
      const cm2 = src.match(/^\/api\/clips\?f=([^&]+)/);
      if (gm2) {
        const f = decodeURIComponent(gm2[1]);
        if (FILE_NAME.test(f)) return path.join(GRABS_DIR, f);
      } else if (cm2) {
        const f = decodeURIComponent(cm2[1]);
        if (CLIP_FILE_NAME.test(f)) return path.join(CLIPS_DIR, f);
      }
      return null;
    };
    const videoPath = resolveLocal(body.video);
    const audioPath = resolveLocal(body.audio);
    if (!videoPath || !audioPath) {
      return Response.json({ error: "Unsupported source" }, { status: 400 });
    }
    try {
      await stat(videoPath);
      await stat(audioPath);
    } catch {
      return Response.json({ error: "Source clip not found" }, { status: 404 });
    }
    await mkdir(CLIPS_DIR, { recursive: true });
    const out = path.join(CLIPS_DIR, `clip-mux-${Date.now()}.mp4`);
    try {
      await run("ffmpeg", [
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-map", "0:v", "-map", "1:a?",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        out,
      ]);
      const info = await stat(out);
      const served = path.basename(out);
      return Response.json({
        name: served,
        url: `/api/clips?f=${encodeURIComponent(served)}`,
        bytes: info.size,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Audio mux failed";
      return Response.json({ error: message }, { status: 502 });
    }
  }

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

      // Threads has no yt-dlp extractor — resolve the post to its mp4 first.
      const threads = raw.match(THREADS_URL);
      const direct = threads ? await resolveThreadsVideo(raw, threads[1]) : null;

      if (direct || /\.(mp4|webm|mov)(\?|$)/i.test(raw) || u.hostname === "video.twimg.com") {
        // Direct file — plain download.
        const res = await fetch(direct ?? raw, { redirect: "follow" });
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
