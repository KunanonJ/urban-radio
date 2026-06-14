/// <reference types="@cloudflare/workers-types" />

/**
 * Phase 8 — server-side observability shim.
 *
 * This is intentionally a **stub adapter** for v1. It documents the integration
 * contract and gives every API route a single, ergonomic place to call:
 *
 *   import { captureError } from '../_lib/observability';
 *   try { ... } catch (err) { captureError(env, err, { route: '/api/...' }); throw; }
 *
 * Behavior:
 *   - `SENTRY_DSN` unset  → `initObservability` returns null; `captureError`
 *     falls back to `console.error`. ZERO operational impact.
 *   - `SENTRY_DSN` set    → a thin client object is returned today (still
 *     console-backed); the follow-up PR will swap in the real `toucan-js`
 *     integration for Workers without touching any callsite.
 *
 * Why a stub and not the real `toucan-js`/`@sentry/nextjs`?
 *   - The dep wasn't approved for this PR.
 *   - We want to ship the observability surface first so all error paths are
 *     wired up; flipping to the real SDK is then a one-line swap inside this
 *     file. The follow-up issue is documented in PRODUCTION-RUNBOOK.md.
 */

export interface ObservabilityEnv {
  SENTRY_DSN?: string;
}

export interface ObservabilityClient {
  capture(err: unknown, ctx?: Record<string, unknown>): void;
}

function truncateDsn(dsn: string): string {
  // Show the host but hide the project id / public key suffix.
  const head = dsn.slice(0, 24);
  return head + (dsn.length > 24 ? '…' : '');
}

/**
 * Initialize the Sentry-compatible client. Returns `null` when no DSN is
 * configured — callers MUST handle null and degrade to plain logging.
 */
export function initObservability(env: ObservabilityEnv): ObservabilityClient | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return null;

  // Real toucan-js init will move here in the follow-up PR. For now we just
  // log that we *would* have initialized so production smoke tests can see it.
  console.info('[observability] Would initialize Sentry with DSN:', truncateDsn(dsn));

  return {
    capture(err: unknown, ctx?: Record<string, unknown>): void {
      // When the real SDK lands, this becomes `sentry.captureException(err, { extra: ctx })`.
      console.error('[observability]', err, ctx);
    },
  };
}

/**
 * One-call convenience: lazily initialize and capture in one go. Safe to call
 * from any code path — no DSN means a console fallback, no exceptions thrown.
 */
export function captureError(
  env: ObservabilityEnv,
  err: unknown,
  ctx?: Record<string, unknown>,
): void {
  const client = initObservability(env);
  if (client) {
    client.capture(err, ctx);
    return;
  }
  console.error('[no-sentry]', err, ctx);
}
