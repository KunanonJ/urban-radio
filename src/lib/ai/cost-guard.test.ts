import { describe, expect, it } from 'vitest';
import { PLAN_CAPS, checkCost } from '@/lib/ai/cost-guard';

describe('checkCost', () => {
  it('given $0 spent, $5 cap, $0.10 request > ok with remaining $4.90', () => {
    const decision = checkCost({
      cap: { monthlyUsd: 5 },
      monthSpentUsd: 0,
      estimatedRequestUsd: 0.1,
    });
    expect(decision.ok).toBe(true);
    expect(decision.reason).toBeUndefined();
    expect(decision.remainingUsd).toBeCloseTo(4.9, 6);
  });

  it('given $4.95 spent, $5 cap, $0.10 request > monthly_cap_hit', () => {
    const decision = checkCost({
      cap: { monthlyUsd: 5 },
      monthSpentUsd: 4.95,
      estimatedRequestUsd: 0.1,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('monthly_cap_hit');
  });

  it('given perRequest $0.05 cap, $0.10 request > per_request_cap_hit', () => {
    const decision = checkCost({
      cap: { monthlyUsd: 50, perRequestUsd: 0.05 },
      monthSpentUsd: 0,
      estimatedRequestUsd: 0.1,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('per_request_cap_hit');
  });

  it('given monthlyUsd 0 (free plan) > always returns ok=false with remaining 0', () => {
    const decision = checkCost({
      cap: { monthlyUsd: 0 },
      monthSpentUsd: 0,
      estimatedRequestUsd: 0.0001,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('monthly_cap_hit');
    expect(decision.remainingUsd).toBe(0);
    expect(decision.remainingPct).toBe(0);
  });

  it('remainingPct is 50% when half spent (zero pending request)', () => {
    /** Forward-looking: cap=$10, spent=$5, pending=$0 → remaining = $5 = 50%. */
    const decision = checkCost({
      cap: { monthlyUsd: 10 },
      monthSpentUsd: 5,
      estimatedRequestUsd: 0,
    });
    expect(decision.remainingPct).toBeCloseTo(0.5, 6);
  });

  it('given spent exceeds cap > remainingUsd and remainingPct clamped to 0', () => {
    const decision = checkCost({
      cap: { monthlyUsd: 5 },
      monthSpentUsd: 6,
      estimatedRequestUsd: 0.01,
    });
    expect(decision.ok).toBe(false);
    expect(decision.remainingUsd).toBe(0);
    expect(decision.remainingPct).toBe(0);
  });
});

describe('PLAN_CAPS', () => {
  it('enterprise > $500', () => {
    expect(PLAN_CAPS.enterprise.monthlyUsd).toBe(500);
  });

  it('pro > $50, starter > $5, free > $0', () => {
    expect(PLAN_CAPS.pro.monthlyUsd).toBe(50);
    expect(PLAN_CAPS.starter.monthlyUsd).toBe(5);
    expect(PLAN_CAPS.free.monthlyUsd).toBe(0);
  });
});
