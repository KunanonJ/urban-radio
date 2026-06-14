import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auditLog.list.at': 'Time',
        'auditLog.list.actor': 'Actor',
        'auditLog.list.action': 'Action',
        'auditLog.list.target': 'Target',
        'auditLog.list.details': 'Details',
        'auditLog.empty.title': 'No activity yet',
        'auditLog.empty.description': 'Actions across the app will appear here.',
        'auditLog.diff.before': 'Before',
        'auditLog.diff.after': 'After',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { AuditLogList } from './AuditLogList';
import type { AuditLogEntry } from '@/lib/audit-log-queries';

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

function makeEntry(over: Partial<AuditLogEntry> & { id: string }): AuditLogEntry {
  return {
    id: over.id,
    at: over.at ?? '2026-05-13T10:00:00Z',
    actor: over.actor ?? { userId: 'u1', username: 'demo' },
    action: over.action ?? 'create',
    targetType: over.targetType ?? 'clock',
    targetId: over.targetId ?? 'clock-1',
    before: over.before ?? null,
    after: over.after ?? { name: 'A' },
  };
}

describe('AuditLogList', () => {
  test('given a list of entries > renders one row per entry with action badge + target', () => {
    const entries = [
      makeEntry({ id: 'a1', action: 'create', targetType: 'clock', targetId: 'clock-1' }),
      makeEntry({ id: 'a2', action: 'update', targetType: 'voice_track', targetId: 'vt-2' }),
      makeEntry({
        id: 'a3',
        action: 'delete',
        targetType: 'schedule_assignment',
        targetId: 'sa-3',
      }),
    ];
    const r = render(<AuditLogList entries={entries} isLoading={false} />);
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="audit-log-row-a1"]')).toBeTruthy();
    expect(r.container.querySelector('[data-testid="audit-log-row-a2"]')).toBeTruthy();
    expect(r.container.querySelector('[data-testid="audit-log-row-a3"]')).toBeTruthy();

    const text = r.container.textContent ?? '';
    expect(text).toContain('clock-1');
    expect(text).toContain('vt-2');
    expect(text).toContain('sa-3');
    expect(text).toContain('create');
    expect(text).toContain('update');
    expect(text).toContain('delete');
    expect(text).toContain('demo');
  });

  test('given empty list > renders the empty state with i18n strings', () => {
    const r = render(<AuditLogList entries={[]} isLoading={false} />);
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('No activity yet');
    expect(r.container.textContent ?? '').toContain('Actions across the app will appear here.');
  });

  test('given loading > renders skeleton rows instead of the table', () => {
    const r = render(<AuditLogList entries={[]} isLoading={true} />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="audit-log-list-loading"]')).toBeTruthy();
    expect(r.container.querySelector('[data-testid="audit-log-list"]')).toBeFalsy();
  });

  test('given click View button > expands the detail row with before/after diff', () => {
    const entry = makeEntry({
      id: 'a9',
      action: 'update',
      before: { name: 'Old' },
      after: { name: 'New' },
    });
    const r = render(<AuditLogList entries={[entry]} isLoading={false} />);
    rendered.push(r);

    // Detail row not present yet.
    expect(r.container.querySelector('[data-testid="audit-log-detail-a9"]')).toBeFalsy();

    const btn = r.container.querySelector(
      '[data-testid="audit-log-expand-a9"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const detail = r.container.querySelector('[data-testid="audit-log-detail-a9"]');
    expect(detail).toBeTruthy();
    expect(detail?.textContent ?? '').toContain('"name": "Old"');
    expect(detail?.textContent ?? '').toContain('"name": "New"');
  });

  test('given entry with null actor > renders "(deleted user)" placeholder', () => {
    const entry = makeEntry({
      id: 'a-orphan',
      actor: { userId: null, username: null },
    });
    const r = render(<AuditLogList entries={[entry]} isLoading={false} />);
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('(deleted user)');
  });

  test('given hasNextPage > renders the Load more button and forwards onLoadMore', () => {
    const onLoadMore = vi.fn();
    const r = render(
      <AuditLogList
        entries={[makeEntry({ id: 'a1' })]}
        isLoading={false}
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );
    rendered.push(r);

    const btn = r.container.querySelector(
      '[data-testid="audit-log-load-more"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
