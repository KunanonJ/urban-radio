import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'comments.actions.edit': 'Edit',
        'comments.actions.save': 'Save',
        'comments.actions.cancel': 'Cancel',
        'comments.actions.delete': 'Delete',
        'comments.actions.deleteConfirm': 'Delete this comment?',
        'comments.actions.resolve': 'Mark resolved',
        'comments.actions.unresolve': 'Unresolve',
        'comments.resolved': 'Resolved',
        'comments.resolvedBy': `by ${vars?.user ?? ''}`,
        'comments.empty.title': 'No comments yet',
        'comments.empty.description': 'Start the conversation.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const updateMutateMock = vi.fn();
const deleteMutateMock = vi.fn();
const isUpdatePending = { current: false };
const isDeletePending = { current: false };

vi.mock('@/lib/comment-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/comment-queries')>(
    '@/lib/comment-queries',
  );
  return {
    ...actual,
    useUpdateComment: () => ({
      mutate: updateMutateMock,
      mutateAsync: (input: unknown) => Promise.resolve(updateMutateMock(input)),
      isPending: isUpdatePending.current,
    }),
    useDeleteComment: () => ({
      mutate: deleteMutateMock,
      mutateAsync: (input: unknown) => Promise.resolve(deleteMutateMock(input)),
      isPending: isDeletePending.current,
    }),
  };
});

import { CommentList } from './CommentList';
import type { CommentRow } from '@/lib/comment-queries';

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

const baseComment: CommentRow = {
  id: 'c-1',
  stationId: 's',
  authorUserId: 'u-1',
  targetType: 'clock',
  targetId: 'clk-1',
  body: 'first thoughts',
  resolvedAt: null,
  resolvedByUserId: null,
  createdAt: '2026-05-14T10:00:00Z',
  updatedAt: '2026-05-14T10:00:00Z',
  author: { userId: 'u-1', username: 'demo' },
};

beforeEach(() => {
  updateMutateMock.mockReset();
  deleteMutateMock.mockReset();
  isUpdatePending.current = false;
  isDeletePending.current = false;
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => (b.textContent ?? '').includes(text)) ?? null;
}

describe('CommentList', () => {
  test('given empty list > renders empty hint', () => {
    const r = render(
      <CommentList
        comments={[]}
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('No comments yet');
  });

  test('given comments > renders body + author', () => {
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-2"
        currentUserRole="operator"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('first thoughts');
    expect(r.container.textContent).toContain('demo');
  });

  test('owner sees Edit/Delete, others do not', () => {
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-1"
        currentUserRole="operator"
      />,
    );
    rendered.push(r);
    expect(findButtonByText(r.container, 'Edit')).not.toBeNull();
    expect(findButtonByText(r.container, 'Delete')).not.toBeNull();
    cleanup(rendered.pop()!);

    const r2 = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-2"
        currentUserRole="operator"
      />,
    );
    rendered.push(r2);
    expect(findButtonByText(r2.container, 'Edit')).toBeNull();
    expect(findButtonByText(r2.container, 'Delete')).toBeNull();
  });

  test('admin (non-author) sees Resolve and Delete', () => {
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-2"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    expect(findButtonByText(r.container, 'Mark resolved')).not.toBeNull();
    expect(findButtonByText(r.container, 'Delete')).not.toBeNull();
    // Non-author admin cannot edit body
    expect(findButtonByText(r.container, 'Edit')).toBeNull();
  });

  test('clicking Resolve calls useUpdateComment with resolved=true', () => {
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    const btn = findButtonByText(r.container, 'Mark resolved');
    expect(btn).not.toBeNull();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(updateMutateMock).toHaveBeenCalledWith({
      id: 'c-1',
      patch: { resolved: true },
    });
  });

  test('resolved comment shows Resolved badge and dim styling', () => {
    const resolved: CommentRow = {
      ...baseComment,
      resolvedAt: '2026-05-14T11:00:00Z',
      resolvedByUserId: 'u-1',
    };
    const r = render(
      <CommentList
        comments={[resolved]}
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('Resolved');
    // Unresolve action becomes available
    expect(findButtonByText(r.container, 'Unresolve')).not.toBeNull();
  });

  test('clicking Edit toggles inline edit form', () => {
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    const editBtn = findButtonByText(r.container, 'Edit');
    expect(editBtn).not.toBeNull();
    act(() => {
      editBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The edit form should expose a textarea now.
    const textarea = r.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(findButtonByText(r.container, 'Save')).not.toBeNull();
    expect(findButtonByText(r.container, 'Cancel')).not.toBeNull();
  });

  test('clicking Delete calls useDeleteComment', () => {
    // Stub window.confirm to auto-confirm so we exercise the success path.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const r = render(
      <CommentList
        comments={[baseComment]}
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    const delBtn = findButtonByText(r.container, 'Delete');
    expect(delBtn).not.toBeNull();
    act(() => {
      delBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(deleteMutateMock).toHaveBeenCalledWith('c-1');
    confirmSpy.mockRestore();
  });
});
