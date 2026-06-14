import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the api-base adapter so the unit tests never hit the network.
const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  apiUrl: (path: string) => path,
}));

import {
  buildCreateFormData,
  buildVoiceTracksUrl,
  fetchVoiceTracksPage,
} from './voice-track-queries';

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

describe('voice-track-queries', () => {
  test('buildVoiceTracksUrl > given no filters > emits only the limit param', () => {
    const url = buildVoiceTracksUrl({}, null, 50);
    // Always pinned to /api/voice-tracks — never a different prefix.
    expect(url.startsWith('/api/voice-tracks?')).toBe(true);
    expect(url).toContain('limit=50');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('cursor=');
  });

  test('buildVoiceTracksUrl > given status filter and cursor > emits both params', () => {
    const url = buildVoiceTracksUrl({ status: 'ready' }, 'abc123', 25);
    expect(url).toContain('status=ready');
    expect(url).toContain('cursor=abc123');
    expect(url).toContain('limit=25');
  });

  test('fetchVoiceTracksPage > given API returns 2 voice tracks > exposes normalized rows + streamUrl', async () => {
    // 2 rows with no streamUrl from the server — we expect the hook to fill
    // in the derived `/api/voice-tracks/:id/audio` URL.
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        voiceTracks: [
          {
            id: 'vt-1',
            stationId: 's1',
            recordedBy: 'u1',
            storageKey: 'voice-tracks/s1/vt-1.webm',
            durationMs: 12000,
            transcript: 'Hello world',
            targetClockSlotId: null,
            status: 'draft',
            aiGenerated: 0,
            createdAt: '2026-05-13T00:00:00Z',
          },
          {
            id: 'vt-2',
            stationId: 's1',
            recordedBy: null,
            storageKey: 'voice-tracks/s1/vt-2.webm',
            durationMs: 5000,
            transcript: null,
            targetClockSlotId: null,
            status: 'ready',
            aiGenerated: 1,
            createdAt: '2026-05-12T00:00:00Z',
          },
        ],
        meta: { nextCursor: null, limit: 50 },
      }),
    );

    const page = await fetchVoiceTracksPage({}, null, 50);
    expect(page.voiceTracks).toHaveLength(2);
    expect(page.voiceTracks[0]).toMatchObject({
      id: 'vt-1',
      status: 'draft',
      aiGenerated: 0,
      streamUrl: '/api/voice-tracks/vt-1/audio',
    });
    expect(page.voiceTracks[1]).toMatchObject({
      id: 'vt-2',
      status: 'ready',
      aiGenerated: 1,
      streamUrl: '/api/voice-tracks/vt-2/audio',
    });
    expect(page.meta).toEqual({ nextCursor: null, limit: 50 });
  });

  test('fetchVoiceTracksPage > given API returns nextCursor > preserves cursor in meta', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        voiceTracks: [],
        meta: { nextCursor: 'cursor-2', limit: 10 },
      }),
    );
    const page = await fetchVoiceTracksPage({ status: 'ready' }, null, 10);
    expect(page.meta).toEqual({ nextCursor: 'cursor-2', limit: 10 });
    // Verify the URL was built with the filter.
    const [path] = apiFetchMock.mock.calls[0];
    expect(path).toContain('status=ready');
  });

  test('fetchVoiceTracksPage > given non-OK response with error body > throws Error with detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'invalid status' }, { status: 400 }),
    );
    await expect(fetchVoiceTracksPage({}, null, 50)).rejects.toThrow(/invalid status/);
  });

  test('buildCreateFormData > given blob + meta > FormData contains both fields', () => {
    const audioBlob = new Blob(['fake audio'], { type: 'audio/webm' });
    const form = buildCreateFormData({
      audioBlob,
      meta: { durationMs: 1500, status: 'draft' },
    });
    // FormData.has() — works in jsdom.
    expect(form.has('file')).toBe(true);
    expect(form.has('meta')).toBe(true);
    const meta = form.get('meta');
    expect(typeof meta).toBe('string');
    expect(JSON.parse(meta as string)).toMatchObject({ durationMs: 1500, status: 'draft' });
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
  });
});
