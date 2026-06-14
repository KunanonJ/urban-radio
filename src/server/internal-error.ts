/**
 * Pentest H-11 / M-05: scrub DB error messages from 500 responses.
 *
 * `logAndScrub` logs the full error context to stdout (where ops needs it)
 * and returns a generic message safe to surface to clients. Use everywhere
 * we currently do `jsonError(500, err.message)`.
 */
export interface ScrubOptions {
  /** Context tag for the log line — usually the route path or operation name. */
  tag: string;
  /** Optional public message override. Defaults to "Internal server error". */
  publicMessage?: string;
}

export function logAndScrub(err: unknown, opts: ScrubOptions): string {
  // eslint-disable-next-line no-console -- intentional: server-side observability
  console.error(`[${opts.tag}]`, err);
  return opts.publicMessage ?? 'Internal server error';
}
