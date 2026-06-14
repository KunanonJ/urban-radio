/**
 * Page-level accessibility audits.
 *
 * Mounts each of the 10 main pages with the bare-minimum providers + mocks,
 * then runs axe-core against the resulting DOM. The mocks mirror the patterns
 * already established in the per-page test files (see e.g.
 * `src/views/app/TracksPage.test.tsx`) so the rendered tree is realistic.
 *
 * Goals:
 *   1. Catch regressions in critical a11y rules: button-name, label, link-name,
 *      list, heading-order, landmark-one-main, aria-* validity, etc.
 *   2. Surface follow-up work in docs/A11Y-REPORT.md for issues that cannot be
 *      fixed in this batch (deep component changes, color contrast, etc.).
 *
 * Conventions:
 *   - We disable `region` and `color-contrast` rules in jsdom (see
 *     `a11y-helpers.ts` for the rationale). Other axe rules at WCAG 2.1 AA
 *     remain enabled.
 *   - Heavy components that fail to mount cleanly in jsdom (Tremor charts,
 *     WaveSurfer, dnd-kit overlays) are stubbed to a simple <div>. The point
 *     of the audit is the **shell** of each page, not third-party internals.
 */
import { afterEach, beforeAll, beforeEach, describe, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expectNoA11yViolations } from './a11y-helpers';

// ── Global stubs / providers shared across all 10 page audits ───────────────

// ResizeObserver is missing in jsdom. Several pages (virtualized tables,
// charts) call it on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??=
    ResizeObserverStub;

  // Some virtualized lists ask for offsetHeight/offsetWidth.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 1024;
    },
  });
});

// ── i18n + Next.js + Sonner — these are universal mocks. ─────────────────────

