/**
 * TanStack Query hooks for the Phase 5 reports endpoints:
 *   - GET /api/reports/overview
 *   - GET /api/reports/plays-by-day
 *   - GET /api/reports/top-tracks
 *   - GET /api/reports/top-hours
 *   - GET /api/reports/listening-summary
 *
 * Every hook takes a `DateRange` (`from`/`to` ISO strings). When both are
 * missing the hook is disabled — backend always expects explicit window
 * params and we don't want to default to "all time" by accident.
 *
 * Responses are returned as-is from the backend, modulo a small
 * `apiFetch` JSON wrapper.
 */
import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface ReportRangeMeta {
  from: string;
  to: string;
}

export interface ReportOverview {
  totalPlays: number;
  uniqueTitles: number;
  daysWithActivity: number;
  totalListeningHours: number;
}

export interface ReportOverviewResponse {
  overview: ReportOverview;
  range: ReportRangeMeta;
}

export interface PlaysByDayBucket {
  day: string;
  plays: number;
}

export interface PlaysByDayResponse {
  days: PlaysByDayBucket[];
  range: ReportRangeMeta;
  source?: string;
}

export interface TopTrackRow {
  title: string;
  artist: string;
  plays: number;
}

export interface TopTracksResponse {
  tracks: TopTrackRow[];
  limit: number;
  range: ReportRangeMeta;
}

export interface TopHourBucket {
  hour: number;
  plays: number;
}

export interface TopHoursResponse {
  hours: TopHourBucket[];
}

export interface SourceBreakdownRow {
  source: string;
  plays: number;
}

export interface ListeningSummary {
  totalPlays: number;
  totalListeningHours: number;
  sourceBreakdown: SourceBreakdownRow[];
}

export interface ListeningSummaryResponse {
  summary: ListeningSummary;
  range: ReportRangeMeta;
}

function rangeKey(range: DateRange): string {
  return `${range.from ?? ''}|${range.to ?? ''}`;
}

function buildQs(range: DateRange, extra?: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ─── overview ──────────────────────────────────────────────────────────────

export const REPORTS_OVERVIEW_QUERY_KEY = ['reports', 'overview'] as const;

export function useReportOverview(
  range: DateRange,
): UseQueryResult<ReportOverviewResponse, Error> {
  return useQuery({
    queryKey: [...REPORTS_OVERVIEW_QUERY_KEY, rangeKey(range)],
    queryFn: () =>
      fetchJson<ReportOverviewResponse>(`/api/reports/overview${buildQs(range)}`),
    enabled: Boolean(range.from || range.to),
    staleTime: 60_000,
  });
}

// ─── plays-by-day ──────────────────────────────────────────────────────────

export const REPORTS_PLAYS_BY_DAY_QUERY_KEY = ['reports', 'plays-by-day'] as const;

export function useReportPlaysByDay(
  range: DateRange,
  source?: string,
): UseQueryResult<PlaysByDayResponse, Error> {
  return useQuery({
    queryKey: [...REPORTS_PLAYS_BY_DAY_QUERY_KEY, rangeKey(range), source ?? ''],
    queryFn: () =>
      fetchJson<PlaysByDayResponse>(
        `/api/reports/plays-by-day${buildQs(range, { source })}`,
      ),
    enabled: Boolean(range.from || range.to),
    staleTime: 60_000,
  });
}

// ─── top-tracks ────────────────────────────────────────────────────────────

export interface TopTracksOpts {
  limit?: number;
  source?: string;
}

export const REPORTS_TOP_TRACKS_QUERY_KEY = ['reports', 'top-tracks'] as const;

export function useReportTopTracks(
  range: DateRange,
  opts: TopTracksOpts = {},
): UseQueryResult<TopTracksResponse, Error> {
  return useQuery({
    queryKey: [
      ...REPORTS_TOP_TRACKS_QUERY_KEY,
      rangeKey(range),
      opts.limit ?? 0,
      opts.source ?? '',
    ],
    queryFn: () =>
      fetchJson<TopTracksResponse>(
        `/api/reports/top-tracks${buildQs(range, { limit: opts.limit, source: opts.source })}`,
      ),
    enabled: Boolean(range.from || range.to),
    staleTime: 60_000,
  });
}

// ─── top-hours ─────────────────────────────────────────────────────────────

export const REPORTS_TOP_HOURS_QUERY_KEY = ['reports', 'top-hours'] as const;

export function useReportTopHours(
  range: DateRange,
): UseQueryResult<TopHoursResponse, Error> {
  return useQuery({
    queryKey: [...REPORTS_TOP_HOURS_QUERY_KEY, rangeKey(range)],
    queryFn: () =>
      fetchJson<TopHoursResponse>(`/api/reports/top-hours${buildQs(range)}`),
    enabled: Boolean(range.from || range.to),
    staleTime: 60_000,
  });
}

// ─── listening-summary ─────────────────────────────────────────────────────

export const REPORTS_LISTENING_SUMMARY_QUERY_KEY = ['reports', 'listening-summary'] as const;

export function useReportListeningSummary(
  range: DateRange,
): UseQueryResult<ListeningSummaryResponse, Error> {
  return useQuery({
    queryKey: [...REPORTS_LISTENING_SUMMARY_QUERY_KEY, rangeKey(range)],
    queryFn: () =>
      fetchJson<ListeningSummaryResponse>(
        `/api/reports/listening-summary${buildQs(range)}`,
      ),
    enabled: Boolean(range.from || range.to),
    staleTime: 60_000,
  });
}
