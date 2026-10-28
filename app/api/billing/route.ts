/**
 * POST {items: [{provider, jobId, submittedAt?, videoInput?}]} → the actual
 * cost of each finished generation (lib/billing.ts), so the studio can
 * replace its seconds × rate estimate with the provider's number. Up to 20
 * items per call; each one independent (a slow provider doesn't block).
 *
 * GET ?since=<ms>[&openai=1] → the non-video ledger (stills + text calls,
 * lib/call-ledger.ts) for the dashboard, plus OpenAI's own org bill for the
 * same period when an OPENAI_ADMIN_KEY exists.
 */

import { checkPassword, unauthorized } from "@/lib/auth";
import { actualCost, openaiOrgCosts } from "@/lib/billing";
import { jobHadVideoInput, readCalls } from "@/lib/call-ledger";
import { PROVIDERS, type ProviderName } from "@/lib/config";
import { resolveKey } from "@/lib/server-keys";

export async function GET(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  const q = new URL(req.url).searchParams;
  const since = Number(q.get("since")) || 0;
  const calls = await readCalls(since);
  let openai: Awaited<ReturnType<typeof openaiOrgCosts>> | { error: string } | null = null;
  const admin = q.get("openai") === "1" ? resolveKey(req, "OPENAI_ADMIN_KEY") : null;
  if (admin) {
    try {
      openai = await openaiOrgCosts(admin, since, Date.now(), resolveKey(req, "OPENAI_API_KEY"));
    } catch (e) {
      openai = { error: e instanceof Error ? e.message : "Costs API failed" };
    }
  }
  return Response.json({ calls, openai });
}

export async function POST(req: Request) {
  if (!checkPassword(req)) return unauthorized();
  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20) as Record<string, unknown>[];
  const falBilling = resolveKey(req, "FAL_BILLING_KEY");
  const results = await Promise.all(
    items.map(async (it) => {
      const provider = String(it.provider ?? "");
      const jobId = String(it.jobId ?? "");
      const info = PROVIDERS[provider as ProviderName];
      try {
        const r = await actualCost(
          provider,
          jobId,
          { main: info ? resolveKey(req, info.envVar) : null, falBilling },
          {
            submittedAt: Number(it.submittedAt) || undefined,
            // /api/generate wrote it down at submit — no call site has to
            videoInput: it.videoInput === true || (provider === "seedance" && (await jobHadVideoInput(jobId))),
          },
        );
        return { jobId, ...r };
      } catch (e) {
        return { jobId, state: "unsupported", reason: e instanceof Error ? e.message : "lookup failed" };
      }
    }),
  );
  return Response.json({ results });
}
