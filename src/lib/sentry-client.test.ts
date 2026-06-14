import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { initSentryClient } from './sentry-client';

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('initSentryClient', () => {
  test('given no DSN > returns null (vitest jsdom env, window defined)', () => {
    const client = initSentryClient({});
    expect(client).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('given empty DSN > returns null', () => {
    const client = initSentryClient({ NEXT_PUBLIC_SENTRY_DSN: '' });
    expect(client).toBeNull();
  });

  test('given DSN in browser-like environment > returns a client with captureException', () => {
    const client = initSentryClient({
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc@browser.sentry.io/9',
    });
    expect(client).not.toBeNull();
    expect(typeof client!.captureException).toBe('function');
    expect(infoSpy).toHaveBeenCalled();
  });

  test('captureException forwards to console.error fallback', () => {
    const client = initSentryClient({
      NEXT_PUBLIC_SENTRY_DSN: 'https://abc@browser.sentry.io/9',
    });
    const err = new Error('client boom');
    client!.captureException(err);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]).toContain(err);
  });

  test('init log truncates DSN — does not leak full credential', () => {
    initSentryClient({
      NEXT_PUBLIC_SENTRY_DSN: 'https://verylongpublicapikey@browser.sentry.io/999',
    });
    expect(infoSpy).toHaveBeenCalled();
    const logged = String(infoSpy.mock.calls[0][1] ?? '');
    expect(logged).not.toContain('/999');
  });

  test('SSR safety — returns null when window is undefined', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — simulate SSR
    delete globalThis.window;
    try {
      const client = initSentryClient({
        NEXT_PUBLIC_SENTRY_DSN: 'https://abc@browser.sentry.io/9',
      });
      expect(client).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
