/**
 * Actual cost of ONE finished generation, from the provider — so the spend
 * ledger matches the bill instead of seconds × a guessed rate (owner
 * 2026-10-28: "match the real bill; if it can be identical, it must be").
 * Mechanisms + prices from each provider's official docs, read 2026-10-28
 * (lab/HYPERREAL.md "Research — billing"):
 *
 *  - xAI (Grok Imagine video): GET /v1/videos/{id} → usage.cost_in_usd_ticks
 *    (USD = ticks / 1e10) — the billed amount after discounts. "billed"
 *  - Runway (Act-Two): GET /v1/tasks/{id} → cost.credits on a finished task
 *    (USD = credits × $0.01; may drop later when credits are refunded, so it
 *    is re-read). "billed"
 *  - BytePlus ModelArk (Seedance): task usage.completion_tokens × the
 *    published per-1M-token price (with / without video input). Records live
 *    7 days. "units" — exact units × official price.
 *  - fal (Kling 4.0, Lucy): GET api.fal.ai/v1/models/billing-events?request_id
 *    → cost_total (USD, after discount). Needs a key with the BILLING or FULL
 *    preset (FAL_BILLING_KEY) — a normal inference key is refused. "billed"
 *  - Kling official (KLING_API_KEY): POST /account/billing/balance →
 *    deduction_amount per task_id (+ currency; a resource-package plan
 *    deducts units instead → /account/billing/package, not money). "billed"
 *  - Veo / Sora: no per-request bill — stays an estimate.
 *
 * Server-only (keys).
 */

import { jwt as klingJwt } from "@/lib/providers/kling";

export type CostSource = "billed" | "units" | "est";
export type BillingResult =
  | { state: "done"; costUsd: number; source: CostSource }
  | { state: "pending" }
  | { state: "unsupported"; reason: string };

/** USD per 1M tokens — BytePlus ModelArk pricing page (2026-10-28).
 *  [without video input, with video input] by resolution tier. */
const SEEDANCE_PRICE: { match: RegExp; low: [number, number]; p1080?: [number, number] }[] = [
  { match: /seedance-2-0-mini/, low: [3.5, 2.1] },
  { match: /seedance-2-0-fast/, low: [7.0, 4.3], p1080: [7.7, 4.7] }, // fast isn't listed separately — priced as 2.0
  { match: /seedance-2-0/, low: [7.0, 4.3], p1080: [7.7, 4.7] },
  { match: /seedance-1-0-pro/, low: [2.5, 2.5] },
];

const RUNWAY_USD_PER_CREDIT = 0.01;

