/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildStationGetQuery,
  buildStationUpdateQuery,
  validateIanaTimezone,
  validateLanguage,
  type StationIdentityPatch,
  type StationRow,
} from '../../_lib/station-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

interface StationDbRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  timezone: string;
  stream_url: string | null;
  language: string | null;
  created_at: string;
}

const EDIT_ROLES = new Set(['admin', 'producer']);

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function rowToJson(row: StationDbRow): StationRow {
  return {
    id: row.id,
    orgId: row.org_id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    streamUrl: row.stream_url,
    language: row.language ?? 'en',
    createdAt: row.created_at,
  };
}

async function fetchStation(
  db: D1Database,
  stationId: string,
): Promise<StationRow | null> {
  const { sql, params } = buildStationGetQuery(stationId);
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<StationDbRow>();
  const row = (results ?? [])[0];
  return row ? rowToJson(row) : null;
}

// PATCH body schema. Each field is optional; `streamUrl: null` clears it.
const stationPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'name must be 1..100 chars').max(100).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    language: z.string().trim().min(2).max(10).optional(),
    streamUrl: z
      .union([z.string().trim().url('streamUrl must be a valid URL').max(2048), z.null()])
      .optional(),
  })
  .strict();

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;
  try {
    const station = await fetchStation(db, gate.context.stationId);
    if (!station) return jsonError(404, 'Station not found');
    return Response.json({ station });
  } catch (err) {
    console.error('stations/me/get', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export async function onRequestPatch(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  if (!EDIT_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role to edit station identity');
  }

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = stationPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const patch: StationIdentityPatch = parsed.data;
  if (
    patch.name === undefined &&
    patch.timezone === undefined &&
    patch.language === undefined &&
    patch.streamUrl === undefined
  ) {
    return jsonError(400, 'Empty patch');
  }

  if (patch.timezone !== undefined && !validateIanaTimezone(patch.timezone)) {
    return jsonError(400, 'Invalid timezone');
  }

  if (patch.language !== undefined && !validateLanguage(patch.language)) {
    return jsonError(400, 'Invalid language code');
  }

  const db = ctx.env.DB!;

  const before = await fetchStation(db, gate.context.stationId);
  if (!before) return jsonError(404, 'Station not found');

  try {
    const upd = buildStationUpdateQuery(gate.context.stationId, patch);
    await db
      .prepare(upd.sql)
      .bind(...upd.params)
      .run();
  } catch (err) {
    console.error('stations/me/patch', err);
    return jsonError(500, err instanceof Error ? err.message : 'update failed');
  }

  const after = await fetchStation(db, gate.context.stationId);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'station',
    targetId: gate.context.stationId,
    before: {
      name: before.name,
      timezone: before.timezone,
      language: before.language,
      streamUrl: before.streamUrl,
    },
    after: after
      ? {
          name: after.name,
          timezone: after.timezone,
          language: after.language,
          streamUrl: after.streamUrl,
        }
      : null,
  });

  return Response.json({ station: after });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
