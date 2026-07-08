import { REPO_URL } from "./links";

/**
 * Version awareness. There is no version server: the hosted Vercel deploy is
 * ALWAYS the latest (it rebuilds from main on every push). A locally-running
 * copy fetches CANONICAL_URL/api/version and, if the deployed version is newer
 * than its own, prompts an update. See docs/ARCHITECTURE.md § Versioning and
 * CONTRIBUTING/README § Releasing — every release MUST bump this or the
 * "update available" prompt never fires.
 */

// This build's version — inlined from package.json by next.config.ts.
export const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

// The canonical hosted deployment a local copy checks for updates.
export const CANONICAL_URL = "https://zclip.vercel.app";

// The GitHub releases page the version chip links to (release notes = the
// CHANGELOG entries pushed as GitHub releases).
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * Compare dotted numeric versions ("0.2.0" > "0.1.9"). Returns true when
 * `latest` is strictly newer than `current`; non-numeric parts count as 0.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