export async function actualCost(
  provider: string,
  jobId: string,
  keys: { main: string | null; falBilling: string | null },
  ctx: { submittedAt?: number; videoInput?: boolean } = {},
): Promise<BillingResult> {
  if (!/^[\w./:-]+$/.test(jobId)) return { state: "unsupported", reason: "Malformed job id" };
  switch (provider) {
    case "grok": {
      if (!keys.main) return { state: "unsupported", reason: "XAI_API_KEY missing" };
      const r = await fetch(`https://api.x.ai/v1/videos/${jobId}`, {
        headers: { authorization: `Bearer ${keys.main}` },
      });
      if (!r.ok) return { state: "unsupported", reason: `xAI ${r.status}` };
      const j = await r.json();
      const ticks = Number(j?.usage?.cost_in_usd_ticks);
      if (j?.status !== "done") return { state: "pending" };
      return Number.isFinite(ticks) ? { state: "done", costUsd: ticks / 1e10, source: "billed" } : { state: "pending" };
    }
    case "runway": {
      if (!keys.main) return { state: "unsupported", reason: "RUNWAYML_API_SECRET missing" };
      const r = await fetch(`https://api.dev.runwayml.com/v1/tasks/${jobId}`, {
        headers: { authorization: `Bearer ${keys.main}`, "x-runway-version": "2024-11-06" },
      });
      if (!r.ok) return { state: "unsupported", reason: `Runway ${r.status}` };
      const j = await r.json();
      const credits = Number(j?.cost?.credits);
      if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(j?.status)) return { state: "pending" };
      return Number.isFinite(credits)
        ? { state: "done", costUsd: credits * RUNWAY_USD_PER_CREDIT, source: "billed" }
        : { state: "unsupported", reason: "Runway task has no cost field" };
    }
    case "seedance": {
      if (!keys.main) return { state: "unsupported", reason: "ARK_API_KEY missing" };
      const r = await fetch(`https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${jobId}`, {
        headers: { authorization: `Bearer ${keys.main}` },
      });
      if (!r.ok) return { state: "unsupported", reason: `ModelArk ${r.status} (records are kept 7 days)` };
      const j = await r.json();
      if (j?.status !== "succeeded") return j?.status === "failed" ? { state: "done", costUsd: 0, source: "billed" } : { state: "pending" };
      const tokens = Number(j?.usage?.completion_tokens);
      const model = String(j?.model ?? "");
      const price = SEEDANCE_PRICE.find((p) => p.match.test(model));
      if (!Number.isFinite(tokens) || !price) return { state: "unsupported", reason: `No price for ${model || "model"}` };
      const tier = /1080/.test(String(j?.resolution ?? "")) && price.p1080 ? price.p1080 : price.low;
      const perM = ctx.videoInput ? tier[1] : tier[0];
      return { state: "done", costUsd: (tokens * perM) / 1e6, source: "units" };
    }
    case "kling": {
      if (!keys.main) return { state: "unsupported", reason: "KLING_API_KEY missing" };
      const taskId = jobId.split(":", 2)[1] ?? jobId; // "<endpoint>:<task_id>"
      const start = (ctx.submittedAt ?? Date.now() - 23 * 3600_000) - 10 * 60_000;
      const lookup = async (kind: "balance" | "package") => {
        const r = await fetch(`https://api-singapore.klingai.com/account/billing/${kind}`, {
          method: "POST",
          headers: { authorization: `Bearer ${klingJwt(keys.main!)}`, "content-type": "application/json" },
          body: JSON.stringify({ start_time: start, end_time: Date.now(), limit: 500 }),
        });
        if (!r.ok) throw new Error(`Kling billing ${r.status}`);
        const rows: Record<string, unknown>[] = (await r.json())?.data?.result?.detail ?? [];
        return rows.find((x) => x.task_id === taskId);
      };
      const row = await lookup("balance");
      if (!row) {
        const unit = await lookup("package");
        return unit
          ? { state: "unsupported", reason: `Kling took ${unit.deduction_amount} units from a resource package — units, not dollars` }
          : { state: "pending" }; // deductions land after the task finishes
      }
      if (row.currency !== "USD") {
        return { state: "unsupported", reason: `Kling deducted ${row.deduction_amount} ${row.currency ?? "?"} — not USD` };
      }
      const cost = Number(row.deduction_amount);
      return Number.isFinite(cost) ? { state: "done", costUsd: cost, source: "billed" } : { state: "pending" };
    }
    case "kling4":
    case "lucy": {
      if (!keys.falBilling) {
        return { state: "unsupported", reason: "Add FAL_BILLING_KEY (a fal key with the BILLING preset) to match fal bills" };
      }
      // fal caps one query at 90 days — ask a 2-day window around the submit
      // so July takes aren't refused for "range too long".
      const from = (ctx.submittedAt ?? Date.now() - 23 * 3600_000) - 10 * 60_000;
      const start = new Date(from).toISOString();
      const end = new Date(Math.min(Date.now(), from + 2 * 86_400_000)).toISOString();
      const r = await fetch(
        `https://api.fal.ai/v1/models/billing-events?request_id=${encodeURIComponent(jobId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: { authorization: `Key ${keys.falBilling}` } },
      );
      if (!r.ok) return { state: "unsupported", reason: `fal billing ${r.status}` };
      const j = await r.json();
      const rows: Record<string, unknown>[] = Array.isArray(j?.billing_events)
        ? j.billing_events
        : Array.isArray(j?.items)
          ? j.items
          : Array.isArray(j)
            ? j
            : [];
      const row = rows.find((x) => x.request_id === jobId) ?? rows[0];
      const cost = Number(row?.cost_total);
      return row && Number.isFinite(cost) ? { state: "done", costUsd: cost, source: "billed" } : { state: "pending" };
    }
    default:
      return { state: "unsupported", reason: "No per-request billing for this provider" };
  }
}

/** The OpenAI project that holds `apiKey` — matched by the last 4 chars of
 *  the redacted key the admin API lists. An org usually runs more than
 *  ZCLIP, so the org-wide bill alone would mostly be someone else's. */
const projectCache = new Map<string, { id: string; name: string; createdMs: number } | null>();
async function projectOfKey(
  adminKey: string,
  apiKey: string,
): Promise<{ id: string; name: string; createdMs: number } | null> {
  const tail = apiKey.slice(-4);
  if (projectCache.has(tail)) return projectCache.get(tail)!;
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${adminKey}` } });
    if (!r.ok) throw new Error(`OpenAI admin API ${r.status}${r.status === 401 || r.status === 403 ? " — needs an Admin key" : ""}`);
    return r.json();
  };
  const projects: { id: string; name: string; created_at: number; status?: string }[] =
    (await get("https://api.openai.com/v1/organization/projects?limit=100"))?.data ?? [];
  let found: { id: string; name: string; createdMs: number } | null = null;
  for (const p of projects) {
    const keys: { redacted_value?: string }[] =
      (await get(`https://api.openai.com/v1/organization/projects/${p.id}/api_keys?limit=100`))?.data ?? [];
    if (keys.some((k) => k.redacted_value?.endsWith(tail))) {
      found = { id: p.id, name: p.name, createdMs: p.created_at * 1000 };
      break;
    }
  }
  projectCache.set(tail, found);
  return found;
}

