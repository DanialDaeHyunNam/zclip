import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KEY_ENV_VARS } from "@/lib/config";
import { checkPassword, unauthorized } from "@/lib/auth";

/**
 * In-UI API key management.
 *   GET  → which keys are present (booleans only — values never leave the
 *          server) and whether this deployment can write them.
 *   POST → local dev only: writes the key into .env.local AND into the
 *          running process env, so it works immediately without a restart.
 * On Vercel the filesystem is ephemeral/read-only, so POST refuses and the
 * UI points at the dashboard instead.
 */

const isDev = () => process.env.NODE_ENV === "development";
// Printable, no whitespace — matches every provider's key format.
const KEY_SHAPE = /^[\x21-\x7E]{8,300}$/;

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  return Response.json({
    writable: isDev(),
    keys: Object.fromEntries(
      KEY_ENV_VARS.map((k) => [k, Boolean(process.env[k])]),
    ),
  });
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  if (!isDev()) {
    return Response.json(
      { error: "Keys can only be saved from local dev. On Vercel: Settings → Environment Variables → redeploy." },
      { status: 400 },
    );
  }

  let envVar: unknown, value: unknown;
  try {
    ({ envVar, value } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    typeof envVar !== "string" ||
    !(KEY_ENV_VARS as readonly string[]).includes(envVar)
  ) {
    return Response.json({ error: "Unknown env var" }, { status: 400 });
  }
  if (typeof value !== "string" || !KEY_SHAPE.test(value)) {
    return Response.json(
      { error: "That doesn't look like an API key (no spaces, 8+ chars)" },
      { status: 400 },
    );
  }

  const envPath = join(process.cwd(), ".env.local");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `${envVar}=${value}`;
  const pattern = new RegExp(`^${envVar}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(envPath, next, "utf8");
  process.env[envVar] = value; // effective immediately, no restart needed

  return Response.json({ ok: true });
}
