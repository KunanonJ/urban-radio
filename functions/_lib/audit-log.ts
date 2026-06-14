/// <reference types="@cloudflare/workers-types" />

/**
 * Best-effort audit logging helper.
 *
 * Used by both the clocks and the schedule endpoints. Writes one row per
 * mutation to `audit_log`. NEVER throws — an audit failure must not abort
 * the underlying write that produced it. Errors are logged via console
 * and swallowed.
 */
export interface AuditEntry {
  stationId: string;
  actorUserId: string;
  action: 'create' | 'update' | 'delete' | 'reorder' | string;
  targetType: 'clock' | 'clock_slot' | 'schedule_assignment' | 'radio_track' | string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}

export async function writeAuditLog(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (id, station_id, actor_user_id, action, target_type, target_id, before_json, after_json, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        entry.stationId,
        entry.actorUserId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.before !== undefined && entry.before !== null ? JSON.stringify(entry.before) : null,
        entry.after !== undefined && entry.after !== null ? JSON.stringify(entry.after) : null,
      )
      .run();
  } catch (err) {
    console.error('audit-log write failed', err);
  }
}
