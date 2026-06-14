import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  apiUrl: (path: string) => path,
}));

import {
  buildPresenceUrl,
  fetchPresence,
  postPresenceHeartbeat,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_POLL_INTERVAL_MS,
  PRESENCE_TARGET_TYPES,
} from './presence-queries';

function makeJsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('presence-queries (client)', () => {
  test('PRESENCE_TARGET_TYPES mirrors the server enum', () => {
    expect(PRESENCE_TARGET_TYPES).toEqual([
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
      'schedule_cell',
    ]);
  });

  test('PRESENCE_POLL_INTERVAL_MS and PRESENCE_HEARTBEAT_INTERVAL_MS default to 5000ms', () => {
    expect(PRESENCE_POLL_INTERVAL_MS).toBe(5000);
    expect(PRESENCE_HEARTBEAT_INTERVAL_MS).toBe(5000);
  });

  test('buildPresenceUrl > emits targetType + targetId', () => {
    const url = buildPresenceUrl({ type: 'clock', id: 'clk-1' });
    expect(url.startsWith('/api/presence?')).toBe(true);
    expect(url).toContain('targetType=clock');
    expect(url).toContain('targetId=clk-1');
  });

  test('fetchPresence > returns normalized payload', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        sessions: [
          {
            id: 'p-1',
            userId: 'user-1',
            username: 'demo',
            targetType: 'clock',
            targetId: 'clk-1',
            lastHeartbeatAt: '2026-05-14T10:00:00Z',
            createdAt: '2026-05-14T10:00:00Z',
          },
        ],
        meta: { ttlSeconds: 15 },
      }),
    );
    const out = await fetchPresence({ type: 'clock', id: 'clk-1' });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].userId).toBe('user-1');
    expect(out.sessions[0].username).toBe('demo');
    expect(out.sessions[0].targetType).toBe('clock');
    expect(out.meta.ttlSeconds).toBe(15);
  });

  test('fetchPresence > non-OK > throws with server detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'Invalid targetType' }, { status: 400 }),
    );
    await expect(
      fetchPresence({ type: 'clock', id: 'x' }),
    ).rejects.toThrow(/Invalid targetType/);
  });

  test('postPresenceHeartbeat > POSTs JSON body to /api/presence/heartbeat', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        sessions: [
          {
            id: 'p-1',
            userId: 'user-1',
            username: 'demo',
            targetType: 'voice_track',
            targetId: 'vt-1',
            lastHeartbeatAt: '2026-05-14T10:00:01Z',
            createdAt: '2026-05-14T10:00:00Z',
          },
        ],
        meta: { ttlSeconds: 15 },
      }),
    );
    const out = await postPresenceHeartbeat({
      targetType: 'voice_track',
      targetId: 'vt-1',
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].targetType).toBe('voice_track');
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/presence/heartbeat');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      targetType: 'voice_track',
      targetId: 'vt-1',
    });
  });

  test('postPresenceHeartbeat > non-OK > throws with server detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'Validation failed' }, { status: 400 }),
    );
    await expect(
      postPresenceHeartbeat({ targetType: 'clock', targetId: 'x' }),
    ).rejects.toThrow(/Validation failed/);
  });

  test('normalizeSession defends against unknown targetType (returns clock fallback)', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        sessions: [
          {
            id: 'p-1',
            userId: 'user-1',
            username: 'demo',
            targetType: 'future-type',
            targetId: 'x',
            lastHeartbeatAt: '2026-05-14T10:00:00Z',
            createdAt: '2026-05-14T10:00:00Z',
          },
        ],
        meta: { ttlSeconds: 15 },
      }),
    );
    const out = await fetchPresence({ type: 'clock', id: 'x' });
    // Falls back to 'clock' so the avatar stack doesn't crash on a new server type.
    expect(out.sessions[0].targetType).toBe('clock');
  });
});
