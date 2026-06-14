import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mutateMock = vi.fn();

vi.mock('@/lib/presence-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/presence-queries')>(
    '@/lib/presence-queries',
  );
  return {
    ...actual,
    useSendPresenceHeartbeat: () => ({
      mutate: mutateMock,
      mutateAsync: vi.fn(() => Promise.resolve({ sessions: [], meta: { ttlSeconds: 15 } })),
      isPending: false,
    }),
  };
});

import { usePresenceHeartbeat } from './usePresenceHeartbeat';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function Harness({
  targetId,
  enabled,
  intervalMs,
}: {
  targetId: string;
  enabled?: boolean;
  intervalMs?: number;
}) {
  usePresenceHeartbeat({
    target: { type: 'clock', id: targetId },
    enabled,
    intervalMs,
  });
  return React.createElement('div', { 'data-testid': 'harness' });
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
  mutateMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.useRealTimers();
});

describe('usePresenceHeartbeat', () => {
  test('fires a mount beacon with the supplied target', () => {
    const r = render(React.createElement(Harness, { targetId: 'clk-1' }));
    rendered.push(r);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      targetType: 'clock',
      targetId: 'clk-1',
    });
  });

  test('polls every intervalMs after mount', () => {
    const r = render(
      React.createElement(Harness, { targetId: 'clk-1', intervalMs: 5000 }),
    );
    rendered.push(r);
    expect(mutateMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mutateMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mutateMock).toHaveBeenCalledTimes(3);
  });

  test('clears the interval on unmount', () => {
    const r = render(
      React.createElement(Harness, { targetId: 'clk-1', intervalMs: 5000 }),
    );
    rendered.push(r);
    expect(mutateMock).toHaveBeenCalledTimes(1);

    // Unmount BEFORE the next tick would fire.
    cleanup(r);
    rendered.length = 0;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  test('does nothing when enabled=false', () => {
    const r = render(
      React.createElement(Harness, {
        targetId: 'clk-1',
        enabled: false,
        intervalMs: 5000,
      }),
    );
    rendered.push(r);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mutateMock).toHaveBeenCalledTimes(0);
  });

  test('does nothing when targetId is empty', () => {
    const r = render(
      React.createElement(Harness, { targetId: '', intervalMs: 5000 }),
    );
    rendered.push(r);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mutateMock).toHaveBeenCalledTimes(0);
  });
});
