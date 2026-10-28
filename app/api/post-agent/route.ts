/**
 * ✎ Edit chat — the owner talks, the locally installed Claude Code CLI edits
 * (owner 2026-10-28: "a chat above the presets; the connected Claude CLI
 * adjusts it as one primitive tool and improves it"). Dev-only, runs on the
 * owner's own Claude subscription (API keys are stripped from the child env).
 *
 * Actions (all POST, JSON):
 *  - chat   {key, text, look, src, refs?} → NDJSON stream: start · text · tool ·
 *           toolDone · look · done | error. Spawns `claude -p` with ONE MCP
 *           server (scripts/post-agent-mcp.mjs) and no built-in tools.
 *  - look   {key}                   → the live settings      (MCP get_look)
 *  - patch  {key, patch}            → merge + broadcast      (MCP set_look)
 *  - frame  {key, t?}               → before|after still     (MCP view_frame)
 *  - thread {key} / reset {key}     → the panel's history / a fresh chat
 *  - compact {key}                  → summarise now, next message opens a
 *                                     new session from that note
 *
 * References (owner 2026-10-28: "can I drop in images / videos and say
 * 'make it like this'?"): `refs` = images (data URLs) or vaulted videos. A
 * video becomes 4 evenly spaced frames + look stats (ffmpeg signalstats —
 * luma avg/p10/p90, saturation, Cb/Cr); the message goes in as stream-json
 * content blocks so Claude SEES them. view_frame returns the same stats for
 * the edit, so "like the reference" can be matched by numbers too. The last
 * references are kept on disk and re-attached when a session rolls over.
 *
 * Sessions: one Claude session per studio session (key), resumed with
 * --resume. When a turn ends above ROLL_AT of the context window, the same
 * session writes a handover note (compact — owner 2026-10-28: "default:
 * compact at 60%", also a button) and the next message opens a NEW session
 * from that note + the last exchange + the last references. If compacting
 * fails, the next message falls back to handing over the recent turns. The
 * look itself never needs handing over (get_look reads it live).
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { checkPassword, unauthorized } from "@/lib/auth";
import { isNeutral, lutCube } from "@/lib/post-grade";
import { buildPostGraph } from "@/lib/post-render";
import { DEFAULT_SETTINGS, sanitizeSettings, type PostSettings } from "@/lib/post-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATA_DIR = path.join(process.cwd(), ".zclip-data");
const CLIPS_DIR = path.join(DATA_DIR, "clips");
const THREADS_FILE = path.join(DATA_DIR, "post-agent.json");
const CLIP_FILE_NAME = /^clip-[\w.-]+\.mp4$/;
const KEY_RE = /^[\w-]{1,80}$/;
const ROLL_AT = 0.6;
const TURN_TIMEOUT_MS = 280_000;
const MODEL = process.env.ZCLIP_EDIT_MODEL ?? "opus";
const REFS_DIR = path.join(DATA_DIR, "post-agent-refs");
const MAX_REFS = 4;

type Msg = { role: "user" | "assistant" | "note"; text: string; tools?: string[]; refs?: string[]; at: number };
/** A reference as kept for re-attaching: its frames on disk + the stats line. */
type RefKept = { label: string; files: string[]; note: string };
type Thread = {
  sessionId: string | null;
  sessionNo: number;
  messages: Msg[];
  ctxTokens: number | null;
  ctxWindow: number | null;
  refs?: RefKept[];
  /** A compact's handover note, waiting for the next message's new session. */
  carry?: string;
};
type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type Live = { look: PostSettings; srcPath: string | null; listeners: Set<(e: object) => void>; busy: boolean };

// globalThis: survives dev HMR and is shared by every request to this route.
const G = globalThis as unknown as {
  __zclipPostAgent?: { live: Map<string, Live>; threads: Record<string, Thread> | null };
};
const store = (G.__zclipPostAgent ??= { live: new Map(), threads: null });

