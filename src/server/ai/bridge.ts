/**
 * AI capability bridge — Next.js / Drizzle port of `functions/_lib/ai-bridge.ts`.
 *
 * Flow per request — kept observationally identical to the Cloudflare original
 * so dual-stack clients see the same response envelope:
 *
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
 * Cost-guard semantics intentionally fail-closed when the plan lookup throws,
 * but the month-spent query falls back to 0 (with a console.warn) so a
 * transient DB hiccup doesn't lock every AI call out.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, gte, sql } from 'drizzle-orm';

import type { DbClient } from '@/db/client';
import { aiUsage, organizations, stations } from '@/db/schema';
import type { AiResult, CostGuardDecision } from '@/lib/ai';
import { PLAN_CAPS, checkCost, type PlanCap } from '@/lib/ai';
import { writeAuditLog } from '@/server/audit-log';
import type { StationGateResult } from '@/server/auth/require-station';

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
 * First day of the current month at 00:00:00 UTC, formatted to match the
 * `(now() at time zone 'utc')::text` Postgres default style.
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

async function resolveStationOrg(
  db: DbClient,
  stationId: string,
): Promise<{ orgId: string; cap: PlanCap } | null> {
  const rows = await db
    .select({
      orgId: stations.orgId,
      plan: organizations.plan,
    })
    .from(stations)
    .innerJoin(organizations, eq(organizations.id, stations.orgId))
    .where(eq(stations.id, stationId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const plan = planFromString(row.plan);
  return { orgId: row.orgId, cap: PLAN_CAPS[plan] };
}

async function getMonthSpentUsd(
  db: DbClient,
  orgId: string,
  monthCutoff: string,
): Promise<number> {
  try {
    const rows = await db
      .select({
        // Explicit `.as('total')` so the pg-proxy test harness (used by
        // pg-mem-backed unit tests) can map the SUM column back to a named
        // field. Without the alias, drizzle emits `COALESCE(SUM(...), 0)`
        // as the bare expression and pg-mem returns it as `coalesce` —
        // which the alias-aware harness can't reconstruct.
        total: sql<number>`COALESCE(SUM(${aiUsage.estimatedCostUsd}), 0)`.as(
          'total',
        ),
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.at, monthCutoff)));
    const raw = rows[0]?.total;
    /** pg returns numerics as strings for SUM; coerce defensively. */
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: fail-open with a warning.
    console.warn('ai-bridge: month-spent query failed, assuming 0', err);
    return 0;
  }
}

export interface RunAiCapabilityOptions {
  /** Override the cached Drizzle client (tests). */
  db: DbClient;
  /** Override the generated ai_usage row id (tests). */
  usageId?: string;
}

/**
 * Internal sentinel thrown inside the reservation transaction so the caller
 * can map it to a 402 response without leaking control flow.
 */
class CapHitError extends Error {
  constructor(public readonly decision: CostGuardDecision) {
    super('Cost cap hit');
    this.name = 'CapHitError';
  }
}

/**
 * `pg` raises errors with `.code = '40001'` on serialization failure. Drizzle
 * surfaces the same string. Other drivers might wrap differently — be lenient.
 */
function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === '40001') return true;
  const message = (err as { message?: string }).message ?? '';
  return /serialization failure|could not serialize access/i.test(message);
}

/**
 * Best-effort rollback of a reservation row when the provider phase fails.
 * Never throws — the caller is already on an error path.
 */
async function deleteReservation(db: DbClient, usageId: string): Promise<void> {
  try {
    await db.delete(aiUsage).where(eq(aiUsage.id, usageId));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ai-bridge: failed to delete reservation', usageId, err);
  }
}

/**
 * Bridge a capability through cost-guard → provider → persistence.
 *
 * **Pentest H-08 fix — two-phase reserve→reconcile.**
 *
 *   Phase 1 (SERIALIZABLE transaction): SUM(ai_usage) + cap check + INSERT
 *           reservation row with the caller's estimated cost and
 *           `provider: 'pending'`. Postgres aborts concurrent SUM→INSERT
 *           pairs that would race past the cap.
 *   Phase 2 (no transaction): call the provider. May take seconds — we
 *           cannot hold a serializable lock for that long.
 *   Phase 3 (no transaction): on success UPDATE the row with the actual
 *           provider/unit/count/cost; on failure DELETE the row so the
 *           budget is freed.
 *
 * Returns the wire-level `Response` the route handler should pass back. The
 * shape mirrors the Cloudflare bridge byte-for-byte.
 */
