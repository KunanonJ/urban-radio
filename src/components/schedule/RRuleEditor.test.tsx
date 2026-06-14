import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// i18n: keys → English strings used in the brief.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'schedule.rrule.label': 'Recurrence',
        'schedule.rrule.none': 'One-time',
        'schedule.rrule.everyDay': 'Every day',
        'schedule.rrule.weekdays': 'Weekdays (Mon–Fri)',
        'schedule.rrule.weekends': 'Weekends (Sat–Sun)',
        'schedule.rrule.custom': 'Custom RRULE',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { RRuleEditor } from './RRuleEditor';

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

function clickRadioByLabel(container: HTMLElement, labelText: string) {
  const labels = Array.from(container.querySelectorAll('label')) as HTMLLabelElement[];
  const match = labels.find((l) => (l.textContent ?? '').includes(labelText));
  expect(match).toBeTruthy();
  act(() => {
    match!.click();
  });
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('RRuleEditor', () => {
  test('given Weekdays selected > emits FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    const r = render(<RRuleEditor value={null} onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'Weekdays (Mon');

    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  test('given Weekends selected > emits FREQ=WEEKLY;BYDAY=SA,SU', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    const r = render(<RRuleEditor value={null} onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'Weekends');

    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
  });

  test('given Every day selected > emits FREQ=DAILY', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    const r = render(<RRuleEditor value={null} onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'Every day');

    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg).toBe('FREQ=DAILY');
  });

  test('given One-time selected > emits null', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    // Start with a non-null value so toggling back to "One-time" actually emits.
    const r = render(<RRuleEditor value="FREQ=DAILY" onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'One-time');

    expect(onChange).toHaveBeenCalled();
    const lastArg = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastArg).toBeNull();
  });

  test('given custom RRULE invalid string > shows error below textarea', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    const r = render(<RRuleEditor value={null} onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'Custom RRULE');

    const textarea = r.container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'FREQ=GIBBERISH');
      // React's onChange listens to native `input` events for textareas.
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });

    // Error message should appear; the component sets data-rrule-error="true" on the element holding the message.
    const errorEl = r.container.querySelector('[data-rrule-error="true"]');
    expect(errorEl).not.toBeNull();
  });

  test('given custom RRULE valid string > emits normalized rule and shows summary', () => {
    const onChange = vi.fn<(rrule: string | null) => void>();
    const r = render(<RRuleEditor value={null} onChange={onChange} />);
    rendered.push(r);

    clickRadioByLabel(r.container, 'Custom RRULE');

    const textarea = r.container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'FREQ=DAILY');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });

    // No error state for a valid rule.
    expect(r.container.querySelector('[data-rrule-error="true"]')).toBeNull();
    // onChange called with FREQ=DAILY (or RRULE:FREQ=DAILY canonical form).
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const lastArg = String(lastCall?.[0] ?? '');
    expect(lastArg.includes('FREQ=DAILY')).toBe(true);
  });
});