async function threads() {
  if (!store.threads) {
    try {
      store.threads = JSON.parse(await readFile(THREADS_FILE, "utf8")) as Record<string, Thread>;
    } catch {
      store.threads = {};
    }
  }
  return store.threads;
}
async function saveThreads() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(THREADS_FILE, JSON.stringify(store.threads ?? {}));
}
function live(key: string) {
  let l = store.live.get(key);
  if (!l) {
    l = { look: DEFAULT_SETTINGS, srcPath: null, listeners: new Set(), busy: false };
    store.live.set(key, l);
  }
  return l;
}
const emit = (l: Live, e: object) => l.listeners.forEach((fn) => fn(e));

// ── Claude CLI ────────────────────────────────────────────────────────────
// A dev server started from a GUI may lack the shell PATH — check the usual
// install spots first (same list as card-news' claude-cli.ts).
const runFile = promisify(execFile);
let cliBin: string | null | undefined;
async function findClaude() {
  if (cliBin !== undefined) return cliBin;
  const home = homedir();
  for (const c of [
    process.env.CLAUDE_CLI_PATH ?? "",
    path.join(home, ".local/bin/claude"),
    path.join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude",
  ].filter(Boolean)) {
    if (c.includes("/") && !existsSync(c)) continue;
    try {
      await runFile(c, ["--version"], { timeout: 5000 });
      return (cliBin = c);
    } catch {
      /* next */
    }
  }
  return (cliBin = null);
}

const SYSTEM = `You are the finisher inside ZCLIP's ✎ Edit panel. The owner makes AI-generated vertical UGC "reaction" clips (a young woman filming herself, ~3–4s, for Instagram/TikTok hooks) and wants them to pass as REAL iPhone footage. You control the panel only through three tools:
- get_look — the current settings
- set_look(patch) — change any subset; the owner's sliders and live preview move with it
- view_frame(t) — one still, left = as generated, right = with your edit (the exact final-render pipeline)

Loop: read the request → get_look (first turn) → one focused set_look → view_frame → judge → adjust (at most 4 rounds) → answer. Always view_frame after your LAST change, so what you report is what you saw.
Answer in Korean, short (one line + up to 4 bullets). Light markdown renders in the panel: **bold** for the key point, "- " bullets, and write every changed number as \`before → after\` (e.g. 하이라이트 \`−20 → −12\`) — the panel turns those into chips. No long explanations, no tables.
Realism guide: phone video is flatter than AI (−highlights, +shadows, slightly −contrast), light comes from one side (window), mild vignette, visible sensor grain (30–60), slight handheld shake; avoid filter looks (heavy split toning, strong saturation). Keep skin natural. Don't touch trim unless asked. If the owner's wish is ambiguous, make your best reasonable attempt and say what you assumed.
References: the owner may attach photos or videos (a video arrives as a few frames + look stats). Unless told otherwise they want the LOOK matched — grade, light direction, grain, framing/zoom, how shaky it feels — not the content. Say in one line what you read from the reference, then match it; view_frame returns the same stats for your edit, so close the gap in numbers (luma avg / p10 / p90 = brightness and contrast, sat = saturation, Cr − Cb > 0 = warmer).`;

const said = (m: Msg) => `${m.role === "user" ? "Owner" : "You"}: ${m.text.slice(0, 400)}`;
function handoff(th: Thread) {
  const recent = th.messages.filter((m) => m.role !== "note").slice(-8).map(said);
  return (
    `(New session — the previous one filled its context. The look itself is live: call get_look.)\n` +
    `Recent conversation:\n${recent.join("\n")}\n\n`
  );
}
function compactedHandoff(th: Thread, note: string) {
  const last = th.messages.filter((m) => m.role !== "note").slice(-2).map(said);
  return (
    `(New session — the previous one was compacted. The look itself is live: call get_look.)\n` +
    `Handover note from the previous session:\n${note}\n\nLast exchange:\n${last.join("\n")}\n\n`
  );
}

