import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock @/lib/api-base.apiFetch so we can return canned responses without
// hitting the network.
const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

import {
  fetchStreamStatus,
  STREAM_STATUS_QUERY_KEY,
  type StreamStatusJson,
} from './stream-status-queries';

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

describe('stream-status-queries', () => {
  test('STREAM_STATUS_QUERY_KEY > stable identity', () => {
    // The cache key is exported so consumers (e.g. tests, prefetchers) can
    // share it. Verify the shape stays as [stream, status].
    expect(STREAM_STATUS_QUERY_KEY).toEqual(['stream', 'status']);
  });

  test('fetchStreamStatus > given 200 response > resolves with parsed status JSON', async () => {
    const payload: StreamStatusJson = {
      status: {
        connected: true,
        mountPoint: '/stub/s1',
        listeners: 17,
        bitrate: 128,
        uptimeSeconds: 42,
        source: 'stub',
      },
    };
    apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

    const out = await fetchStreamStatus();
    expect(out).toEqual(payload);
    // Verify the path + credentials were passed through.
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/stream/status');
    expect(init?.credentials).toBe('include');
  });

  test('fetchStreamStatus > given 500 response > throws Error with HTTP status', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'boom' }, { status: 500 }),
    );

    await expect(fetchStreamStatus()).rejects.toThrow(/HTTP 500/);
  });

  test('fetchStreamStatus > given disconnected status from stub source > preserves null mountPoint and 0 listeners', async () => {
    const payload: StreamStatusJson = {
      status: {
        connected: false,
        mountPoint: null,
        listeners: 0,
        bitrate: null,
        uptimeSeconds: 0,
        source: 'stub',
      },
    };
    apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

    const out = await fetchStreamStatus();
    expect(out.status.connected).toBe(false);
    expect(out.status.mountPoint).toBeNull();
    expect(out.status.listeners).toBe(0);
    expect(out.status.source).toBe('stub');
  });
});
