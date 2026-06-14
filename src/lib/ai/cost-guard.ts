/**
 * Cost-guard — pure helper that compares "spent so far this month" to a plan cap.
 *
 * Stateless. The caller is responsible for fetching `monthSpentUsd` (from an `ai_usage` rollup,
 * which will land in a separate migration). Used at request-time in functions/ai/* endpoints to
 * short-circuit before spending more money.
 */

export interface PlanCap {
  monthlyUsd: number;
  /** Optional ceiling on a single request — protects against single runaway prompts. */
  perRequestUsd?: number;
}

export interface CostGuardInput {
  cap: PlanCap;
  monthSpentUsd: number;
  estimatedRequestUsd: number;
}

export type CostGuardReason = 'monthly_cap_hit' | 'per_request_cap_hit';

export interface CostGuardDecision {
  ok: boolean;
  reason?: CostGuardReason;
  /** USD still available this month (≥ 0). 0 if cap exceeded. */
  remainingUsd: number;
  /** Fraction (0..1) of the monthly cap that remains. NaN-safe: 0 when cap is 0. */
  remainingPct: number;
}

export function checkCost(input: CostGuardInput): CostGuardDecision {
  const { cap, monthSpentUsd, estimatedRequestUsd } = input;

  /** Free plan or any zero-cap plan: always deny, never report remaining. */
  if (cap.monthlyUsd <= 0) {
    return { ok: false, reason: 'monthly_cap_hit', remainingUsd: 0, remainingPct: 0 };
  }

  /**
   * `remainingUsd` is forward-looking: it counts the *pending* request as already debited, so
   * callers can show "what's left after I make this call". Tests assert `$0 + $0.10` against
   * a $5 cap yields $4.90 remaining.
   */
  const remainingUsd = Math.max(0, cap.monthlyUsd - monthSpentUsd - estimatedRequestUsd);
  const remainingPct = remainingUsd / cap.monthlyUsd;

  if (cap.perRequestUsd !== undefined && estimatedRequestUsd > cap.perRequestUsd) {
    return { ok: false, reason: 'per_request_cap_hit', remainingUsd, remainingPct };
  }

  if (monthSpentUsd + estimatedRequestUsd > cap.monthlyUsd) {
    return { ok: false, reason: 'monthly_cap_hit', remainingUsd, remainingPct };
  }

  return { ok: true, remainingUsd, remainingPct };
}

/**
 * Plan defaults — kept tiny on purpose. Real per-org overrides will live in `organizations`
 * (Wave 6b migration). Numbers track Phase 4 budget targets in the roadmap.
 */
export const PLAN_CAPS: Record<'free' | 'starter' | 'pro' | 'enterprise', PlanCap> = {
  free: { monthlyUsd: 0 },
  starter: { monthlyUsd: 5 },
  pro: { monthlyUsd: 50 },
  enterprise: { monthlyUsd: 500 },
};