const COMPACT_ASK =
  "(ZCLIP: compacting) Your context is filling up — a fresh session will continue this edit from a note you write now. " +
  "Under 180 words, in the language the owner writes in: the owner's goal for this clip, what they liked and rejected " +
  "(with the setting numbers that mattered), what has been tried, and what's next. Do not call tools. Output only the note.";

/** The CLI's MCP + env + cwd — shared by chat turns and compacting. */
async function cliContext(origin: string, key: string) {
  const mcp = {
    mcpServers: {
      zclip: {
        type: "stdio",
        command: process.execPath,
        args: [path.join(process.cwd(), "scripts", "post-agent-mcp.mjs")],
        env: { ZCLIP_URL: origin, ZCLIP_KEY: key, ZCLIP_PW: process.env.APP_PASSWORD ?? "" },
      },
    },
  };
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // bill the owner's subscription, not an API key
  delete env.ANTHROPIC_AUTH_TOKEN;
  const cwd = path.join(tmpdir(), "zclip-edit-agent"); // no CLAUDE.md / project settings
  await mkdir(cwd, { recursive: true });
  return { mcp, env, cwd };
}

/** Ask the current session for a handover note, then point the thread at a
 *  new session that starts from it. The MCP config rides along because the
 *  history holds tool calls. Returns the note, or null if it couldn't. */
async function compactThread(th: Thread, bin: string, ctx: Awaited<ReturnType<typeof cliContext>>): Promise<string | null> {
  if (!th.sessionId) return null;
  const args = [
    "-p",
    "--output-format", "json",
    "--model", MODEL,
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify(ctx.mcp),
    "--disable-slash-commands",
    "--no-chrome",
    "--max-turns", "1",
    "--append-system-prompt", SYSTEM,
    "--resume", th.sessionId,
  ];
  const out = await new Promise<string>((resolve) => {
    const child = spawn(bin, args, { cwd: ctx.cwd, env: ctx.env, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    let buf = "";
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(""));
    child.on("close", () => {
      clearTimeout(timer);
      resolve(buf);
    });
    child.stdin.end(COMPACT_ASK);
  });
  let note = "";
  try {
    const r = JSON.parse(out) as { is_error?: boolean; result?: string };
    note = !r.is_error && typeof r.result === "string" ? r.result.trim() : "";
  } catch {
    /* not JSON — failed */
  }
  if (!note) return null;
  th.carry = note.slice(0, 2000);
  th.sessionId = null;
  th.sessionNo += 1;
  th.ctxTokens = null;
  th.messages.push({ role: "note", text: `compacted → Claude session ${th.sessionNo}\n${th.carry}`, at: Date.now() });
  await saveThreads().catch(() => {});
  return th.carry;
}

function resolveSrc(src: unknown) {
  if (typeof src !== "string") return null;
  const m = src.match(/^\/api\/clips\?f=([^&]+)/);
  const f = m ? decodeURIComponent(m[1]) : "";
  return m && CLIP_FILE_NAME.test(f) ? path.join(CLIPS_DIR, f) : null;
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const tryBin = (bin: string, fallback?: string) => {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
      child.on("error", (e) => (fallback ? tryBin(fallback) : reject(e)));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() ?? "ffmpeg failed"))));
    };
    tryBin("ffmpeg", "/opt/homebrew/bin/ffmpeg");
  });
}

/** Run a binary and capture stdout (ffprobe / ffmpeg metadata=print). */
function capture(bin: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() ?? `${bin} failed`))));
  });
}

