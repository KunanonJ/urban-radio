/**
 * Tests for `requireStation` — the Next-side station gate.
 *
 * Uses pg-mem via `createTestDbWithUser` so we exercise the real Drizzle
 * query path without a Postgres server. The session itself is signed with
 * the same `jose` HS256 path the Cloudflare side uses, so a session token
 * minted in tests is byte-identical to a production one.
 *
 * @vitest-environment node
 *   `jose` autoloads its `webapi` build under jsdom and that build's
 *   `instanceof Uint8Array` checks fail across realms. Run these in node.
 */

// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { signSessionToken } from './session-jwt';
import { requireStation } from './require-station';
import {
  createTestDb,
  createTestDbWithUser,
  seedAuthFixture,
} from '@/server/test-utils/db';

const SECRET = 'test-secret-do-not-use-in-prod';

async function buildAuthedRequest(
  userId: string,
  username: string,
  url = 'http://localhost/api/anything',
): Promise<Request> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  return new Request(url, {
    headers: { Cookie: `sb_session=${encodeURIComponent(token)}` },
  });
}

describe('requireStation', () => {
  test('401 when AUTH_JWT_SECRET is missing', async () => {
    const { handle } = createTestDbWithUser();
    const request = new Request('http://localhost/api/anything');

    // Pass empty string to simulate unset env without touching process.env.
    const result = await requireStation(request, {
      db: handle.db,
      secret: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  test('401 when no session cookie or Authorization header', async () => {
    const { handle } = createTestDbWithUser();
    const request = new Request('http://localhost/api/anything');

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  test('401 when JWT signature is wrong', async () => {
    const { handle, user } = createTestDbWithUser();
    const token = await signSessionToken('other-secret', {
      sub: user.userId,
      username: user.username,
    });
    const request = new Request('http://localhost/api/anything', {
      headers: { Cookie: `sb_session=${token}` },
    });

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  test('403 when session valid but user has no station membership', async () => {
    const handle = createTestDb();
    // Seed an org/station/user but DO NOT seed station_members.
    handle.mem.public.none(
      "INSERT INTO organizations (id, name, plan, created_at) VALUES ('o', 'O', 'free', '2026-01-01T00:00:00Z')",
    );
    handle.mem.public.none(
      "INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('s', 'o', 's', 'S', 'UTC', '2026-01-01T00:00:00Z')",
    );
    handle.mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u', 'u', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const request = await buildAuthedRequest('u', 'u');

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe('No station membership');
  });

  test('200 with full context when session + membership valid', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u1',
      username: 'alice',
      role: 'admin',
    });
    const request = await buildAuthedRequest(user.userId, user.username);

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.userId).toBe('u1');
    expect(result.context.username).toBe('alice');
    expect(result.context.stationId).toBe(user.stationId);
    expect(result.context.role).toBe('admin');
  });

  test('accepts Authorization: Bearer in lieu of cookie', async () => {
    const { handle, user } = createTestDbWithUser();
    const token = await signSessionToken(SECRET, {
      sub: user.userId,
      username: user.username,
    });
    const request = new Request('http://localhost/api/anything', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.userId).toBe(user.userId);
  });

  test('picks first station by (created_at, station_id) when user belongs to multiple', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u-multi',
      username: 'multi',
      stationId: 'station-z',
      orgId: 'org-multi',
    });
    // Seed a SECOND station that was created earlier — should be returned.
    handle.mem.public.none(
      "INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('station-a', 'org-multi', 'a', 'A', 'UTC', '2025-12-31T00:00:00Z')",
    );
    handle.mem.public.none(
      "INSERT INTO station_members (station_id, user_id, role, created_at) VALUES ('station-a', 'u-multi', 'producer', '2025-12-31T00:00:00Z')",
    );
    const request = await buildAuthedRequest(user.userId, user.username);

    const result = await requireStation(request, {
      db: handle.db,
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.stationId).toBe('station-a');
    expect(result.context.role).toBe('producer');
  });

  test('seedAuthFixture exposes its returned IDs', () => {
    const handle = createTestDb();
    const seeded = seedAuthFixture(handle, {
      userId: 'fixture-user',
      username: 'fx',
      stationId: 's-fixture',
      role: 'programmer',
    });
    expect(seeded.userId).toBe('fixture-user');
    expect(seeded.stationId).toBe('s-fixture');
    expect(seeded.role).toBe('programmer');
  });
});
