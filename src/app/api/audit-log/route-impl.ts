/**
 * GET /api/audit-log
 *
 * Read-only access to the station-scoped `audit_log` table.
 *
 *   - default: JSON list with keyset pagination and a filter surface
 *     (actorUserId / action / targetType / from / to / search).
 *   - `?format=csv`: one-shot CSV export with the same filter surface,
 *     hard-capped at 50,000 rows (413 on overflow). The export itself is
 *     audited via a single `audit_log_export` row so a station owner can
 *     answer "who pulled this data and when?" without leaving the audit log.
 *
 * Auth: `requireStation` — 401 with no session, 403 with no membership.
 *
 * Mirrors `functions/api/audit-log/index.ts`.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { requireRole } from '@/server/auth/require-role';
import { requireStation } from '@/server/auth/require-station';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';

/**
 * Pentest M-15: audit log is privileged data within a station — it records
 * who did what, including potentially other users' actions. An operator or
 * producer shouldn't be able to read another station member's audit trail.
 * Restrict reads to admin + programmer.
 */
const AUDIT_LOG_READ_ROLES = ['admin', 'programmer'] as const;
import {
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  queryAuditLogCsv,
  queryAuditLogList,
  type AuditLogFilters,
  type AuditLogRow,
} from '@/server/queries/audit-log-queries';

interface AuditLogDeps {
  db?: DbClient;
  secret?: string;
}

export const CSV_ROW_CAP = 50_000;

function safeParseJson(input: string | null): unknown {
  if (input === null || input === undefined || input === '') return null;
  try {
    return JSON.parse(input);
  } catch {
    // Surface the raw payload — better than dropping audit evidence.
    return input;
  }
}

const isoString = z
  .string()
  .trim()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' });

const querySchema = z.object({
  actorUserId: z.string().trim().min(1).max(120).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  targetType: z.string().trim().min(1).max(120).optional(),
  from: isoString.optional(),
  to: isoString.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(AUDIT_LOG_MAX_LIMIT).optional(),
  format: z.enum(['csv']).optional(),
});

function readFilters(params: URLSearchParams): AuditLogFilters {
  return {
    actorUserId: params.get('actorUserId') ?? undefined,
    action: params.get('action') ?? undefined,
    targetType: params.get('targetType') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    search: params.get('search') ?? undefined,
  };
}

function rowToJson(row: AuditLogRow): Record<string, unknown> {
  return {
    id: row.id,
    at: row.at,
    actor: {
      userId: row.actorUserId,
      username: row.actorUsername,
    },
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: safeParseJson(row.beforeJson),
    after: safeParseJson(row.afterJson),
  };
}

/**
 * Escape a single CSV field per RFC 4180:
 *   - if the field contains a comma, quote, CR, or LF, wrap in double quotes
 *   - any embedded double quote is escaped by doubling it
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: AuditLogRow[]): string {
  const header = 'At,Actor,Action,TargetType,TargetId,Before,After';
  const lines = rows.map((row) => {
    const actor = row.actorUsername ?? row.actorUserId ?? '';
    return [
      csvEscape(row.at),
      csvEscape(actor),
      csvEscape(row.action),
      csvEscape(row.targetType),
      csvEscape(row.targetId),
      csvEscape(row.beforeJson ?? ''),
      csvEscape(row.afterJson ?? ''),
    ].join(',');
  });
  return [header, ...lines].join('\n') + '\n';
}

function buildFilename(stationId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(stationId)}-audit-log-${stamp}.csv`;
}

export async function getAuditLog(
  request: Request,
  deps: AuditLogDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // Pentest M-15: privilege bleed — restrict reads to admin/programmer.
  const forbidden = requireRole(gate.context, AUDIT_LOG_READ_ROLES);
  if (forbidden) return forbidden;

  const db = deps.db ?? getDb();

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    actorUserId: url.searchParams.get('actorUserId') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    targetType: url.searchParams.get('targetType') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const filters: AuditLogFilters = readFilters(url.searchParams);

  // ─── CSV path ────────────────────────────────────────────────────────────
  if (parsed.data.format === 'csv') {
    let rows: AuditLogRow[];
    try {
      rows = await queryAuditLogCsv(db, {
        stationId: gate.context.stationId,
        filters,
        rowCap: CSV_ROW_CAP,
      });
    } catch (err) {
      return jsonError(500, logAndScrub(err, { tag: 'audit-log/csv' }));
    }

    if (rows.length > CSV_ROW_CAP) {
      return jsonError(413, 'row_cap_exceeded', { limit: CSV_ROW_CAP });
    }

    // Self-audit. Best-effort — writeAuditLog swallows failures.
    await writeAuditLog(db, {
      stationId: gate.context.stationId,
      actorUserId: gate.context.userId,
      action: 'audit_log_export',
      targetType: 'station',
      targetId: gate.context.stationId,
      after: {
        format: 'csv',
        rowCount: rows.length,
        filters,
      },
    });

    const csv = rowsToCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${buildFilename(gate.context.stationId)}"`,
        'X-Row-Count': String(rows.length),
      },
    });
  }

  // ─── JSON list path ─────────────────────────────────────────────────────
  const limit = clampLimit(
    parsed.data.limit,
    AUDIT_LOG_MAX_LIMIT,
    AUDIT_LOG_DEFAULT_LIMIT,
  );
  const cursor = decodeCursor(parsed.data.cursor ?? null);

  let rows: AuditLogRow[];
  try {
    rows = await queryAuditLogList(db, {
      stationId: gate.context.stationId,
      filters,
      cursor: cursor ?? undefined,
      limit,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'audit-log/list' }));
  }

  const entries = rows.map(rowToJson);
  let nextCursor: string | null = null;
  if (rows.length === limit && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ lastAt: last.at, lastId: last.id });
  }

  return new Response(
    JSON.stringify({ entries, meta: { nextCursor, limit } }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  return getAuditLog(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