/** Look stats over a picture or a clip — averages of signalstats per frame. */
async function lookStats(file: string, filters = "") {
  const out = await capture("ffmpeg", [
    "-hide_banner", "-i", file,
    "-vf", `${filters ? `${filters},` : ""}signalstats,metadata=print:file=-`,
    "-f", "null", "-",
  ]);
  const acc: Record<string, number[]> = {};
  for (const m of out.matchAll(/lavfi\.signalstats\.(YAVG|YLOW|YHIGH|SATAVG|UAVG|VAVG)=([\d.]+)/g)) {
    (acc[m[1]] ??= []).push(Number(m[2]));
  }
  const avg = (k: string) => {
    const v = acc[k] ?? [];
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : NaN;
  };
  return `luma avg ${avg("YAVG")} (p10 ${avg("YLOW")} · p90 ${avg("YHIGH")}) · sat ${avg("SATAVG")} · Cb ${avg("UAVG")} · Cr ${avg("VAVG")}`;
}

async function probe(file: string) {
  const out = await capture("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", file,
  ]);
  const j = JSON.parse(out) as { streams?: { width?: number; height?: number; avg_frame_rate?: string }[]; format?: { duration?: string } };
  const st = j.streams?.[0] ?? {};
  const [n, d] = String(st.avg_frame_rate ?? "0/1").split("/").map(Number);
  return { w: st.width ?? 0, h: st.height ?? 0, fps: d ? Math.round((n / d) * 10) / 10 : 0, dur: Number(j.format?.duration ?? 0) };
}

