/**
 * GET /api/royalty/export — Next.js port.
 *
 * Mirrors `functions/api/royalty/export.ts`. Reads play_log rows in the
 * supplied range and emits the matching PRO CSV (ASCAP / BMI / SoundExchange).
 * Response body, headers (Content-Type, Content-Disposition, X-Row-Count),
 * and status codes are byte-identical to the Cloudflare side so dual-stack
 * PRO submissions stay consistent during the migration window.
 *
 * Auth: `requireStation` (401 / 403). The play_log SELECT is scoped to the
 * gate-resolved stationId, so a member of station A cannot export station B.
 *
 * Hard cap: ROW_CAP rows per export — overflow → 413 row_cap_exceeded. v1
 * does not paginate; tracked as FOLLOW-UP in `functions/api/royalty/export.ts`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { playLog, stations } from '@/db/schema';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { writeAuditLog } from '@/server/audit-log';
import { requireRole } from '@/server/auth/require-role';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';

/**
 * Pentest M-12: royalty data is sensitive (PRO reporting, broadcast ISRCs).
 * Restrict export to admin + programmer roles. Any other authenticated role
 * gets 403, even within their own station.
 */
const ROYALTY_EXPORT_ROLES = ['admin', 'programmer'] as const;
import {
  SUPPORTED_FORMATS,
  getEmitter,
  isRoyaltyFormat,
  type RoyaltyFormat,
  type RoyaltyRow,
  type StationContext,
} from '@/server/royalty/index';

/** v1 cap. If exceeded the export aborts with 413 to surface the gap. */
export const ROW_CAP = 10_000;

const exportQuerySchema = z.object({
  format: z
    .string()
    .refine((v) => isRoyaltyFormat(v), {
      message: `format must be one of ${SUPPORTED_FORMATS.join(', ')}`,
    }),
  from: z.string().datetime({ offset: true, message: 'from must be ISO 8601' }),
  to: z.string().datetime({ offset: true, message: 'to must be ISO 8601' }),
});

interface PlayLogReadRow {
  id: string;
  stationId: string;
  trackId: string | null;
  titleSnapshot: string;
  artistSnapshot: string | null;
  playedAt: string;
  durationPlayedMs: number | null;
  source: string;
  isrc: string | null;
  iswc: string | null;
}

function toRoyaltyRow(row: PlayLogReadRow): RoyaltyRow {
  return {
    playedAt: row.playedAt,
    title: row.titleSnapshot,
    artist: row.artistSnapshot,
    durationMs: row.durationPlayedMs,
    isrc: row.isrc,
    iswc: row.iswc,
    source: row.source,
  };
}

function buildFilename(
  stationId: string,
  format: RoyaltyFormat,
  from: string,
  to: string,
): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(stationId)}-${format}-${safe(from)}-${safe(to)}.csv`;
}

export interface RoyaltyExportDeps {
  db?: DbClient;
  secret?: string;
}

export async function getRoyaltyExport(
  request: Request,
  deps: RoyaltyExportDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, {
    db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // Pentest M-12 role gate (admin + programmer only).
  const forbidden = requireRole(gate.context, ROYALTY_EXPORT_ROLES);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const parsed = exportQuerySchema.safeParse({
    format: url.searchParams.get('format'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const format = parsed.data.format as RoyaltyFormat;
  const { from, to } = parsed.data;

  // Station name lookup. Matches the Cloudflare fallback: if the row is
  // missing (race vs. station rename), fall back to stationId-as-name so the
  // export still completes.
  let stationName: string;
  try {
    const rows = await db
      .select({ id: stations.id, name: stations.name })
      .from(stations)
      .where(eq(stations.id, gate.context.stationId))
      .limit(1);
    stationName = rows[0]?.name ?? gate.context.stationId;
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'royalty/export/station-lookup' }));
  }
  const stationCtx: StationContext = {
    stationId: gate.context.stationId,
    stationName,
  };

  // Pull rows. Ordered ASC by played_at, id for deterministic CSV output.
  // Capped at ROW_CAP + 1 so we detect overflow without scanning everything.
  let rows: PlayLogReadRow[];
  try {
    rows = await db
      .select({
        id: playLog.id,
        stationId: playLog.stationId,
        trackId: playLog.trackId,
        titleSnapshot: playLog.titleSnapshot,
        artistSnapshot: playLog.artistSnapshot,
        playedAt: playLog.playedAt,
        durationPlayedMs: playLog.durationPlayedMs,
        source: playLog.source,
        isrc: playLog.isrc,
        iswc: playLog.iswc,
      })
      .from(playLog)
      .where(
        and(
          eq(playLog.stationId, gate.context.stationId),
          gte(playLog.playedAt, from),
          lt(playLog.playedAt, to),
        ),
      )
      .orderBy(asc(playLog.playedAt), asc(playLog.id))
      .limit(ROW_CAP + 1);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'royalty/export/play-log-read' }));
  }

  if (rows.length > ROW_CAP) {
    // Cloudflare body shape is `{ error: 'row_cap_exceeded', limit: ROW_CAP }`.
    // `jsonError` only knows `error` + `details`, so emit a raw Response to
    // preserve the public `limit` field.
    return new Response(
      JSON.stringify({ error: 'row_cap_exceeded', limit: ROW_CAP }),
      {
        status: 413,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  const emitter = getEmitter(format);
  const csv = emitter.emit(rows.map(toRoyaltyRow), stationCtx, { from, to });

  // Best-effort audit. Failures inside writeAuditLog don't abort the export.
  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'royalty_export',
    targetType: 'station',
    targetId: gate.context.stationId,
    after: { format, from, to, rowCount: rows.length },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': `${emitter.mimeType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${buildFilename(
        gate.context.stationId,
        format,
        from,
        to,
      )}"`,
      'X-Row-Count': String(rows.length),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return getRoyaltyExport(request);
}

// Explicit method handlers — Next.js will 405 unknown methods by default,
// but mirroring the Cloudflare onRequest helper makes the contract obvious.
export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
export async function PUT(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
export async function PATCH(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
export async function DELETE(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
