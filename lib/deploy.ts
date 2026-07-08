/**
 * Deploy-environment detection — the one place that answers
 * "are we the public cloud demo, or a real local install?".
 *
 * ZCLIP is a LOCAL-ONLY studio: the in-UI key writer and the GRAB tool
 * refuse to run outside `NODE_ENV=development`, and video generation spends
 * real money against whoever's keys are configured. So the public Vercel
 * deployment is an *about page*, not a working studio — visitors who try to
 * open the studio get the local-install guide instead (see
 * `app/run-local-guide.tsx`, wired in `app/chat/page.tsx`).
 *
 * Signal choice: `process.env.VERCEL` is set to "1" automatically on every
 * Vercel build/runtime and NOWHERE else — so `bun dev` AND a local
 * `bun run build && bun start` both read as local (the studio works), while
 * only an actual Vercel deploy reads as cloud. `ZCLIP_CLOUD` is an explicit
 * override for previewing the gated experience locally (`ZCLIP_CLOUD=1 bun dev`)
 * or force-unlocking a self-hosted deploy you trust (`ZCLIP_CLOUD=0`).
 *
 * Server-only: `VERCEL` is not a `NEXT_PUBLIC_*` var, so this must be called
 * from server components / route handlers and the result passed to the client.
 */
export function isCloud(): boolean {
  const override = process.env.ZCLIP_CLOUD;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  return process.env.VERCEL === "1";
}
