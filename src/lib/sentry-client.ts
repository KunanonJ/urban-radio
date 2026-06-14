/**
 * Phase 8 — browser-side Sentry shim.
 *
 * Same stub pattern as `functions/_lib/observability.ts`: callsite-stable
 * surface today, real `@sentry/nextjs` swap-in once the dep is approved.
 *
 * Usage (lazy, at the top of the app root):
 *
 *   if (typeof window !== 'undefined') {
 *     initSentryClient({ NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN });
 *   }
 *
 * Behavior:
 *   - SSR (no `window`)                 → returns null. Never imports any Sentry SDK.
 *   - Browser, no `NEXT_PUBLIC_SENTRY_DSN` → returns null.
 *   - Browser, with DSN                 → returns a thin captureException client
 *                                          that logs via console for now.
 */

export interface SentryClientEnv {
  NEXT_PUBLIC_SENTRY_DSN?: string;
}

export interface BrowserSentryClient {
  captureException(err: unknown): void;
}

function truncateDsn(dsn: string): string {
  const head = dsn.slice(0, 24);
  return head + (dsn.length > 24 ? '…' : '');
}

export function initSentryClient(env: SentryClientEnv): BrowserSentryClient | null {
  if (typeof window === 'undefined') return null;
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return null;

  // Real @sentry/nextjs init goes here in the follow-up PR.
  // For now: log a truncated DSN so prod smoke tests confirm wiring.
  console.info('[sentry-client] would init with DSN:', truncateDsn(dsn));

  return {
    captureException(err: unknown): void {
      console.error('[sentry-client]', err);
    },
  };
}
