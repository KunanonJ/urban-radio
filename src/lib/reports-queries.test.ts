import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';

const apiFetchMock =
  vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

import {
  useReportOverview,
  useReportPlaysByDay,
  useReportTopTracks,
  useReportTopHours,
  useReportListeningSummary,
} from './reports-queries';

function makeJsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

const RANGE = { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z' };

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('reports-queries', () => {
  describe('useReportOverview', () => {
    test('useReportOverview > given range > calls overview endpoint with from/to', async () => {
      const payload = {
        overview: {
          totalPlays: 4321,
          uniqueTitles: 412,
          daysWithActivity: 30,
          totalListeningHours: 612.5,
        },
        range: { from: RANGE.from, to: RANGE.to },
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useReportOverview(RANGE), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.overview.totalPlays).toBe(4321);

      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('/api/reports/overview?');
      expect(path).toContain(`from=${encodeURIComponent(RANGE.from)}`);
      expect(path).toContain(`to=${encodeURIComponent(RANGE.to)}`);
    });

    test('useReportOverview > given empty range > does not fetch', async () => {
      const { result } = renderHook(() => useReportOverview({}), {
        wrapper: makeWrapper(),
      });

      // Brief wait to allow any unintended fetch to happen.
      await new Promise((r) => setTimeout(r, 25));
      expect(apiFetchMock).not.toHaveBeenCalled();
      expect(result.current.isFetching).toBe(false);
    });

    test('useReportOverview > given non-OK response > sets error', async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse({ error: 'boom' }, { status: 500 }),
      );

      const { result } = renderHook(() => useReportOverview(RANGE), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('useReportPlaysByDay', () => {
    test('useReportPlaysByDay > given range > resolves with days array', async () => {
      const payload = {
        days: [
          { day: '2026-04-29', plays: 12 },
          { day: '2026-04-30', plays: 18 },
        ],
        range: { from: RANGE.from, to: RANGE.to },
        source: 'auto',
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useReportPlaysByDay(RANGE, 'auto'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.days).toHaveLength(2);

      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('/api/reports/plays-by-day?');
      expect(path).toContain('source=auto');
    });

    test('useReportPlaysByDay > omits source when not provided', async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse({ days: [], range: { from: RANGE.from, to: RANGE.to } }),
      );

      const { result } = renderHook(() => useReportPlaysByDay(RANGE), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const [path] = apiFetchMock.mock.calls[0];
      expect(path).not.toContain('source=');
    });
  });

  describe('useReportTopTracks', () => {
    test('useReportTopTracks > given limit > sends limit query param', async () => {
      const payload = {
        tracks: [
          { title: 'Song A', artist: 'Artist 1', plays: 50 },
          { title: 'Song B', artist: 'Artist 2', plays: 22 },
        ],
        limit: 10,
        range: { from: RANGE.from, to: RANGE.to },
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(
        () => useReportTopTracks(RANGE, { limit: 10 }),
        { wrapper: makeWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.tracks).toHaveLength(2);

      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('/api/reports/top-tracks?');
      expect(path).toContain('limit=10');
    });
  });

  describe('useReportTopHours', () => {
    test('useReportTopHours > given range > resolves with 24-hour buckets', async () => {
      const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, plays: i }));
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse({ hours }));

      const { result } = renderHook(() => useReportTopHours(RANGE), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.hours).toHaveLength(24);

      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('/api/reports/top-hours?');
    });
  });

  describe('useReportListeningSummary', () => {
    test('useReportListeningSummary > given range > resolves with summary', async () => {
      const payload = {
        summary: {
          totalPlays: 100,
          totalListeningHours: 33.4,
          sourceBreakdown: [
            { source: 'auto', plays: 80 },
            { source: 'manual', plays: 20 },
          ],
        },
        range: { from: RANGE.from, to: RANGE.to },
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useReportListeningSummary(RANGE), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.summary.totalPlays).toBe(100);
      expect(result.current.data?.summary.sourceBreakdown).toHaveLength(2);

      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('/api/reports/listening-summary?');
    });
  });
});