vi.mock('react-i18next', () => ({
  // A pass-through translator that returns a sensible string for any key.
  // We don't want raw "foo.bar.baz" strings showing up in the rendered DOM
  // because that can confuse a few axe rules (heading-order, link-name).
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; minutes?: number }) => {
      // Convert dot keys to title-cased text: "tracks.title" → "Tracks Title".
      const base = key
        .split('.')
        .map((s) => s.replace(/([A-Z])/g, ' $1').trim())
        .join(' ')
        .replace(/(?:^|\s)\S/g, (m) => m.toUpperCase());
      if (opts?.count !== undefined) return `${base} (${opts.count})`;
      if (opts?.minutes !== undefined) return `${base} (${opts.minutes} min)`;
      return base;
    },
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  } & Record<string, unknown>) => (
    <a href={typeof href === 'string' ? href : '#'} className={className} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
  const searchParams = new URLSearchParams();
  return {
    useRouter: () => router,
    useSearchParams: () => ({
      get: (k: string) => searchParams.get(k),
      has: (k: string) => searchParams.has(k),
      toString: () => searchParams.toString(),
    }),
    usePathname: () => '/app',
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('framer-motion', () => {
  const passthrough = ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
    // Strip motion-only props (whileInView, initial, animate, transition…) so
    // they don't end up as DOM attributes axe might inspect.
    const safe = Object.fromEntries(
      Object.entries(rest).filter(
        ([k]) => !/^(initial|animate|whileInView|whileHover|whileTap|transition|exit|viewport)$/i.test(k),
      ),
    );
    return <div {...safe}>{children}</div>;
  };
  return {
    motion: new Proxy(
      {},
      {
        get: () => passthrough,
      },
    ),
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── Heavy component stubs (chart libs, audio graph, virtualized table) ─────

vi.mock('@tremor/react', () => ({
  AreaChart: () => <div data-stub="tremor-area-chart" />,
  BarChart: () => <div data-stub="tremor-bar-chart" />,
  LineChart: () => <div data-stub="tremor-line-chart" />,
  DonutChart: () => <div data-stub="tremor-donut-chart" />,
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Title: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  Text: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Bar: () => null,
  Line: () => null,
  Area: () => null,
  Legend: () => null,
}));

vi.mock('@/components/live/Mixer', () => ({
  Mixer: () => <section aria-label="Mixer (stub)" data-stub="mixer" />,
}));

vi.mock('@/components/live/NowNextQueueStrip', () => ({
  NowNextQueueStrip: () => <section aria-label="Now/Next/Queue (stub)" data-stub="strip" />,
}));

vi.mock('@/components/live/LiveStudioHotkeys', () => ({
  LiveStudioHotkeys: () => null,
}));

vi.mock('@/components/live/HealthStrip', () => ({
  HealthStrip: () => <section aria-label="Health (stub)" data-stub="health" />,
}));

vi.mock('@/components/live/QuickVTPanel', () => ({
  QuickVTPanel: () => <section aria-label="Quick VT (stub)" data-stub="quick-vt" />,
}));

vi.mock('@/lib/audio-graph', () => ({
  createAudioGraph: () => null,
}));

vi.mock('@/components/library/VirtualizedTrackTable', () => ({
  VirtualizedTrackTable: () => (
    <div role="grid" aria-label="Tracks (stub)" data-stub="virtualized-track-table" />
  ),
}));

vi.mock('@/components/library/TrackPreviewPane', () => ({
  TrackPreviewPane: () => null,
}));

vi.mock('@/components/library/FacetedFilterBar', () => ({
  FacetedFilterBar: () => (
    <div role="region" aria-label="Filters (stub)" data-stub="faceted-filter-bar" />
  ),
}));

vi.mock('@/components/schedule/WeekGrid', () => ({
  WeekGrid: () => <div role="grid" aria-label="Weekly schedule (stub)" data-stub="week-grid" />,
}));

vi.mock('@/components/schedule/AssignClockDialog', () => ({
  AssignClockDialog: () => null,
}));

vi.mock('@/components/schedule/ConflictResolutionDialog', () => ({
  ConflictResolutionDialog: () => null,
}));

vi.mock('@/components/audit/AuditLogFilters', () => ({
  AuditLogFilters: () => (
    <div role="region" aria-label="Filters (stub)" data-stub="audit-log-filters" />
  ),
}));

vi.mock('@/components/audit/AuditLogList', () => ({
  AuditLogList: () => <ul aria-label="Audit log entries (stub)" data-stub="audit-log-list" />,
}));

vi.mock('@/components/voice-tracks/VoiceTrackList', () => ({
  VoiceTrackList: () => (
    <ul aria-label="Voice tracks (stub)" data-stub="voice-track-list" />
  ),
}));

vi.mock('@/components/voice-tracks/VoiceTrackRecorder', () => ({
  VoiceTrackRecorder: () => null,
}));

vi.mock('@/components/reports/DateRangePicker', () => ({
  DateRangePicker: () => <div data-stub="date-range-picker" />,
}));

vi.mock('@/components/reports/OverviewCards', () => ({
  OverviewCards: () => <div data-stub="overview-cards" />,
}));

vi.mock('@/components/reports/PlaysByDayChart', () => ({
  PlaysByDayChart: () => <div data-stub="plays-by-day-chart" />,
}));

vi.mock('@/components/reports/TopHoursChart', () => ({
  TopHoursChart: () => <div data-stub="top-hours-chart" />,
}));

vi.mock('@/components/reports/TopTracksTable', () => ({
  TopTracksTable: () => <div data-stub="top-tracks-table" />,
}));

vi.mock('@/components/reports/RoyaltyExportPanel', () => ({
  RoyaltyExportPanel: () => <div data-stub="royalty-export-panel" />,
}));

vi.mock('@/components/settings/SettingsLeftRail', () => ({
  SettingsLeftRail: () => (
    <nav aria-label="Settings sections (stub)" data-stub="settings-left-rail" />
  ),
}));

vi.mock('@/components/settings/sections/StationIdentitySection', () => ({
  StationIdentitySection: () => <div data-stub="station-identity-section">Station</div>,
}));

vi.mock('@/components/settings/sections/StreamsSection', () => ({
  StreamsSection: () => <div data-stub="streams-section">Streams</div>,
}));

vi.mock('@/components/settings/sections/TalentSection', () => ({
  TalentSection: () => <div data-stub="talent-section">Talent</div>,
}));

vi.mock('@/components/settings/sections/IntegrationsSection', () => ({
  IntegrationsSection: () => <div data-stub="integrations-section">Integrations</div>,
}));

vi.mock('@/components/settings/sections/ImagingSection', () => ({
  ImagingSection: () => <div data-stub="imaging-section">Imaging</div>,
}));

vi.mock('@/components/settings/sections/ComplianceSection', () => ({
  ComplianceSection: () => <div data-stub="compliance-section">Compliance</div>,
}));

vi.mock('@/components/settings/sections/AudioProcessingSection', () => ({
  AudioProcessingSection: () => <div data-stub="audio-processing-section">Audio</div>,
}));

vi.mock('@/components/settings/sections/BillingSection', () => ({
  BillingSection: () => <div data-stub="billing-section">Billing</div>,
}));

vi.mock('@/views/app/SettingsPlayback', () => ({
  SettingsPlayback: () => <div data-stub="settings-playback">Playback</div>,
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => (
    <button type="button" data-stub="lang-switcher">
      Language
    </button>
  ),
}));

vi.mock('@/components/CloudUploadPanel', () => ({
  CloudUploadPanel: () => <div data-stub="cloud-upload" />,
}));

// ── Query layer mocks (TanStack hooks) ──────────────────────────────────────
// We return deterministic shapes so each page hits its "happy" rendering
// branch (data loaded, not loading, not error).

vi.mock('@/lib/catalog-queries', () => ({
  useInfiniteCatalogTracks: () => ({
    data: { pages: [{ tracks: [], meta: { nextCursor: null, limit: 50 } }] },
    isLoading: false,
    isFetching: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/clock-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clock-queries')>(
    '@/lib/clock-queries',
  );
  return {
    ...actual,
    useClocks: () => ({
      data: { clocks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useCreateClock: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock('@/lib/schedule-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/schedule-queries')>(
    '@/lib/schedule-queries',
  );
  return {
    ...actual,
    useScheduleAssignments: () => ({
      data: { assignments: [] },
      isLoading: false,
      isError: false,
    }),
    useCreateAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/lib/voice-track-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice-track-queries')>(
    '@/lib/voice-track-queries',
  );
  return {
    ...actual,
    useVoiceTracks: () => ({
      data: { pages: [{ voiceTracks: [] }] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    useUpdateVoiceTrack: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteVoiceTrack: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('@/lib/audit-log-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit-log-queries')>(
    '@/lib/audit-log-queries',
  );
  return {
    ...actual,
    useAuditLog: () => ({
      data: { pages: [{ entries: [] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    }),
    useAuditLogCsvExport: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('@/lib/reports-queries', () => {
  const baseQuery = <T,>(data: T) => ({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  });
  return {
    useReportOverview: () =>
      baseQuery({
        overview: {
          totalPlays: 0,
          uniqueTitles: 0,
          daysWithActivity: 0,
          totalListeningHours: 0,
        },
        range: { from: 'x', to: 'y' },
      }),
    useReportPlaysByDay: () => baseQuery({ days: [], range: { from: 'x', to: 'y' } }),
    useReportTopHours: () => baseQuery({ hours: [] }),
    useReportTopTracks: () =>
      baseQuery({ tracks: [], limit: 25, range: { from: 'x', to: 'y' } }),
  };
});

vi.mock('@/lib/stream-status-queries', () => ({
  useStreamStatus: () => ({ data: undefined, isLoading: false, isError: false }),
}));

// Auth store stub for LoginPage.
vi.mock('@/lib/auth-store', () => ({
  isAuthRequired: () => true,
  useAuthStore: () => ({
    login: vi.fn(),
    authNotConfigured: false,
    checkSession: vi.fn(),
    checked: true,
    username: null,
  }),
}));

// ── Page imports ────────────────────────────────────────────────────────────
// These must come AFTER the vi.mock() calls above so hoisting works.

import LandingPage from '@/views/LandingPage';
import LoginPage from '@/views/LoginPage';
import TracksPage from '@/views/app/TracksPage';
import { ClocksPage } from '@/views/app/ClocksPage';
import { SchedulePage } from '@/views/app/SchedulePage';
import { LiveStudioPage } from '@/views/app/LiveStudioPage';
import { VoiceTracksPage } from '@/views/app/VoiceTracksPage';
import { ReportsPage } from '@/views/app/ReportsPage';
import { AuditLogPage } from '@/views/app/AuditLogPage';
import { SettingsPage } from '@/views/app/SettingsPage';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React =
  React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderPage(element: React.ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function cleanup({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('a11y (page-level axe audits)', () => {
  test('LandingPage > has no critical axe violations', async () => {
    const r = renderPage(<LandingPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('LoginPage > has no critical axe violations', async () => {
    const r = renderPage(<LoginPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('TracksPage > has no critical axe violations', async () => {
    const r = renderPage(<TracksPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('ClocksPage > has no critical axe violations', async () => {
    const r = renderPage(<ClocksPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('SchedulePage > has no critical axe violations', async () => {
    const r = renderPage(<SchedulePage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('LiveStudioPage > has no critical axe violations', async () => {
    const r = renderPage(<LiveStudioPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('VoiceTracksPage > has no critical axe violations', async () => {
    const r = renderPage(<VoiceTracksPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('ReportsPage > has no critical axe violations', async () => {
    const r = renderPage(<ReportsPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('AuditLogPage > has no critical axe violations', async () => {
    const r = renderPage(<AuditLogPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });

  test('SettingsPage > has no critical axe violations', async () => {
    const r = renderPage(<SettingsPage />);
    rendered.push(r);
    await expectNoA11yViolations(r.container);
  });
});