/** OpenAI's own bill — Costs API (GET /v1/organization/costs, daily UTC
 *  buckets, by line item), narrowed to
 *  the project that holds ZCLIP's OPENAI_API_KEY when it can be found, from
 *  the day that project began. Nothing per request: the dashboard sets it
 *  beside ZCLIP's OpenAI ledger lines for the same days, so a gap shows up as
 *  a gap. Needs an OPENAI_ADMIN_KEY of that org. */
export async function openaiOrgCosts(
  adminKey: string,
  startMs: number,
  endMs: number,
  apiKey?: string | null,
): Promise<{
  usd: number;
  lines: { lineItem: string; usd: number }[];
  startMs: number;
  project: { id: string; name: string } | null;
}> {
  const project = apiKey ? await projectOfKey(adminKey, apiKey) : null;
  const from = Math.max(startMs, project?.createdMs ?? 0);
  const start = Math.max(Math.floor(from / 1000), Math.floor(endMs / 1000) - 179 * 86_400);
  const base =
    `https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${Math.ceil(endMs / 1000)}` +
    `&bucket_width=1d&limit=180&group_by=line_item` +
    (project ? `&project_ids=${encodeURIComponent(project.id)}` : "");
  const lines = new Map<string, number>();
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: Response = await fetch(base + (page ? `&page=${encodeURIComponent(page)}` : ""), {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    if (!r.ok) throw new Error(`OpenAI Costs API ${r.status}${r.status === 401 || r.status === 403 ? " — needs an Admin key" : ""}`);
    const body: { data?: { results?: { amount?: { value?: number }; line_item?: string | null }[] }[]; has_more?: boolean; next_page?: string | null } =
      await r.json();
    for (const bucket of body?.data ?? []) {
      for (const res of bucket?.results ?? []) {
        const usd = Number(res?.amount?.value) || 0;
        const key = String(res?.line_item ?? "other");
        lines.set(key, (lines.get(key) ?? 0) + usd);
      }
    }
    if (!body?.has_more || !body?.next_page) break;
    page = body.next_page ?? null;
  }
  const list = [...lines].map(([lineItem, usd]) => ({ lineItem, usd })).sort((a, b) => b.usd - a.usd);
  return {
    usd: list.reduce((s, l) => s + l.usd, 0),
    lines: list,
    startMs: start * 1000,
    project: project && { id: project.id, name: project.name },
  };
}
