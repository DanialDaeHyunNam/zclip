import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Local filesystem store for ZCLIP's browser-side data (sessions, gallery,
 * custom assets, …). ZCLIP is a LOCAL tool, so the dev server can persist to
 * disk — which fixes the two localStorage failure modes: the ~5MB quota
 * (sessions carry base64 frames) and the per-port origin split (localhost:3000
 * and :3001 keep separate localStorage; a file in the project dir is shared).
 *
 * Dev-only, like the key writer and GRAB tool — refuses in production so a
 * deployment never reads/writes the host's disk. See lib/store.ts for the
 * client that talks to this route (with a localStorage fallback for cloud).
 *
 * Shape on disk: a flat { "hooklab.<key>": "<json string>" } map — the same
 * key/value pairs the app used to keep in localStorage.
 */

const isDev = () => process.env.NODE_ENV === "development";
const DIR = path.join(process.cwd(), ".zclip-data");
const FILE = path.join(DIR, "store.json");

export async function GET() {
  if (!isDev()) {
    return NextResponse.json({ error: "filesystem store is dev-only" }, { status: 403 });
  }
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    // No file yet (or unreadable) — an empty store, not an error.
    return NextResponse.json({});
  }
}

export async function POST(req: Request) {
  if (!isDev()) {
    return NextResponse.json({ error: "filesystem store is dev-only" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected a { key: value } object" }, { status: 400 });
  }
  await fs.mkdir(DIR, { recursive: true });
  // Atomic write: temp file + rename, so a crash mid-write can't corrupt the
  // store (readers either see the old complete file or the new complete one).
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body), "utf8");
  await fs.rename(tmp, FILE);
  return NextResponse.json({ ok: true });
}
