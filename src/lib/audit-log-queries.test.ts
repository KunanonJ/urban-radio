import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the api-base adapter so the unit tests never hit the network.
const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  apiUrl: (path: string) => path,
}));

import {
  buildAuditLogUrl,
  fetchAuditLogPage,
  fetchAuditLogCsv,
  KNOWN_AUDIT_ACTIONS,
  KNOWN_AUDIT_TARGET_TYPES,
} from './audit-log-queries';

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

describe('audit-log-queries', () => {
  test('buildAuditLogUrl > given no filters > pins to /api/audit-log and sets limit', () => {
    const url = buildAuditLogUrl({}, null, 50);
    expect(url.startsWith('/api/audit-log?')).toBe(true);
    expect(url).toContain('limit=50');
    expect(url).not.toContain('actorUserId=');
    expect(url).not.toContain('action=');
    expect(url).not.toContain('cursor=');
    // The format param is reserved for CSV — never set in the list URL.
    expect(url).not.toContain('format=csv');
  });

  test('buildAuditLogUrl > given filters + cursor > emits all params', () => {
    const url = buildAuditLogUrl(
      {
        actorUserId: 'u1',
        action: 'update',
        targetType: 'clock',
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z',
        search: 'morning',
      },
      'cursor-abc',
      25,
    );
    expect(url).toContain('actorUserId=u1');
    expect(url).toContain('action=update');
    expect(url).toContain('targetType=clock');
    expect(url).toContain('from=2026-01-01T00%3A00%3A00Z');
    expect(url).toContain('to=2026-02-01T00%3A00%3A00Z');
    expect(url).toContain('search=morning');
    expect(url).toContain('cursor=cursor-abc');
    expect(url).toContain('limit=25');
  });

  test('fetchAuditLogPage > parses entries and meta from API', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        entries: [
          {
            id: 'a1',
            at: '2026-05-13T10:00:00Z',
            actor: { userId: 'u1', username: 'demo' },
            action: 'create',
            targetType: 'clock',
            targetId: 'c1',
            before: null,
            after: { name: 'A' },
          },
        ],
        meta: { nextCursor: 'cursor-2', limit: 50 },
      }),
    );

    const page = await fetchAuditLogPage({}, null, 50);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      id: 'a1',
      action: 'create',
      targetType: 'clock',
      targetId: 'c1',
    });
    expect(page.entries[0].actor.username).toBe('demo');
    expect(page.entries[0].after).toEqual({ name: 'A' });
    expect(page.meta.nextCursor).toBe('cursor-2');
  });

  test('fetchAuditLogPage > given non-OK response > throws Error with detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'invalid range' }, { status: 400 }),
    );
    await expect(fetchAuditLogPage({}, null, 50)).rejects.toThrow(/invalid range/);
  });

  test('fetchAuditLogCsv > returns a Blob with text/csv MIME', async () => {
    const csv = 'At,Actor,Action\n2026-05-13T10:00:00Z,demo,create\n';
    apiFetchMock.mockResolvedValueOnce(
      new Response(csv, {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      }),
    );
    const blob = await fetchAuditLogCsv({ action: 'create' });
    // jsdom's Blob prototype chain differs from a Node-side `instanceof Blob`;
    // assert on the duck-typed surface instead (size + type + text()).
    expect(typeof blob.size).toBe('number');
    expect(blob.type).toMatch(/text\/csv/);
    const text = await blob.text();
    expect(text).toContain('At,Actor,Action');
  });

  test('fetchAuditLogCsv > sets format=csv on the URL', async () => {
    apiFetchMock.mockResolvedValueOnce(
      new Response('At\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
    );
    await fetchAuditLogCsv({ targetType: 'clock' });
    const [path] = apiFetchMock.mock.calls[0];
    expect(path).toContain('format=csv');
    expect(path).toContain('targetType=clock');
  });

  test('fetchAuditLogCsv > 413 > throws row_cap_exceeded with cap detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'row_cap_exceeded', details: { limit: 50_000 } }, { status: 413 }),
    );
    await expect(fetchAuditLogCsv({})).rejects.toThrow(/row_cap_exceeded/);
  });

  test('KNOWN_AUDIT_ACTIONS includes the union we wire into UI dropdowns', () => {
    expect(KNOWN_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'create',
        'update',
        'delete',
        'reorder',
        'stream_start',
        'stream_stop',
        'royalty_export',
        'audit_log_export',
        'ai_generate_voice',
        'ai_generate_text',
        'ai_generate_transcribe',
        'ai_generate_anr',
      ]),
    );
  });

  test('KNOWN_AUDIT_TARGET_TYPES includes the union we wire into UI dropdowns', () => {
    expect(KNOWN_AUDIT_TARGET_TYPES).toEqual(
      expect.arrayContaining([
        'clock',
        'clock_slot',
        'schedule_assignment',
        'radio_track',
        'voice_track',
        'station',
        'ai_usage',
      ]),
    );
  });
});
