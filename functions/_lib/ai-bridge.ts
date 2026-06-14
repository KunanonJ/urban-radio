/// <reference types="@cloudflare/workers-types" />

/**
 * AI capability bridge — server-side wrapper that wires the pure provider stubs
 * in `@/lib/ai` to D1, the cost guard, and audit_log.
 *
 * Flow per request:
 *   1. Resolve the station's organization → look up its plan ("free" | "starter" | ...).
 *   2. Compute month-spent USD by SUMming `ai_usage.estimated_cost_usd` for the org
 *      since the first day of the current month (UTC).
 *   3. Run `checkCost` with the plan cap + month spent + the caller's estimated cost.
 *      If denied → return 402.
 *   4. Otherwise invoke the provider (`input.run()`).
 *      On provider error → return 502.
 *   5. On success → INSERT one ai_usage row with the provider's reported usage and
 *      a truncated copy of the request summary, then writeAuditLog (best effort),
 *      and finally return 200 with `{ ok, data, usage, provider }`.
 *
 * Cost-guard semantics intentionally fail-closed when the plan lookup or month-spent
 * query throws — except for month-spent specifically, which falls back to 0 and logs
 * a warning so a transient DB hiccup doesn't lock every AI call out.
 */

import type { AiResult } from '@/lib/ai';
import { PLAN_CAPS, checkCost } from '@/lib/ai';
import type { PlanCap } from '@/lib/ai';
import { writeAuditLog } from './audit-log';
import type { StationGateResult } from './require-station';

export interface AiBridgeInput<TData> {
  capability: 'voice' | 'text' | 'transcribe' | 'anr';
  /** Pre-call cost estimate the cost-guard checks against. Real cost lands in ai_usage. */
  estimatedCostUsd: number;
  /** Capability invocation — the bridge only cares about the AiResult envelope. */
  run: () => Promise<AiResult<TData>>;
  /** Free-form input snapshot, truncated to 256 chars before persistence. */
  requestSummary?: string;
}

type PlanKey = keyof typeof PLAN_CAPS;

const KNOWN_PLANS: ReadonlySet<PlanKey> = new Set<PlanKey>([
  'free',
  'starter',
  'pro',
  'enterprise',
]);

const REQUEST_SUMMARY_MAX = 256;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function truncateSummary(s: string | undefined): string | null {
  if (!s) return null;
  return s.length > REQUEST_SUMMARY_MAX ? s.slice(0, REQUEST_SUMMARY_MAX) : s;
}

/**
 * First day of the current month at 00:00:00 UTC, formatted to match the SQLite
 * `datetime('now')` default-style string ('YYYY-MM-DDTHH:MM:SSZ').
 */
function startOfMonthUtc(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01T00:00:00Z`;
}

function planFromString(raw: unknown): PlanKey {
  if (typeof raw === 'string' && (KNOWN_PLANS as Set<string>).has(raw)) {
    return raw as PlanKey;
  }
  /** Unknown plan name → free (safest, will 402). */
  return 'free';
}

interface StationOrgRow {
  org_id: string;
  plan: string;
}

async function resolveStationOrg(
  db: D1Database,
  stationId: string,
): Promise<{ orgId: string; cap: PlanCap } | null> {
  const row = (await db
    .prepare(
      `SELECT s.org_id AS org_id, o.plan AS plan
       FROM stations s
       JOIN organizations o ON o.id = s.org_id
       WHERE s.id = ?`,
    )
    .bind(stationId)
    .first()) as StationOrgRow | null;

  if (!row) return null;
  const plan = planFromString(row.plan);
  return { orgId: row.org_id, cap: PLAN_CAPS[plan] };
}

async function getMonthSpentUsd(
  db: D1Database,
  orgId: string,
  monthCutoff: string,
): Promise<number> {
  try {
    const row = (await db
      .prepare(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total
         FROM ai_usage
         WHERE org_id = ? AND at >= ?`,
      )
      .bind(orgId, monthCutoff)
      .first()) as { total: number | null } | null;
    return typeof row?.total === 'number' ? row.total : 0;
  } catch (err) {
    console.warn('ai-bridge: month-spent query failed, assuming 0', err);
    return 0;
  }
}

export async function runAiCapability<TData>(
  env: { DB?: D1Database },
  gate: StationGateResult,
  input: AiBridgeInput<TData>,
): Promise<Response> {
  if (!gate.ok) {
    /** Gate failure should be returned by the caller, not us — but be defensive. */
    return gate.response;
  }
  const db = env.DB;
  if (!db) {
    return jsonResponse(500, { ok: false, error: 'Database binding missing' });
  }

  const { stationId, userId } = gate.context;

  /** Plan resolution: failure = 500 (we cannot guard cost without it). */
  let planInfo: { orgId: string; cap: PlanCap } | null;
  try {
    planInfo = await resolveStationOrg(db, stationId);
  } catch (err) {
    console.error('ai-bridge: plan lookup failed', err);
    return jsonResponse(500, { ok: false, error: 'Plan lookup failed' });
  }
  if (!planInfo) {
    return jsonResponse(500, { ok: false, error: 'Station has no organization' });
  }

  const monthCutoff = startOfMonthUtc();
  const monthSpentUsd = await getMonthSpentUsd(db, planInfo.orgId, monthCutoff);

  const decision = checkCost({
    cap: planInfo.cap,
    monthSpentUsd,
    estimatedRequestUsd: input.estimatedCostUsd,
  });

  if (!decision.ok) {
    return jsonResponse(402, {
      ok: false,
      error: 'cap_hit',
      reason: decision.reason,
      remainingUsd: decision.remainingUsd,
      remainingPct: decision.remainingPct,
    });
  }

  /** Provider call — never throws past this point, AiResult is the envelope. */
  let result: AiResult<TData>;
  try {
    result = await input.run();
  } catch (err) {
    console.error('ai-bridge: provider threw', err);
    return jsonResponse(502, {
      ok: false,
      error: err instanceof Error ? err.message : 'Provider failure',
    });
  }

  if (!result.ok) {
    return jsonResponse(502, {
      ok: false,
      error: result.error,
      provider: result.provider,
    });
  }

  /** Persist ai_usage. Failure here must not lose the user's data — surface the
   * provider response anyway, but log the persistence error. */
  const usageId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO ai_usage (
           id, org_id, station_id, actor_user_id,
           capability, provider, unit, count, estimated_cost_usd, request_summary
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        usageId,
        planInfo.orgId,
        stationId,
        userId,
        input.capability,
        result.provider,
        result.usage.unit,
        result.usage.count,
        result.usage.estimatedCostUsd,
        truncateSummary(input.requestSummary),
      )
      .run();
  } catch (err) {
    console.error('ai-bridge: ai_usage insert failed', err);
  }

  /** writeAuditLog is best-effort — already swallows errors internally. */
  await writeAuditLog(db, {
    stationId,
    actorUserId: userId,
    action: `ai_generate_${input.capability}`,
    targetType: 'ai_usage',
    targetId: usageId,
    after: {
      capability: input.capability,
      provider: result.provider,
      unit: result.usage.unit,
      count: result.usage.count,
      estimatedCostUsd: result.usage.estimatedCostUsd,
    },
  });

  return jsonResponse(200, {
    ok: true,
    data: result.data,
    usage: result.usage,
    provider: result.provider,
  });
}
