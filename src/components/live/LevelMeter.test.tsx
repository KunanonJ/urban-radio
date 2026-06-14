import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LevelMeter } from '@/components/live/LevelMeter';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'liveStudio.meters.title': 'Levels',
        'liveStudio.meters.left': 'L',
        'liveStudio.meters.right': 'R',
        'liveStudio.meters.peak': 'PK',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

/** A stub analyser that returns a fixed amplitude (0..1) from getByteTimeDomainData. */
function stubAnalyser(amp: number): AnalyserNode {
  const fftSize = 2048;
  return {
    fftSize,
    getByteTimeDomainData(target: Uint8Array) {
      // amp → byte distance from 128. |s - 128| / 128 = amp → s = 128 + amp*128.
      const top = Math.min(255, Math.max(0, Math.round(128 + amp * 128)));
      target.fill(top);
    },
  } as unknown as AnalyserNode;
}

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function mount(element: React.ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function unmount({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  if (container.parentNode) container.parentNode.removeChild(container);
}

/**
 * One-shot RAF: invokes the callback once with a fixed timestamp, then
 * subsequent calls (made from inside the callback to schedule the next
 * frame) become no-ops. This avoids infinite recursion in tests.
 *
 * Each test should call `makeOneShotRaf()` to get a fresh instance.
 */
function makeOneShotRaf(timeMs = 0) {
  let fired = false;
  return (cb: FrameRequestCallback): number => {
    if (fired) return 0;
    fired = true;
    cb(timeMs);
    return 0;
  };
}
function noopCancel(): void {}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('LevelMeter', () => {
  test('given null analyser > renders disabled state', () => {
    const rendered = mount(
      <LevelMeter
        analyser={null}
        rafImpl={makeOneShotRaf(0)}
        cancelRafImpl={noopCancel}
      />,
    );
    const root = rendered.container.querySelector('[data-testid="level-meter"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-disabled')).toBe('true');
    // Bars should still render (so layout is stable), but with zero amplitude.
    const fillLeft = rendered.container.querySelector(
      '[data-testid="meter-fill-l"]',
    ) as HTMLElement | null;
    expect(fillLeft).not.toBeNull();
    expect(fillLeft?.style.height ?? fillLeft?.style.width).toBe('0%');
    unmount(rendered);
  });

  test('given analyser > renders both L and R bars', () => {
    const rendered = mount(
      <LevelMeter
        analyser={stubAnalyser(0.4)}
        rafImpl={makeOneShotRaf(0)}
        cancelRafImpl={noopCancel}
      />,
    );
    const left = rendered.container.querySelector('[data-testid="meter-bar-l"]');
    const right = rendered.container.querySelector('[data-testid="meter-bar-r"]');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    unmount(rendered);
  });

  test('given orientation horizontal > sets data-orientation horizontal and uses width for fill', () => {
    const rendered = mount(
      <LevelMeter
        analyser={stubAnalyser(0.5)}
        orientation="horizontal"
        rafImpl={makeOneShotRaf(0)}
        cancelRafImpl={noopCancel}
      />,
    );
    const root = rendered.container.querySelector('[data-testid="level-meter"]');
    expect(root?.getAttribute('data-orientation')).toBe('horizontal');
    const fill = rendered.container.querySelector(
      '[data-testid="meter-fill-l"]',
    ) as HTMLElement | null;
    // Horizontal → width is set, not height.
    expect(fill?.style.width).not.toBe('');
    expect(fill?.style.height).toBe('');
    unmount(rendered);
  });

  test('given high peak > shows peak-hold indicator', () => {
    const rendered = mount(
      <LevelMeter
        analyser={stubAnalyser(0.9)}
        rafImpl={makeOneShotRaf(0)}
        cancelRafImpl={noopCancel}
      />,
    );
    const hold = rendered.container.querySelector(
      '[data-testid="meter-peak-hold-l"]',
    );
    expect(hold).not.toBeNull();
    unmount(rendered);
  });

  test('given orientation vertical (default) > sets data-orientation vertical and uses height for fill', () => {
    const rendered = mount(
      <LevelMeter
        analyser={stubAnalyser(0.5)}
        rafImpl={makeOneShotRaf(0)}
        cancelRafImpl={noopCancel}
      />,
    );
    const root = rendered.container.querySelector('[data-testid="level-meter"]');
    expect(root?.getAttribute('data-orientation')).toBe('vertical');
    const fill = rendered.container.querySelector(
      '[data-testid="meter-fill-l"]',
    ) as HTMLElement | null;
    expect(fill?.style.height).not.toBe('');
    expect(fill?.style.width).toBe('');
    unmount(rendered);
  });
});
