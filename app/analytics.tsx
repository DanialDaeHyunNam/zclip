"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics — mounted ONLY on the hosted deploy (gated by
 * `isCloud()` in app/layout.tsx, so local/self-host never loads the script
 * and makes zero external calls). Cookieless, no PII.
 *
 * `beforeSend` strips the query string before anything leaves the browser:
 * `/depth?src=…&label=…` and the video proxy carry temp-host URLs / refs in
 * `?…`, and the public copy promises those are never logged (same rule as the
 * key-never-in-URL firewall in docs/HOSTED.md). Page PATHS only.
 */
export function ZAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => ({ ...event, url: event.url.split("?")[0] })}
    />
  );
}
