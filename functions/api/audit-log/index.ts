/// <reference types="@cloudflare/workers-types" />

/**
 * GET /api/audit-log
 *
 * Read-only access to the station-scoped `audit_log` table.
 *
 *   - default: JSON list with keyset pagination and a filter surface
 *     (actorUserId / action / targetType / from / to / search).
 *   - `?format=csv`: one-shot CSV export with the same filter surface,
 *     hard-capped at 50,000 rows (413 on overflow).
 *
 * Auth: `requireStation` — 401 with no session, 403 with no membership.
 *
 * CSV exports are themselves audited. We write a single `audit_log_export`
 * row before responding so a station owner can answer "who pulled this data
 * and when?" without leaving the audit log itself.
 */

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  buildAuditLogCsvQuery,
  buildAuditLogListQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  type AuditLogFilters,
} from '../../_lib/audit-log-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

export const CSV_ROW_CAP = 50_000;

interface AuditLogRow {
  id: string;
  station_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  before_json: string | null;
  after_json: string | null;
  at: string;
  actor_username: string | null;
}

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

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
      userId: row.actor_user_id,
      username: row.actor_username,
    },
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: safeParseJson(row.before_json),
    after: safeParseJson(row.after_json),
  };
}

/**
 * Escape a single field per RFC 4180:
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
    const actor = row.actor_username ?? row.actor_user_id ?? '';
    return [
      csvEscape(row.at),
      csvEscape(actor),
      csvEscape(row.action),
      csvEscape(row.target_type),
      csvEscape(row.target_id),
      csvEscape(row.before_json ?? ''),
      csvEscape(row.after_json ?? ''),
    ].join(',');
  });
  return [header, ...lines].join('\n') + '\n';
}

function buildFilename(stationId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(stationId)}-audit-log-${stamp}.csv`;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
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
      const { sql, params } = buildAuditLogCsvQuery({
        stationId: gate.context.stationId,
        filters,
        rowCap: CSV_ROW_CAP,
      });
      const { results } = await db
        .prepare(sql)
        .bind(...params)
        .all<AuditLogRow>();
      rows = results ?? [];
    } catch (err) {
      console.error('audit-log/csv read', err);
      return jsonError(500, err instanceof Error ? err.message : 'query failed');
    }

    if (rows.length > CSV_ROW_CAP) {
      return jsonError(413, 'row_cap_exceeded', { limit: CSV_ROW_CAP });
    }

    // Self-audit: record the export. Best-effort — writeAuditLog swallows failures.
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
  const limit = clampLimit(parsed.data.limit, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT);
  const cursor = decodeCursor(parsed.data.cursor ?? null);

  let rows: AuditLogRow[];
  try {
    const { sql, params } = buildAuditLogListQuery({
      stationId: gate.context.stationId,
      filters,
      cursor: cursor ?? undefined,
      limit,
    });
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<AuditLogRow>();
    rows = results ?? [];
  } catch (err) {
    console.error('audit-log/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }

  const entries = rows.map(rowToJson);
  let nextCursor: string | null = null;
  if (rows.length === limit && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ lastAt: last.at, lastId: last.id });
  }

  return Response.json({
    entries,
    meta: { nextCursor, limit },
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
