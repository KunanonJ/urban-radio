/**
 * Best-effort audit logging — Next-side port of `functions/_lib/audit-log.ts`.
 *
 * Writes one row per mutation to `audit_log`. NEVER throws — an audit
 * failure must not abort the underlying write that produced it.
 * Errors are logged via console and swallowed.
 *
 * Identical contract to the Cloudflare helper. Don't diverge.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { randomUUID } from 'node:crypto';

import { type DbClient } from '@/db/client';
import { auditLog } from '@/db/schema';

export interface AuditEntry {
  stationId: string;
  /**
   * Pass `null` for system-generated events (e.g. Stripe webhook, cron jobs).
   * `audit_log.actor_user_id` has an FK to `auth_users.id`; passing a sentinel
   * like `'stripe'` would FK-violate and writeAuditLog would swallow the
   * error, dropping the audit row silently.
   */
  actorUserId: string | null;
  action: 'create' | 'update' | 'delete' | 'reorder' | string;
  targetType:
    | 'clock'
    | 'clock_slot'
    | 'schedule_assignment'
    | 'radio_track'
    | string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}

/** ISO timestamp the audit row records as `at`. Tests can override via opts. */
export function nowIsoUtc(): string {
  return new Date().toISOString().replace(/\.\d+/, '');
}

export interface WriteAuditLogOptions {
  /** Override the generated id (tests). */
  id?: string;
  /** Override `at` (tests). */
  at?: string;
}

export async function writeAuditLog(
  db: DbClient,
  entry: AuditEntry,
  opts: WriteAuditLogOptions = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: opts.id ?? randomUUID(),
      stationId: entry.stationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeJson:
        entry.before !== undefined && entry.before !== null
          ? JSON.stringify(entry.before)
          : null,
      afterJson:
        entry.after !== undefined && entry.after !== null
          ? JSON.stringify(entry.after)
          : null,
      at: opts.at ?? nowIsoUtc(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: audit failures stay non-fatal
    console.error('audit-log write failed', err);
  }
}
