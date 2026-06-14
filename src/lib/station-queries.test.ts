import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

import { fetchStation, patchStation, STATION_QUERY_KEY } from './station-queries';

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

describe('station-queries', () => {
  test('STATION_QUERY_KEY > stable identity', () => {
    expect(STATION_QUERY_KEY).toEqual(['station']);
  });

  test('fetchStation > GETs /api/stations/me and returns the station envelope', async () => {
    const station = {
      id: 'urban-radio',
      orgId: 'org-1',
      slug: 'urban-radio',
      name: 'Urban Radio',
      timezone: 'Asia/Bangkok',
      streamUrl: 'https://stream.example.com/live',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
    };
    apiFetchMock.mockResolvedValueOnce(makeJsonResponse({ station }));
    const result = await fetchStation();
    expect(result.station).toEqual(station);
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/stations/me');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  test('fetchStation > non-OK response > throws with detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'No station membership' }, { status: 403 }),
    );
    await expect(fetchStation()).rejects.toThrow(/No station membership/);
  });

  test('patchStation > PATCHes JSON to /api/stations/me with the patch body', async () => {
    const updated = {
      id: 'urban-radio',
      orgId: 'org-1',
      slug: 'urban-radio',
      name: 'Urban Radio v2',
      timezone: 'America/New_York',
      streamUrl: null,
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
    };
    apiFetchMock.mockResolvedValueOnce(makeJsonResponse({ station: updated }));
    const out = await patchStation({
      name: 'Urban Radio v2',
      timezone: 'America/New_York',
      streamUrl: null,
    });
    expect(out.station.name).toBe('Urban Radio v2');
    expect(out.station.streamUrl).toBeNull();
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/stations/me');
    expect(init?.method).toBe('PATCH');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Urban Radio v2',
      timezone: 'America/New_York',
      streamUrl: null,
    });
  });

  test('patchStation > non-OK response > throws with detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'Invalid timezone' }, { status: 400 }),
    );
    await expect(patchStation({ timezone: 'Mordor/Bad' })).rejects.toThrow(
      /Invalid timezone/,
    );
  });
});