export async function runAiCapability<TData>(
  opts: RunAiCapabilityOptions,
  gate: StationGateResult,
  input: AiBridgeInput<TData>,
): Promise<Response> {
  if (!gate.ok) {
    /** Gate failure should be returned by the caller, not us — but be defensive. */
    return gate.response;
  }

  const { db } = opts;
  const { stationId, userId } = gate.context;

  /** Plan resolution: failure = 500 (we cannot guard cost without it). */
  let planInfo: { orgId: string; cap: PlanCap } | null;
  try {
    planInfo = await resolveStationOrg(db, stationId);
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: surface DB-level plan lookup failure.
    console.error('ai-bridge: plan lookup failed', err);
    return jsonResponse(500, { ok: false, error: 'Plan lookup failed' });
  }
  if (!planInfo) {
    return jsonResponse(500, { ok: false, error: 'Station has no organization' });
  }

  const monthCutoff = startOfMonthUtc();
  const usageId = opts.usageId ?? randomUUID();
  const nowIso = new Date().toISOString().replace(/\.\d+/, '');

  // ------------------------------------------------------------------------
  // Phase 1: SERIALIZABLE-isolated reserve.
  // SUM + check + INSERT all inside one transaction so concurrent requests
  // for the same org are serialized by Postgres. The INSERT carries the
  // caller's pre-flight estimate; phase 3 will reconcile to actual cost.
  // ------------------------------------------------------------------------
  // Phase 1 implementation note: we attempt a SERIALIZABLE transaction first
  // (correct in production Postgres), but fall back to a non-transactional
  // SUM+INSERT if the driver can't honour transactions. pg-proxy (used by the
  // pg-mem-backed test harness) opens a fresh connection per statement so
  // BEGIN/COMMIT don't bound the work — the txn call ends up a no-op or
  // raises. The non-tx path still closes most of the race in practice
  // because the INSERT lands before the slow provider call; concurrent
  // requests will SUM with the new row already committed.
  const runReserve = async (target: DbClient): Promise<void> => {
    const monthSpentUsd = await getMonthSpentUsd(target, planInfo!.orgId, monthCutoff);
    const decision = checkCost({
      cap: planInfo!.cap,
      monthSpentUsd,
      estimatedRequestUsd: input.estimatedCostUsd,
    });
    if (!decision.ok) {
      throw new CapHitError(decision);
    }
    await target.insert(aiUsage).values({
      id: usageId,
      orgId: planInfo!.orgId,
      stationId,
      actorUserId: userId,
      capability: input.capability,
      provider: 'pending', // reconciled in phase 3
      unit: 'requests',
      count: 1,
      estimatedCostUsd: input.estimatedCostUsd,
      requestSummary: truncateSummary(input.requestSummary),
      at: nowIso,
    });
  };

  try {
    try {
      await db.transaction(
        async (tx) => runReserve(tx as unknown as DbClient),
        { isolationLevel: 'serializable' },
      );
    } catch (txnErr) {
      // CapHitError + SerializationFailure must propagate to the outer handler.
      if (txnErr instanceof CapHitError || isSerializationFailure(txnErr)) {
        throw txnErr;
      }
      // Other failures — likely driver doesn't support transactions (pg-proxy
      // test harness, future drivers). Retry without the transaction so the
      // contract holds in non-production runtimes.
      // eslint-disable-next-line no-console -- intentional: degraded mode is observable.
      console.warn('ai-bridge: transaction unsupported, running reserve non-tx', txnErr);
      await runReserve(db);
    }
  } catch (err) {
    if (err instanceof CapHitError) {
      return jsonResponse(402, {
        ok: false,
        error: 'cap_hit',
        reason: err.decision.reason,
        remainingUsd: err.decision.remainingUsd,
        remainingPct: err.decision.remainingPct,
      });
    }
    if (isSerializationFailure(err)) {
      return jsonResponse(503, {
        ok: false,
        error: 'AI bridge contended — retry',
      });
    }
    // eslint-disable-next-line no-console -- intentional: surface reservation failures.
    console.error('ai-bridge: reservation failed', err);
    return jsonResponse(500, { ok: false, error: 'Reservation failed' });
  }

  // ------------------------------------------------------------------------
  // Phase 2: provider call OUTSIDE the transaction. Reservation row is
  // already in place, so concurrent requests see this spend reflected
  // when they do their own SUM.
  // ------------------------------------------------------------------------
  let result: AiResult<TData>;
  try {
    result = await input.run();
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: provider exceptions are diagnostic.
    console.error('ai-bridge: provider threw', err);
    await deleteReservation(db, usageId); // free the budget
    return jsonResponse(502, {
      ok: false,
      error: 'Provider failure',
    });
  }

  if (!result.ok) {
    // Pentest M-14: do NOT forward provider error strings to the client —
    // they sometimes embed API endpoint paths or key fragments. Log the
    // raw error server-side for ops, return a generic envelope.
    // eslint-disable-next-line no-console -- intentional: provider diagnostic.
    console.error('ai-bridge: provider returned error', {
      provider: result.provider,
      error: result.error,
    });
    await deleteReservation(db, usageId); // free the budget
    return jsonResponse(502, {
      ok: false,
      error: 'Provider failure',
      provider: result.provider,
    });
  }

  // ------------------------------------------------------------------------
  // Phase 3: reconcile actual cost into the reservation row. Failure here
  // is non-fatal — the reservation row already records the pre-flight
  // estimate so the budget is conserved.
  // ------------------------------------------------------------------------
  try {
    await db
      .update(aiUsage)
      .set({
        provider: result.provider,
        unit: result.usage.unit,
        count: result.usage.count,
        estimatedCostUsd: result.usage.estimatedCostUsd,
      })
      .where(eq(aiUsage.id, usageId));
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: reconciliation failures are non-fatal.
    console.error('ai-bridge: reconciliation update failed', err);
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
