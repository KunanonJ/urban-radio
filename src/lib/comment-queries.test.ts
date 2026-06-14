import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  apiUrl: (path: string) => path,
}));

import {
  buildCommentsUrl,
  fetchCommentsPage,
  postCreateComment,
  patchUpdateComment,
  deleteComment,
} from './comment-queries';

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

describe('comment-queries', () => {
  test('buildCommentsUrl > emits targetType + targetId + limit', () => {
    const url = buildCommentsUrl(
      { type: 'clock', id: 'clk-1' },
      { includeResolved: false },
      null,
      50,
    );
    expect(url.startsWith('/api/comments?')).toBe(true);
    expect(url).toContain('targetType=clock');
    expect(url).toContain('targetId=clk-1');
    expect(url).toContain('limit=50');
    expect(url).not.toContain('includeResolved=');
    expect(url).not.toContain('cursor=');
  });

  test('buildCommentsUrl > includeResolved=true emits the flag', () => {
    const url = buildCommentsUrl(
      { type: 'voice_track', id: 'vt-1' },
      { includeResolved: true },
      'cur-9',
      25,
    );
    expect(url).toContain('targetType=voice_track');
    expect(url).toContain('targetId=vt-1');
    expect(url).toContain('includeResolved=true');
    expect(url).toContain('cursor=cur-9');
    expect(url).toContain('limit=25');
  });

  test('fetchCommentsPage > returns normalized page', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        comments: [
          {
            id: 'c-1',
            stationId: 's',
            authorUserId: 'u-1',
            targetType: 'clock',
            targetId: 'clk-1',
            body: 'hi',
            resolvedAt: null,
            resolvedByUserId: null,
            createdAt: '2026-05-14T10:00:00Z',
            updatedAt: '2026-05-14T10:00:00Z',
            author: { userId: 'u-1', username: 'demo' },
          },
        ],
        meta: { nextCursor: null, limit: 50 },
      }),
    );
    const page = await fetchCommentsPage(
      { type: 'clock', id: 'clk-1' },
      { includeResolved: false },
      null,
      50,
    );
    expect(page.comments).toHaveLength(1);
    expect(page.comments[0].id).toBe('c-1');
    expect(page.comments[0].author.username).toBe('demo');
    expect(page.meta).toEqual({ nextCursor: null, limit: 50 });
  });

  test('fetchCommentsPage > non-OK response > throws with detail', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'Invalid query parameters' }, { status: 400 }),
    );
    await expect(
      fetchCommentsPage({ type: 'clock', id: 'x' }, {}, null, 50),
    ).rejects.toThrow(/Invalid query parameters/);
  });

  test('postCreateComment > POSTs JSON to /api/comments', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse(
        {
          comment: {
            id: 'c-new',
            stationId: 's',
            authorUserId: 'u-1',
            targetType: 'clock',
            targetId: 'clk-1',
            body: 'fresh',
            resolvedAt: null,
            resolvedByUserId: null,
            createdAt: '2026-05-14T10:00:00Z',
            updatedAt: '2026-05-14T10:00:00Z',
            author: { userId: 'u-1', username: 'demo' },
          },
        },
        { status: 201 },
      ),
    );
    const out = await postCreateComment({
      targetType: 'clock',
      targetId: 'clk-1',
      body: 'fresh',
    });
    expect(out.comment.id).toBe('c-new');
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/comments');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      targetType: 'clock',
      targetId: 'clk-1',
      body: 'fresh',
    });
  });

  test('patchUpdateComment > PATCHes JSON to /api/comments/:id', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        comment: {
          id: 'c-1',
          stationId: 's',
          authorUserId: 'u-1',
          targetType: 'clock',
          targetId: 'clk-1',
          body: 'edited',
          resolvedAt: null,
          resolvedByUserId: null,
          createdAt: '2026-05-14T10:00:00Z',
          updatedAt: '2026-05-14T10:05:00Z',
          author: { userId: 'u-1', username: 'demo' },
        },
      }),
    );
    const out = await patchUpdateComment('c-1', { body: 'edited' });
    expect(out.comment.body).toBe('edited');
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/comments/c-1');
    expect(init?.method).toBe('PATCH');
  });

  test('deleteComment > DELETEs to /api/comments/:id', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, deleted: { id: 'c-1' } }),
    );
    await deleteComment('c-1');
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/comments/c-1');
    expect(init?.method).toBe('DELETE');
  });

  test('deleteComment > non-OK > throws', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: 'Insufficient role' }, { status: 403 }),
    );
    await expect(deleteComment('c-1')).rejects.toThrow(/Insufficient role/);
  });
});
