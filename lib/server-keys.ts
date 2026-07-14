import { isCloud } from "@/lib/deploy";

/**
 * Per-request provider-key resolution — the heart of hosted pass-through
 * (docs/HOSTED.md §3.1).
 *
 * Hosted visitors keep their keys in localStorage and send the one key the
 * request needs in the `x-provider-key` header; these helpers hand it to
 * the adapter as an explicit argument. The key is never written anywhere
 * server-side and must never appear in an error message or log line.
 *
 * Fallback rules:
 *   - header present → use it (any deployment; an explicit key always wins)
 *   - no header, local/self-host → process.env (the .env.local flow)
 *   - no header, cloud → REFUSED. Never fall back to env on the public
 *     deploy: a provider key left in Vercel env would silently bill the
 *     owner for anonymous visitors' generations.
 * Owner-infrastructure vars (BLOB_READ_WRITE_TOKEN, APP_PASSWORD) are not
 * user keys and intentionally bypass this module.
 */

export const PROVIDER_KEY_HEADER = "x-provider-key";

// Printable ASCII, no whitespace — matches /api/keys' KEY_SHAPE. Rejecting
// anything else keeps junk out of upstream Authorization headers.
const KEY_SHAPE = /^[\x21-\x7E]{8,300}$/;

export function resolveKey(req: Request, envVar: string): string | null {
  const header = req.headers.get(PROVIDER_KEY_HEADER);
  if (header && KEY_SHAPE.test(header)) return header;
  if (isCloud()) return null;
  return process.env[envVar] ?? null;
}

export function missingKeyMessage(envVar: string, label: string): string {
  return isCloud()
    ? `No ${label} key — add your ${envVar} in the key panel. It stays in this browser and rides each request; the server never stores it.`
    : `${envVar} is not set — add it in the UI key panel (or .env.local).`;
}

/** Consistent loud refusal when no key is available. `label` is the
 *  human name shown in the key panel (e.g. "Gemini", "OpenAI"). 400, not
 *  401 — the client reads 401 as "password rejected" and opens the gate. */
export function missingKey(envVar: string, label: string): Response {
  return Response.json(
    { error: missingKeyMessage(envVar, label) },
    { status: 400 },
  );
}
