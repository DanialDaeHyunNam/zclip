import { VERSION } from "@/lib/version";

/**
 * Returns this deployment's version. A locally-running copy fetches the
 * canonical deployment's copy of this route cross-origin to detect updates, so
 * allow any origin and never cache — the value is non-sensitive and must stay
 * fresh. Unlike the store/keys/grab routes, this is NOT dev-gated: the hosted
 * deploy is exactly who needs to answer it.
 */
export function GET() {
  return Response.json(
    { version: VERSION },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