/** Turn the owner's attachments into kept refs (frames on disk + a note). */
async function prepareRefs(key: string, raw: unknown): Promise<RefKept[]> {
  if (!Array.isArray(raw)) return [];
  const dir = path.join(REFS_DIR, key);
  await mkdir(dir, { recursive: true });
  const kept: RefKept[] = [];
  for (const [i, r] of (raw as Record<string, unknown>[]).slice(0, MAX_REFS).entries()) {
    const name = String(r.name ?? `reference ${i + 1}`).slice(0, 80);
    const stamp = `${Date.now()}-${i}`;
    if (r.kind === "image" && typeof r.dataUrl === "string") {
      const m = r.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || m[2].length > 8_000_000) continue;
      const file = path.join(dir, `${stamp}.jpg`);
      // Normalise to a ≤1024px JPEG — what Claude sees, and what we keep.
      const src = path.join(dir, `${stamp}-in.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      await writeFile(src, Buffer.from(m[2], "base64"));
      await runFfmpeg(["-y", "-i", src, "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", file]);
      await rm(src, { force: true });
      kept.push({ label: name, files: [file], note: `Reference ${i + 1} — photo "${name}": ${await lookStats(file)}` });
    } else if (r.kind === "video") {
      const vp = resolveSrc(r.src);
      if (!vp) continue;
      const info = await probe(vp);
      const files: string[] = [];
      const ts = [0.125, 0.375, 0.625, 0.875].map((f) => Math.max(0, info.dur * f));
      for (const [j, t] of ts.entries()) {
        const file = path.join(dir, `${stamp}-${j}.jpg`);
        await runFfmpeg(["-y", "-ss", t.toFixed(2), "-i", vp, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", file]);
        files.push(file);
      }
      const stats = await lookStats(vp, "fps=2");
      kept.push({
        label: name,
        files,
        note:
          `Reference ${i + 1} — video "${name}" (${info.dur.toFixed(1)}s, ${info.w}×${info.h}, ${info.fps}fps): ` +
          `4 frames at ${ts.map((t) => `${t.toFixed(1)}s`).join(", ")} · ${stats}`,
      });
    }
  }
  return kept;
}

/** Image + note blocks for kept refs (fresh ones, or re-attached on a roll). */
async function refBlocks(refs: RefKept[], intro: string): Promise<Block[]> {
  if (!refs.length) return [];
  const blocks: Block[] = [{ type: "text", text: intro }];
  for (const r of refs) {
    blocks.push({ type: "text", text: r.note });
    for (const f of r.files) {
      try {
        blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(f)).toString("base64") } });
      } catch {
        /* frame cleared — the note still stands */
      }
    }
  }
  return blocks;
}

/** Before | after still at `t` seconds into the kept clip (JPEG, 1080×960). */
async function renderFrame(l: Live, tRel: unknown) {
  if (!l.srcPath) throw new Error("No take is open in the edit panel");
  const s = l.look;
  const kept = (s.trimEnd ?? s.trimStart + 3) - s.trimStart;
  const tn = Number(tRel);
  const t = Math.min(Math.max(0, Number.isFinite(tn) ? tn : kept / 2), Math.max(0, kept - 0.05));
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const lutPath = isNeutral(s.grade) ? null : path.join(tmpdir(), `zclip-agent-lut-${stamp}.cube`);
  const out = path.join(tmpdir(), `zclip-agent-frame-${stamp}.jpg`);
  if (lutPath) await writeFile(lutPath, lutCube(s.grade));
  const after = buildPostGraph(s, lutPath, true).graph;
  const before = buildPostGraph({ ...DEFAULT_SETTINGS, zoom: s.zoom, cx: s.cx, cy: s.cy }, null, true).graph;
  const graph =
    `[0:v]split=2[in0][in1];` +
    `${before.replace("[0:v]", "[in0]").replace(/\[v\]$/, "[bf]")};` +
    `${after.replace("[0:v]", "[in1]").replace(/\[v\]$/, "[af]")};` +
    `[bf]scale=540:960[bs];[af]scale=540:960[as];[bs][as]hstack=2[out]`;
  try {
    await runFfmpeg(["-y", "-ss", (s.trimStart + t).toFixed(3), "-i", l.srcPath, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-q:v", "4", out]);
    const image = (await readFile(out)).toString("base64");
    // Same stats as the references get, on the RIGHT (edited) half.
    const stats = await lookStats(out, "crop=iw/2:ih:iw/2:0").catch(() => "");
    return { image, mimeType: "image/jpeg", t, stats };
  } finally {
    await rm(out, { force: true });
    if (lutPath) await rm(lutPath, { force: true });
  }
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "The edit agent is a local dev tool" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" && KEY_RE.test(body.key) ? body.key : null;
  if (!key) return Response.json({ error: "Missing session key" }, { status: 400 });
  const l = live(key);

  switch (body.action) {
    case "look":
      return Response.json({ look: l.look });
    case "patch": {
      l.look = sanitizeSettings(body.patch, l.look);
      emit(l, { t: "look", look: l.look });
      return Response.json({ look: l.look });
    }
    case "frame":
      try {
        return Response.json(await renderFrame(l, body.t));
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : "Frame render failed" }, { status: 502 });
      }
    case "thread": {
      const th = (await threads())[key];
      return Response.json({ thread: th ?? null });
    }
    case "reset": {
      const all = await threads();
      delete all[key];
      await saveThreads();
      return Response.json({ ok: true });
    }
    case "compact": {
      const th = (await threads())[key];
      if (!th?.sessionId) return Response.json({ error: "Nothing to compact yet" }, { status: 400 });
      if (l.busy) return Response.json({ error: "Still working on the last message" }, { status: 409 });
      const bin = await findClaude();
      if (!bin) return Response.json({ error: "Claude Code CLI not found" }, { status: 500 });
      l.busy = true;
      try {
        const note = await compactThread(th, bin, await cliContext(new URL(req.url).origin, key));
        return note
          ? Response.json({ ok: true, note, sessionNo: th.sessionNo })
          : Response.json({ error: "Claude couldn't write the handover note — try again" }, { status: 502 });
      } finally {
        l.busy = false;
      }
    }
    case "chat":
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  // ── chat ────────────────────────────────────────────────────────────────
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  const srcPath = resolveSrc(body.src);
  if (!srcPath) return Response.json({ error: "Open a saved take first" }, { status: 400 });
  if (l.busy) return Response.json({ error: "Still working on the last message" }, { status: 409 });
  const bin = await findClaude();
  if (!bin) {
    return Response.json(
      { error: "Claude Code CLI not found — install it and run `claude` once to log in (or set CLAUDE_CLI_PATH)." },
      { status: 500 },
    );
  }
  l.look = sanitizeSettings(body.look, l.look);
  l.srcPath = srcPath;
  const all = await threads();
  const th = (all[key] ??= { sessionId: null, sessionNo: 1, messages: [], ctxTokens: null, ctxWindow: null });
  const full = th.ctxTokens && th.ctxWindow ? th.ctxTokens / th.ctxWindow : 0;
  let rolled = false;
  if (th.sessionId && full > ROLL_AT) {
    th.sessionId = null;
    th.sessionNo += 1;
    rolled = true;
  }
  const carry = th.carry;
  th.carry = undefined;
  const prefix = carry ? compactedHandoff(th, carry) : rolled ? handoff(th) : "";
  let fresh: RefKept[] = [];
  try {
    fresh = await prepareRefs(key, body.refs);
  } catch (e) {
    return Response.json({ error: `Couldn't read an attachment: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
  if (fresh.length) th.refs = fresh.slice(-2);
  // On a roll, the new session hasn't seen the last references — re-attach.
  const carried = (rolled || carry) && !fresh.length ? (th.refs ?? []) : [];
  const content: Block[] = [
    ...(prefix ? [{ type: "text" as const, text: prefix }] : []),
    ...(await refBlocks(carried, "References the owner attached earlier (re-attached for the new session):")),
    ...(await refBlocks(fresh, "The owner attached these references:")),
    { type: "text", text },
  ];
  th.messages.push({ role: "user", text, refs: fresh.map((r) => r.label), at: Date.now() });
  await saveThreads();

  const ctx = await cliContext(new URL(req.url).origin, key);
  const { mcp, env, cwd } = ctx;

  const enc = new TextEncoder();
  l.busy = true;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (e: object) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true; // the panel went away; the turn still finishes and saves
        }
      };
      const listener = (e: object) => send(e);
      l.listeners.add(listener);
      let answer = "";
      const tools: string[] = [];

      const attempt = (resume: string | null, blocks: Block[], retried: boolean) => {
        const args = [
          "-p",
          "--input-format", "stream-json",
          "--output-format", "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model", MODEL,
          "--tools", "",
          "--setting-sources", "",
          "--strict-mcp-config",
          "--mcp-config", JSON.stringify(mcp),
          "--allowedTools", "mcp__zclip__get_look", "mcp__zclip__set_look", "mcp__zclip__view_frame",
          "--disable-slash-commands",
          "--no-chrome",
          "--max-turns", "24",
          "--append-system-prompt", SYSTEM,
          ...(resume ? ["--resume", resume] : []),
        ];
        const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
        const timer = setTimeout(() => child.kill("SIGTERM"), TURN_TIMEOUT_MS);
        child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: blocks } }) + "\n");
        let buf = "";
        let stderr = "";
        let result: Record<string, unknown> | null = null;
        child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-3000)));
        const onLine = (line: string) => {
          if (!line.trim()) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "system" && ev.subtype === "init" && typeof ev.session_id === "string") {
            th.sessionId = ev.session_id;
            return;
          }
          if (ev.type === "stream_event") {
            const e = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
            if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
              answer += e.delta.text;
              send({ t: "text", d: e.delta.text });
            }
            return;
          }
          const content = (ev.message as { content?: unknown[] } | undefined)?.content;
          if (ev.type === "assistant" && Array.isArray(content)) {
            for (const b of content as { type: string; id?: string; name?: string }[]) {
              if (b.type === "tool_use") {
                const name = String(b.name ?? "").replace(/^mcp__zclip__/, "");
                tools.push(name);
                send({ t: "tool", id: b.id, name });
              }
            }
            // Separate the text of successive model turns.
            if (answer && !answer.endsWith("\n")) answer += "\n";
            return;
          }
          if (ev.type === "user" && Array.isArray(content)) {
            for (const b of content as { type: string; tool_use_id?: string; is_error?: boolean }[]) {
              if (b.type === "tool_result") send({ t: "toolDone", id: b.tool_use_id, ok: !b.is_error });
            }
            return;
          }
          if (ev.type === "result") result = ev;
        };
        child.stdout.on("data", (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            onLine(buf.slice(0, i));
            buf = buf.slice(i + 1);
          }
        });
        child.on("error", (e) => stderr += String(e));
        child.on("close", async (code) => {
          clearTimeout(timer);
          if (buf.trim()) onLine(buf);
          const r = result as {
            is_error?: boolean;
            result?: string;
            total_cost_usd?: number;
            usage?: { iterations?: Record<string, number>[] } & Record<string, number>;
            modelUsage?: Record<string, { contextWindow?: number; inputTokens?: number; cacheReadInputTokens?: number }>;
          } | null;
          const failText = `${r?.result ?? ""} ${stderr}`;
          // A session that can't be resumed (cleared, or another machine):
          // start over once with the handoff instead of failing the message.
          if (!retried && resume && /no conversation found|session.*not found/i.test(failText)) {
            th.sessionId = null;
            th.sessionNo += 1;
            answer = "";
            attempt(
              null,
              [{ type: "text", text: handoff(th) }, ...blocks.filter((b) => b.type === "image" || !b.text.startsWith("(New session"))],
              true,
            );
            return;
          }
          if (r && !answer && typeof r.result === "string") {
            answer = r.result;
            send({ t: "text", d: r.result });
          }
          // The real context size = the LAST request's input + cache (usage
          // sums every tool round-trip; qa/social/server.js learned this).
          const u = (r?.usage ?? {}) as Record<string, number> & { iterations?: Record<string, number>[] };
          const it = Array.isArray(u.iterations) && u.iterations.length ? u.iterations[u.iterations.length - 1] : u;
          const ctxTokens =
            (it.input_tokens ?? 0) + (it.cache_read_input_tokens ?? 0) + (it.cache_creation_input_tokens ?? 0) || null;
          const main = Object.values(r?.modelUsage ?? {}).sort(
            (a, b) => (b.cacheReadInputTokens ?? 0) + (b.inputTokens ?? 0) - ((a.cacheReadInputTokens ?? 0) + (a.inputTokens ?? 0)),
          )[0];
          th.ctxTokens = ctxTokens;
          th.ctxWindow = main?.contextWindow ?? th.ctxWindow ?? null;
          const ok = code === 0 && !r?.is_error;
          const reply = answer.trim() || (ok ? "(done)" : `오류: ${failText.trim().slice(-300) || `exit ${code}`}`);
          th.messages.push({ role: "assistant", text: reply, tools, at: Date.now() });
          if (th.messages.length > 200) th.messages = th.messages.slice(-200);
          await saveThreads().catch(() => {});
          if (!ok) send({ t: "error", message: reply });
          // Past ROLL_AT → compact now, while the owner reads the reply, so
          // the next message starts a light session without waiting.
          if (ok && th.ctxTokens && th.ctxWindow && th.ctxTokens / th.ctxWindow > ROLL_AT) {
            send({ t: "compacting" });
            const note = await compactThread(th, bin, ctx);
            send(note ? { t: "compacted", sessionNo: th.sessionNo, note } : { t: "compactFailed" });
          }
          send({
            t: "done",
            ok,
            ctxTokens: th.ctxTokens,
            ctxWindow: th.ctxWindow,
            sessionNo: th.sessionNo,
            cost: r?.total_cost_usd ?? null,
          });
          l.listeners.delete(listener);
          l.busy = false;
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
      };

      send({ t: "start", sessionNo: th.sessionNo, rolled });
      attempt(th.sessionId, content, false);
    },
    cancel() {
      l.busy = false;
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
