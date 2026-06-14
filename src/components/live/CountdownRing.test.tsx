import { afterEach, describe, expect, test } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CountdownRing } from './CountdownRing';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const m = { container, root };
  mounted.push(m);
  return m;
}

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    if (!m) continue;
    act(() => {
      m.root.unmount();
    });
    m.container.remove();
  }
});

describe('CountdownRing', () => {
  test('given progress 0 > stroke-dashoffset = circumference (empty)', () => {
    const size = 120;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const { container } = mount(<CountdownRing progress={0} size={size} strokeWidth={strokeWidth} />);

    const progressCircle = container.querySelector('[data-testid="countdown-ring-progress"]');
    expect(progressCircle).not.toBeNull();
    const offset = Number(progressCircle?.getAttribute('stroke-dashoffset'));
    // Empty ring -> dashoffset equals the circumference.
    expect(offset).toBeCloseTo(circumference, 3);
  });

  test('given progress 1 > stroke-dashoffset = 0 (full)', () => {
    const { container } = mount(<CountdownRing progress={1} size={120} strokeWidth={8} />);

    const progressCircle = container.querySelector('[data-testid="countdown-ring-progress"]');
    expect(progressCircle).not.toBeNull();
    const offset = Number(progressCircle?.getAttribute('stroke-dashoffset'));
    expect(offset).toBeCloseTo(0, 3);
  });

  test('given remainingLabel > renders in the middle', () => {
    const { container } = mount(
      <CountdownRing progress={0.5} remainingLabel="1:23" />,
    );

    const label = container.querySelector('[data-testid="countdown-ring-label"]');
    expect(label?.textContent).toBe('1:23');
  });
});
