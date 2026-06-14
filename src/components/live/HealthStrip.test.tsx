import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { StreamStatusJson } from '@/lib/stream-status-queries';
import type { SchedulerEvent } from '@/lib/scheduler-store';

// ── Stubs ────────────────────────────────────────────────────────────────────
type StreamStatusHookReturn = {
  data: StreamStatusJson | undefined;
  isLoading: boolean;
  isError: boolean;
};

let streamStatusReturn: StreamStatusHookReturn = {
  data: undefined,
  isLoading: false,
  isError: false,
};
let schedulerEvents: SchedulerEvent[] = [];

vi.mock('@/lib/stream-status-queries', () => ({
  useStreamStatus: () => streamStatusReturn,
}));

vi.mock('@/lib/scheduler-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduler-store')>(
    '@/lib/scheduler-store',
  );
  return {
    ...actual,
    // Override only the hook; keep `eventRunsToday` etc.
    useSchedulerStore: <T,>(
      selector: (s: { events: SchedulerEvent[] }) => T,
    ): T => selector({ events: schedulerEvents }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      const map: Record<string, string> = {
        'liveStudio.health.title': 'On-air health',
        'liveStudio.health.encoderIdle': 'Encoder idle',
        'liveStudio.health.encoderConnecting': 'Encoder connecting…',
        'liveStudio.health.encoderStreaming': 'On air',
        'liveStudio.health.encoderError': 'Encoder error',
        'liveStudio.health.encoderDemo': 'Demo mode',
        'liveStudio.health.schedulerActive': 'Scheduler active',
        'liveStudio.health.schedulerPaused': 'Scheduler paused',
        'liveStudio.health.schedulerHeartbeatStale': 'Scheduler heartbeat stale',
      };
      if (key === 'liveStudio.health.listeners') {
        return `${opts?.count ?? 0} listening`;
      }
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { HealthStrip } from './HealthStrip';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: React.ReactElement): Rendered {
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
  streamStatusReturn = { data: undefined, isLoading: false, isError: false };
  schedulerEvents = [];
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function makeStatus(over: Partial<StreamStatusJson['status']> = {}): StreamStatusJson {
  return {
    status: {
      connected: false,
      mountPoint: null,
      listeners: 0,
      bitrate: null,
      uptimeSeconds: 0,
      source: 'stub',
      ...over,
    },
  };
}

describe('HealthStrip', () => {
  test('given encoder connected stub > shows Demo mode pill (amber)', () => {
    streamStatusReturn = {
      data: makeStatus({ connected: true, source: 'stub' }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-encoder-pill"]');
    expect(pill).not.toBeNull();
    expect((pill?.textContent ?? '').trim()).toBe('Demo mode');
    // Amber state encoded as data-state="demo" so the test doesn't pin colour classes.
    expect(pill?.getAttribute('data-state')).toBe('demo');
  });

  test('given encoder connected azuracast > shows On air pill (green)', () => {
    streamStatusReturn = {
      data: makeStatus({ connected: true, source: 'azuracast' }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-encoder-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('On air');
    expect(pill?.getAttribute('data-state')).toBe('streaming');
  });

  test('given encoder disconnected > shows Encoder idle pill', () => {
    streamStatusReturn = {
      data: makeStatus({ connected: false, source: 'stub' }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-encoder-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('Encoder idle');
    expect(pill?.getAttribute('data-state')).toBe('idle');
  });

  test('given loading > shows Encoder connecting pill', () => {
    streamStatusReturn = { data: undefined, isLoading: true, isError: false };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-encoder-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('Encoder connecting…');
    expect(pill?.getAttribute('data-state')).toBe('connecting');
  });

  test('given error > shows Encoder error pill', () => {
    streamStatusReturn = { data: undefined, isLoading: false, isError: true };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-encoder-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('Encoder error');
    expect(pill?.getAttribute('data-state')).toBe('error');
  });

  test('given listeners=42 > shows "42 listening"', () => {
    streamStatusReturn = {
      data: makeStatus({ connected: true, source: 'azuracast', listeners: 42 }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-listeners-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('42 listening');
  });

  test('given no scheduler events > shows scheduler active pill', () => {
    schedulerEvents = [];
    streamStatusReturn = {
      data: makeStatus({ connected: false }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-scheduler-pill"]');
    // No `lastFired` field exists on the store yet, so the strip reports "active"
    // by default until heartbeat tracking lands.
    expect((pill?.textContent ?? '').trim()).toBe('Scheduler active');
    expect(pill?.getAttribute('data-state')).toBe('active');
  });

  test('given scheduler has paused event > shows Scheduler paused pill', () => {
    schedulerEvents = [
      {
        id: 'evt-1',
        time: '10:00',
        action: 'pause',
        label: 'Lunch',
      },
    ];
    streamStatusReturn = {
      data: makeStatus({ connected: false }),
      isLoading: false,
      isError: false,
    };
    const r = render(<HealthStrip />);
    rendered.push(r);

    const pill = r.container.querySelector('[data-testid="health-scheduler-pill"]');
    expect((pill?.textContent ?? '').trim()).toBe('Scheduler paused');
    expect(pill?.getAttribute('data-state')).toBe('paused');
  });
});
