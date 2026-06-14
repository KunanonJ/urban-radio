/**
 * Role-gate helper for Next.js Route Handlers.
 *
 * Pentest H-05 / H-06: routes that mutate clocks and schedule must restrict
 * to admin + programmer. Merely holding a station-member session is
 * insufficient — operators, producers, and guests have read-only access to
 * these resources.
 *
 * See docs/PENTEST-AUDIT-RESULTS.md, findings H-05 and H-06.
 */

import { jsonError } from '@/server/api-response';
import type { StationContext } from './require-station';

/**
 * Asserts the authenticated user's role is in the allowlist.
 * Returns a 403 `Response` on deny; `null` on allow.
 *
 * Usage:
 *   const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
 *   if (forbidden) return forbidden;
 */
export function requireRole(
  ctx: StationContext,
  allowed: ReadonlyArray<string>,
): Response | null {
  if (!allowed.includes(ctx.role)) {
    return jsonError(403, 'Forbidden — insufficient role');
  }
  return null;
}

/**
 * Roles permitted to create, update, or delete clocks and their slots.
 * H-05: was open to all station members.
 */
export const MUTATE_CLOCKS_ROLES = ['admin', 'programmer'] as const;

/**
 * Roles permitted to create, update, or delete schedule assignments.
 * H-06: was open to all station members.
 */
export const MUTATE_SCHEDULE_ROLES = ['admin', 'programmer'] as const;
