import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const apiFetchMock =
  vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    message: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { error?: string }) => {
      const map: Record<string, string> = {
        'reports.royalty.title': 'Royalty exports',
        'reports.royalty.intro': 'Download station play data.',
        'reports.royalty.ascap': 'ASCAP CSV',
        'reports.royalty.bmi': 'BMI CSV',
        'reports.royalty.soundexchange': 'SoundExchange CSV',
        'reports.royalty.rowCap': '10,000-row cap',
        'reports.royalty.exportCapHit': 'Row cap exceeded.',
      };
      if (key === 'reports.royalty.exportFailed') {
        return `Export failed: ${opts?.error ?? 'unknown'}`;
      }
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { RoyaltyExportPanel } from './RoyaltyExportPanel';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

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

function makeBlobResponse(text: string, init: ResponseInit = { status: 200 }): Response {
  return new Response(text, {
    ...init,
    headers: { 'content-type': 'text/csv', ...(init.headers ?? {}) },
  });
}

const rendered: Rendered[] = [];

// URL.createObjectURL / revokeObjectURL are absent in jsdom; polyfill.
let objectUrlCounter = 0;
const createdUrls: string[] = [];
const revokedUrls: string[] = [];

let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;
let aClickSpy: ReturnType<typeof vi.fn>;
let originalAClick: typeof HTMLAnchorElement.prototype.click;

beforeEach(() => {
  apiFetchMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  createdUrls.length = 0;
  revokedUrls.length = 0;
  objectUrlCounter = 0;

  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((_blob: Blob) => {
      objectUrlCounter += 1;
      const url = `blob:test-${objectUrlCounter}`;
      createdUrls.push(url);
      return url;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((url: string) => {
      revokedUrls.push(url);
    }),
  });

  // Spy on <a>.click() so we don't actually try to navigate.
  originalAClick = HTMLAnchorElement.prototype.click;
  aClickSpy = vi.fn();
  HTMLAnchorElement.prototype.click = aClickSpy;
});

afterEach(() => {
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreate,
    });
  }
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevoke,
    });
  }
  HTMLAnchorElement.prototype.click = originalAClick;
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

const FROM = '2026-04-01T00:00:00.000Z';
const TO = '2026-04-30T23:59:59.999Z';

describe('RoyaltyExportPanel', () => {
  test('renders 3 download buttons', () => {
    const r = render(<RoyaltyExportPanel from={FROM} to={TO} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-royalty-ascap-button"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-royalty-bmi-button"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector(
        '[data-testid="reports-royalty-soundexchange-button"]',
      ),
    ).toBeTruthy();
  });

  test('click ASCAP button > fetches /api/royalty/export with correct URL', async () => {
    apiFetchMock.mockResolvedValueOnce(makeBlobResponse('TITLE,ARTIST\n'));
    const r = render(<RoyaltyExportPanel from={FROM} to={TO} />);
    rendered.push(r);
    await act(async () => {
      (r.container.querySelector(
        '[data-testid="reports-royalty-ascap-button"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path] = apiFetchMock.mock.calls[0];
    expect(path).toContain('/api/royalty/export?');
    expect(path).toContain('format=ascap');
    expect(path).toContain(`from=${encodeURIComponent(FROM)}`);
    expect(path).toContain(`to=${encodeURIComponent(TO)}`);
  });

  test('click BMI > 413 response > shows cap-hit toast, no download', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeBlobResponse('too many', { status: 413 }),
    );
    const r = render(<RoyaltyExportPanel from={FROM} to={TO} />);
    rendered.push(r);
    await act(async () => {
      (r.container.querySelector(
        '[data-testid="reports-royalty-bmi-button"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock.mock.calls[0][0]).toBe('Row cap exceeded.');
    expect(aClickSpy).not.toHaveBeenCalled();
    expect(createdUrls.length).toBe(0);
  });

  test('click SoundExchange > 200 OK > triggers blob download', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeBlobResponse('header,row\nA,B\n'),
    );
    const r = render(<RoyaltyExportPanel from={FROM} to={TO} />);
    rendered.push(r);
    await act(async () => {
      (r.container.querySelector(
        '[data-testid="reports-royalty-soundexchange-button"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(aClickSpy).toHaveBeenCalledTimes(1);
    expect(createdUrls.length).toBe(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  test('click ASCAP > 500 response > shows export-failed toast', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeBlobResponse('boom', { status: 500 }),
    );
    const r = render(<RoyaltyExportPanel from={FROM} to={TO} />);
    rendered.push(r);
    await act(async () => {
      (r.container.querySelector(
        '[data-testid="reports-royalty-ascap-button"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock.mock.calls[0][0]).toContain('HTTP 500');
    expect(aClickSpy).not.toHaveBeenCalled();
  });
});
