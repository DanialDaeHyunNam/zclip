/**
 * Custom-event wrapper over Vercel Web Analytics — the no-op wrapper planned in
 * the two-track distribution work.
 *
 * Contract (keep it strict — the repo is open source and the public copy
 * promises prompts/keys are never logged):
 *   - No-op on local/self-host. It gates on the SAME `data-hosted="1"` stamp
 *     the rest of the client reads (set server-side from `isCloud()` in
 *     app/layout.tsx; `VERCEL` is server-only so we can't read it here).
 *   - Props are COARSE, NON-PII only — a provider name, a flow kind, a boolean.
 *     NEVER pass prompt text, a look/identity description, an API key, a URL,
 *     a filename, or anything a user typed. When in doubt, don't send it.
 *   - Analytics must never break the app: any failure is swallowed.
 *
 * Page views are automatic via <ZAnalytics/>; this is only for the handful of
 * product events worth counting (e.g. track("generate", { provider })).
 */
import { track as vercelTrack } from "@vercel/analytics";

type EventProps = Record<string, string | number | boolean>;

function hosted(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.hosted === "1"
  );
}

export function track(event: string, props?: EventProps): void {
  if (!hosted()) return; // local / self-host: silent no-op
  try {
    vercelTrack(event, props);
  } catch {
    // analytics is never load-bearing — a failure must not surface to the user
  }
}
