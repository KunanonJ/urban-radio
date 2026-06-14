import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Mock i18n so tests don't depend on the locale loader.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'comments.compose.placeholder': 'Leave a comment…',
        'comments.compose.submit': 'Comment',
        'comments.compose.charCount': `${vars?.count ?? 0} / 2000`,
      };
      return map[key] ?? key;
    },
  }),
}));

// Mock the create-comment hook so we can observe calls.
const mutateMock = vi.fn();
const isPendingRef = { current: false };

vi.mock('@/lib/comment-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/comment-queries')>(
    '@/lib/comment-queries',
  );
  return {
    ...actual,
    useCreateComment: () => ({
      mutate: mutateMock,
      mutateAsync: (input: unknown) =>
        Promise.resolve(mutateMock(input)),
      isPending: isPendingRef.current,
    }),
  };
});

import { CommentComposer } from './CommentComposer';

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

beforeEach(() => {
  mutateMock.mockReset();
  isPendingRef.current = false;
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CommentComposer', () => {
  test('renders textarea + submit button', () => {
    const r = render(<CommentComposer targetType="clock" targetId="clk-1" />);
    rendered.push(r);
    const textarea = r.container.querySelector('textarea');
    const button = r.container.querySelector('button[type="submit"]');
    expect(textarea).not.toBeNull();
    expect(button).not.toBeNull();
  });

  test('typing updates char counter', () => {
    const r = render(<CommentComposer targetType="clock" targetId="clk-1" />);
    rendered.push(r);
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => setTextareaValue(textarea, 'hello'));
    // Counter text "5 / 2000" should appear somewhere in the DOM.
    expect(r.container.textContent).toContain('5 / 2000');
  });

  test('submitting calls useCreateComment with body', async () => {
    const r = render(<CommentComposer targetType="voice_track" targetId="vt-1" />);
    rendered.push(r);
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => setTextareaValue(textarea, 'great take'));
    const form = r.container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0][0];
    expect(arg).toEqual({
      targetType: 'voice_track',
      targetId: 'vt-1',
      body: 'great take',
    });
  });

  test('blank body keeps submit disabled', () => {
    const r = render(<CommentComposer targetType="clock" targetId="clk-1" />);
    rendered.push(r);
    const button = r.container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => setTextareaValue(textarea, '   '));
    expect(button.disabled).toBe(true);
    act(() => setTextareaValue(textarea, 'hi'));
    expect(button.disabled).toBe(false);
  });
});
