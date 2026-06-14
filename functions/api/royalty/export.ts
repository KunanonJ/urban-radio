/// <reference types="@cloudflare/workers-types" />

/**
 * GET /api/royalty/export?format=ascap|bmi|soundexchange&from=ISO&to=ISO
 *
 * Streams the requested PRO format as a CSV download. Reads `play_log` rows
 * in the supplied range, hands them to the matching emitter, and writes an
 * audit_log row before responding.
 *
 * Hard cap: v1 returns at most 10,000 rows per export. If the cap is hit the
 * endpoint responds with HTTP 413 + `{ error: 'row_cap_exceeded', limit }`.
 * Larger windows require paginated exports — tracked as FOLLOW-UP.
 */
import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  SUPPORTED_FORMATS,
  getEmitter,
  isRoyaltyFormat,
  type RoyaltyFormat,
  type RoyaltyRow,
  type StationContext,
} from '../../_lib/royalty/index';

type Ctx = { env: SonicBloomEnv; request: Request };

/** v1 cap. If exceeded the export aborts with 413 to surface the gap. */
export const ROW_CAP = 10_000;

interface PlayLogReadRow {
  id: string;
  station_id: string;
  track_id: string | null;
  title_snapshot: string;
  artist_snapshot: string | null;
  played_at: string;
  duration_played_ms: number | null;
  source: string;
  isrc: string | null;
  iswc: string | null;
}

interface StationReadRow {
  id: string;
  name: string;
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const exportQuerySchema = z.object({
  format: z
    .string()
    .refine((v) => isRoyaltyFormat(v), {
      message: `format must be one of ${SUPPORTED_FORMATS.join(', ')}`,
    }),
  from: z.string().datetime({ offset: true, message: 'from must be ISO 8601' }),
  to: z.string().datetime({ offset: true, message: 'to must be ISO 8601' }),
});

function toRoyaltyRow(row: PlayLogReadRow): RoyaltyRow {
  return {
    playedAt: row.played_at,
    title: row.title_snapshot,
    artist: row.artist_snapshot,
    durationMs: row.duration_played_ms,
    isrc: row.isrc,
    iswc: row.iswc,
    source: row.source,
  };
}

function buildFilename(stationId: string, format: RoyaltyFormat, from: string, to: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(stationId)}-${format}-${safe(from)}-${safe(to)}.csv`;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const parsed = exportQuerySchema.safeParse({
    format: url.searchParams.get('format'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
  if (!parsed.success) {
    return jsonError(400, { error: 'Validation failed', details: parsed.error.flatten() });
  }

  const format = parsed.data.format as RoyaltyFormat;
  const { from, to } = parsed.data;

  // Pull station metadata for the emitter's StationContext. requireStation
  // already proved membership; the row should always exist, but we fall
  // back to stationId-as-name if not (e.g. mid-rename race).
  let stationRow: StationReadRow | null = null;
  try {
    stationRow = await db
      .prepare('SELECT id, name FROM stations WHERE id = ? LIMIT 1')
      .bind(gate.context.stationId)
      .first<StationReadRow>();
  } catch (err) {
    console.error('royalty/export station-lookup', err);
    return jsonError(500, { error: err instanceof Error ? err.message : 'station lookup failed' });
  }
  const stationCtx: StationContext = {
    stationId: gate.context.stationId,
    stationName: stationRow?.name ?? gate.context.stationId,
  };

  // Read rows in range. Ordered ASC by played_at, id for deterministic export
  // output. Capped at ROW_CAP + 1 to detect overflow without scanning the
  // entire table.
  let rows: PlayLogReadRow[];
  try {
    const { results } = await db
      .prepare(
        `SELECT id, station_id, track_id, title_snapshot, artist_snapshot, played_at,
                duration_played_ms, source, isrc, iswc
         FROM play_log
         WHERE station_id = ? AND played_at >= ? AND played_at < ?
         ORDER BY played_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(gate.context.stationId, from, to, ROW_CAP + 1)
      .all<PlayLogReadRow>();
    rows = results ?? [];
  } catch (err) {
    console.error('royalty/export play-log-read', err);
    return jsonError(500, { error: err instanceof Error ? err.message : 'play_log read failed' });
  }

  if (rows.length > ROW_CAP) {
    return jsonError(413, { error: 'row_cap_exceeded', limit: ROW_CAP });
  }

  const emitter = getEmitter(format);
  const csv = emitter.emit(rows.map(toRoyaltyRow), stationCtx, { from, to });

  // Best-effort audit. Failures inside writeAuditLog don't abort the export
  // — see _lib/audit-log.ts.
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

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
