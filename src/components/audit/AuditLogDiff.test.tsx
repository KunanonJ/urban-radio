import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auditLog.diff.before': 'Before',
        'auditLog.diff.after': 'After',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { AuditLogDiff } from './AuditLogDiff';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: ReactNode): Rendered {
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

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('AuditLogDiff', () => {
  test('given both before + after objects > renders both pretty-printed JSON blocks', () => {
    const r = render(
      <AuditLogDiff before={{ name: 'Old' }} after={{ name: 'New' }} />,
    );
    rendered.push(r);

    const beforeEl = r.container.querySelector('[data-testid="audit-log-diff-before"]');
    const afterEl = r.container.querySelector('[data-testid="audit-log-diff-after"]');
    expect(beforeEl).toBeTruthy();
    expect(afterEl).toBeTruthy();
    expect(beforeEl?.textContent ?? '').toContain('"name": "Old"');
    expect(afterEl?.textContent ?? '').toContain('"name": "New"');
  });

  test('given both before + after null > renders the "(no diff)" placeholder', () => {
    const r = render(<AuditLogDiff before={null} after={null} />);
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="audit-log-diff-empty"]')).toBeTruthy();
    expect(r.container.textContent ?? '').toContain('(no diff)');
  });

  test('given only after (create scenario) > still renders both sections (before falls back to em-dash)', () => {
    const r = render(<AuditLogDiff before={null} after={{ created: true }} />);
    rendered.push(r);
    const beforeEl = r.container.querySelector('[data-testid="audit-log-diff-before"]');
    const afterEl = r.container.querySelector('[data-testid="audit-log-diff-after"]');
    expect(beforeEl?.textContent).toBe('—');
    expect(afterEl?.textContent ?? '').toContain('"created": true');
  });
});
