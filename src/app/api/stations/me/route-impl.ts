/**
 * /api/stations/me — Next.js port.
 *
 * Mirrors `functions/api/stations/me.ts` for GET (read) and PATCH (update),
 * with one deliberate extension: the GET response includes `member` (the
 * station_members row from the auth gate) and `currentUser` (the session's
 * id + username) alongside the legacy `station` envelope, so the Next stack
 * carries enough context for client UIs without a second round-trip. The
 * `station` field still matches the Cloudflare shape byte-for-byte; the
 * extra fields are additive and safe for existing clients.
 *
 * Auth: `requireStation` (401 / 403). PATCH additionally gates on role
 * (admin / producer only).
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { stations } from '@/db/schema';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { writeAuditLog } from '@/server/audit-log';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  validateIanaTimezone,
  validateLanguage,
  type StationIdentityPatch,
  type StationRow,
} from '@/server/station-queries';

const EDIT_ROLES = new Set(['admin', 'producer']);

interface StationDbRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  timezone: string;
  streamUrl: string | null;
  language: string | null;
  createdAt: string;
}

function rowToJson(row: StationDbRow): StationRow {
  return {
    id: row.id,
    orgId: row.orgId,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    streamUrl: row.streamUrl,
    language: row.language ?? 'en',
    createdAt: row.createdAt,
  };
}

async function fetchStation(
  db: DbClient,
  stationId: string,
): Promise<StationRow | null> {
  const rows = await db
    .select({
      id: stations.id,
      orgId: stations.orgId,
      slug: stations.slug,
      name: stations.name,
      timezone: stations.timezone,
      streamUrl: stations.streamUrl,
      language: stations.language,
      createdAt: stations.createdAt,
    })
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  const row = rows[0];
  return row ? rowToJson(row as StationDbRow) : null;
}

// PATCH body schema. Every field optional; `streamUrl: null` clears.
const stationPatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name must be 1..100 chars')
      .max(100)
      .optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    language: z.string().trim().min(2).max(10).optional(),
    streamUrl: z
      .union([
        z.string().trim().url('streamUrl must be a valid URL').max(2048),
        z.null(),
      ])
      .optional(),
  })
  .strict();

export interface StationsMeDeps {
  db?: DbClient;
  secret?: string;
}

export async function getStationsMe(
  request: Request,
  deps: StationsMeDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, {
    db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  try {
    const station = await fetchStation(db, gate.context.stationId);
    if (!station) return jsonError(404, 'Station not found');
    return jsonOk({
      station,
      member: {
        stationId: gate.context.stationId,
        userId: gate.context.userId,
        role: gate.context.role,
      },
      currentUser: {
        id: gate.context.userId,
        username: gate.context.username,
      },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'stations/me/get' }));
  }
}

export async function patchStationsMe(
  request: Request,
  deps: StationsMeDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, {
    db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  if (!EDIT_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role to edit station identity');
  }

  let raw: unknown;
  try {
    raw = await request.json();
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

  const before = await fetchStation(db, gate.context.stationId);
  if (!before) return jsonError(404, 'Station not found');

  try {
    const set: Partial<{
      name: string;
      timezone: string;
      language: string;
      streamUrl: string | null;
    }> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.timezone !== undefined) set.timezone = patch.timezone;
    if (patch.language !== undefined) set.language = patch.language;
    if (patch.streamUrl !== undefined) set.streamUrl = patch.streamUrl;
    await db
      .update(stations)
      .set(set)
      .where(eq(stations.id, gate.context.stationId));
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'stations/me/patch' }));
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

  return jsonOk({ station: after });
}

export async function GET(request: Request): Promise<Response> {
  return getStationsMe(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return patchStationsMe(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET', 'PATCH']);
}
export async function PUT(): Promise<Response> {
  return methodNotAllowed(['GET', 'PATCH']);
}
export async function DELETE(): Promise<Response> {
  return methodNotAllowed(['GET', 'PATCH']);
}
