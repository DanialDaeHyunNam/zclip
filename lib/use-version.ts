"use client";

import { useEffect, useState } from "react";
import { CANONICAL_URL, VERSION, isNewerVersion } from "./version";

/**
 * True when running on the public deployment (Vercel). Read from the
 * `data-hosted` attribute `app/layout.tsx` stamps on <html> server-side, so it's
 * correct on the first client render (no flash). The studio is client-rendered,
 * so the lazy initializer has no hydration concern.
 */
export function useHosted(): boolean {
  const [hosted] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.hosted === "1",
  );
  return hosted;
}

/**
 * Checks whether a newer version has been deployed. Only runs on a LOCAL copy
 * (the hosted deploy IS the latest, so it never self-checks) — it fetches the
 * canonical deployment's /api/version and compares. Fails silently if offline
 * or blocked (no prompt, no error).
 */
export function useUpdateCheck(hosted: boolean) {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    if (hosted) return;
    let alive = true;
    fetch(`${CANONICAL_URL}/api/version`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.version === "string") setLatest(d.version);
      })
      .catch(() => {
        /* offline / blocked — no update prompt */
      });
    return () => {
      alive = false;
    };
  }, [hosted]);
  return {
    latest,
    current: VERSION,
    hasUpdate: latest != null && isNewerVersion(latest, VERSION),
  };
}
