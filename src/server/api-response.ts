/**
 * Standard JSON response helpers for Next.js Route Handlers.
 *
 * Mirrors the shape used by the legacy Cloudflare Pages Functions in
 * `functions/api/**` so clients see byte-identical responses during the
 * Railway migration's dual-stack window.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

/**
 * Pentest M-19: authenticated API responses must never be cached by
 * intermediaries or browser disk caches — otherwise a shared workstation
 * could surface another user's data on back-navigation. We set
 * `Cache-Control: no-store` by default on every JSON response. Callers
 * that genuinely want caching (e.g. public health probes) override via
 * `init.headers`.
 */
const JSON_HEADERS: HeadersInit = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

/**
 * Build a `Response` carrying a JSON-encoded success envelope.
 * Wrapping `Response.json` keeps headers consistent across handlers.
 */
export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (init?.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers,
  });
}

/**
 * Build a `Response` carrying a JSON error envelope. The shape matches the
 * legacy `functions/api/**` handlers so client code does not need to branch.
 *
 *   { error: string, details?: unknown }
 */
export function jsonError(
  status: number,
  message: string,
  details?: unknown,
): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * `405 Method Not Allowed` with an `Allow` header listing the supported methods.
 * The Cloudflare handlers used plain text here, so we keep that.
 */
export function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: allowed.join(', ') },
  });
}
